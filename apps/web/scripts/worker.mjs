import postgres from "postgres";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";
import { HunterMcpClient } from "./mcp/client.mjs";
import { createProviderGateway } from "./worker/core/provider-gateway.mjs";
import { createScoringEngine } from "./worker/core/scoring-engine.mjs";
import { createApplicationEngine } from "./worker/core/application-engine.mjs";
import { createApplicationTrackingEngine } from "./worker/core/application-tracking-engine.mjs";
import { createApplicationSubmissionEngine } from "./worker/core/application-submission-engine.mjs";
import { loadWorkerConfig } from "./worker/core/config.mjs";
import { createJsonLogger } from "./worker/core/logger.mjs";
import {
  dedupeOpeningsLocal,
  toPersistableOpening,
} from "./worker/core/openings.mjs";
import { searchGithubIssues } from "./mcp/connectors/github-issues.mjs";
import { searchGreenhouse } from "./mcp/connectors/greenhouse.mjs";
import { searchLinkedIn } from "./mcp/connectors/linkedin.mjs";
import { searchLever } from "./mcp/connectors/lever.mjs";
import { searchNerdin } from "./mcp/connectors/nerdin.mjs";

const config = loadWorkerConfig();
const logger = createJsonLogger();

// Provider Gateway - Fase B
const providersRegistry = {
  linkedin: searchLinkedIn,
  nerdin: searchNerdin,
  greenhouse: searchGreenhouse,
  lever: searchLever,
  github: searchGithubIssues,
};
const gateway = createProviderGateway(providersRegistry, logger);

// Scoring Engine - Fase C
const scoreEngine = createScoringEngine(
  {
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 dias
    groqBatchSize: config.huntScoreBatchSize ?? 3,
    groqConcurrency: config.huntScoreConcurrency ?? 2,
    llmTopK: config.huntScoreLlmTopK,
    llmMinHeuristic: config.huntScoreLlmMinHeuristic,
  },
  logger,
);

// Application Engine - Fase D
const appEngine = createApplicationEngine({}, logger);

// Application Tracking Engine - Phase 5
const trackingEngine = createApplicationTrackingEngine({}, logger);

// Application Submission Engine - Tier 2
const submissionEngine = createApplicationSubmissionEngine({}, logger);

if (!config.databaseUrl) {
  console.error("[worker] DATABASE_URL nao configurado");
  process.exit(1);
}

const sql = postgres(config.databaseUrl, {
  max: Math.max(2, config.huntPersistConcurrency + 1),
  prepare: false,
});
let isShuttingDown = false;

class HuntCancelledError extends Error {
  constructor(message) {
    super(message);
    this.name = "HuntCancelledError";
  }
}

function log(level, message, extra = {}) {
  logger.log(level, message, extra);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs() {
  return Date.now();
}

function shouldNotifyEvent(eventType) {
  const allowed = Array.isArray(config.notifyWebhookEvents)
    ? config.notifyWebhookEvents
    : [];
  if (!allowed.length) return false;
  return allowed.includes(String(eventType));
}

async function sendWebhookNotification(eventType, payload) {
  if (!config.notifyWebhookUrl || !shouldNotifyEvent(eventType)) {
    return;
  }

  const body = {
    eventType,
    ts: new Date().toISOString(),
    payload,
  };

  const headers = {
    "Content-Type": "application/json",
  };
  if (config.notifyWebhookToken) {
    headers.Authorization = `Bearer ${config.notifyWebhookToken}`;
  }

  try {
    const response = await fetch(config.notifyWebhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Webhook HTTP ${response.status}`);
    }
  } catch (error) {
    log("warn", "external_notification_webhook_failed", {
      eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function sendResendEmail(subject, html, text) {
  if (
    !config.notifyResendApiKey ||
    !config.notifyEmailTo ||
    !config.notifyEmailFrom
  ) {
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.notifyResendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.notifyEmailFrom,
        to: [config.notifyEmailTo],
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend HTTP ${response.status}`);
    }
  } catch (error) {
    log("warn", "external_notification_email_failed", {
      subject,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function sendHuntSummaryNotification(userId, summary) {
  const subject = `[Hunter] Hunt ${summary.status}: ${summary.huntId}`;
  const text = [
    `Status: ${summary.status}`,
    `Hunt: ${summary.huntId}`,
    `Usuario: ${userId}`,
    `Vagas encontradas: ${summary.openingCount ?? 0}`,
    `Candidaturas criadas: ${summary.applicationCount ?? 0}`,
    `Interessantes: ${summary.interestingCount ?? 0}`,
    `Score failures: ${summary.scoreFailureCount ?? 0}`,
    `Score timeouts: ${summary.scoreTimeoutCount ?? 0}`,
    `Score bypass circuit: ${summary.scoreBypassedByCircuit ?? 0}`,
    `Search ms: ${summary.searchElapsedMs ?? 0}`,
    `Score ms: ${summary.scoreElapsedMs ?? 0}`,
  ].join("\n");

  const html = `
    <h2>Hunter - resumo da hunt</h2>
    <p><strong>Status:</strong> ${summary.status}</p>
    <p><strong>Hunt:</strong> ${summary.huntId}</p>
    <p><strong>Usuario:</strong> ${userId}</p>
    <ul>
      <li>Vagas encontradas: ${summary.openingCount ?? 0}</li>
      <li>Candidaturas criadas: ${summary.applicationCount ?? 0}</li>
      <li>Interessantes: ${summary.interestingCount ?? 0}</li>
      <li>Score failures: ${summary.scoreFailureCount ?? 0}</li>
      <li>Score timeouts: ${summary.scoreTimeoutCount ?? 0}</li>
      <li>Score bypass circuit: ${summary.scoreBypassedByCircuit ?? 0}</li>
      <li>Search ms: ${summary.searchElapsedMs ?? 0}</li>
      <li>Score ms: ${summary.scoreElapsedMs ?? 0}</li>
    </ul>
  `;

  await Promise.all([
    sendWebhookNotification(
      summary.status === "failed" ? "hunt_failed" : "hunt_completed",
      {
        userId,
        ...summary,
      },
    ),
    sendResendEmail(subject, html, text),
  ]);
}

function backoffMinutes(attempts) {
  const base = Math.max(1, Math.pow(2, attempts - 1));
  return Math.min(base, config.maxBackoffMinutes);
}

function normalizeOpeningUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

function normalizeToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function safeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function extractPromptKeywords(promptText, limit = 20) {
  const text = normalizeToken(promptText ?? "");
  if (!text) return [];

  const stopWords = new Set([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "em",
    "para",
    "com",
    "sem",
    "the",
    "and",
    "for",
    "with",
    "job",
    "vaga",
    "vagas",
    "perfil",
    "candidate",
    "candidato",
  ]);

  const counts = new Map();
  for (const token of text.split(/[^a-z0-9+#.]+/g)) {
    if (!token || token.length < 3) continue;
    if (stopWords.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function normalizeCriteriaSnapshot(snapshot) {
  const source =
    snapshot && typeof snapshot === "object" && snapshot.criteriaJson
      ? snapshot.criteriaJson
      : snapshot;

  const criteria = source && typeof source === "object" ? { ...source } : {};

  const promptKeywords = extractPromptKeywords(snapshot?.promptText ?? "");
  const existingKeywords = safeArray(criteria.keywords);
  const existingSkills = safeArray(criteria.skills);
  const existingJobTitles = safeArray(criteria.jobTitles);

  const mergedKeywords = [
    ...existingKeywords,
    ...existingSkills,
    ...existingJobTitles,
    ...promptKeywords,
  ].map((item) => normalizeToken(item));

  const uniqKeywords = [...new Set(mergedKeywords)]
    .filter(Boolean)
    .slice(0, 40);

  return {
    ...criteria,
    keywords: uniqKeywords,
    skills: [
      ...new Set(
        existingSkills.map((item) => normalizeToken(item)).filter(Boolean),
      ),
    ],
    jobTitles: [
      ...new Set(
        existingJobTitles.map((item) => normalizeToken(item)).filter(Boolean),
      ),
    ],
    targetCountries: safeArray(criteria.targetCountries).length
      ? safeArray(criteria.targetCountries)
      : ["BR"],
  };
}

function localHeuristicScore(opening, criteriaJson) {
  const haystack = normalizeToken(
    `${opening?.title ?? ""} ${opening?.description ?? ""}`,
  );

  const keywords = [
    ...(criteriaJson?.keywords ?? []),
    ...(criteriaJson?.skills ?? []),
    ...(criteriaJson?.jobTitles ?? []),
  ]
    .map((item) => normalizeToken(item))
    .filter(Boolean);

  if (!keywords.length) {
    return 55;
  }

  let hits = 0;
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) {
      hits++;
    }
  }

  const ratio = hits / Math.max(1, keywords.length);
  return Math.max(0, Math.min(100, Math.round(30 + ratio * 70)));
}

// Insere openings + applications na BD
async function persistHuntResults(
  huntId,
  userId,
  openings,
  onNotify = null,
  onProgress = null,
) {
  if (!openings || openings.length === 0) {
    return { applicationCount: 0, interestingCount: 0 };
  }

  let applicationCount = 0;
  let interestingCount = 0;

  let persisted = 0;
  let nextIndex = 0;
  const maxConcurrency = Math.max(
    1,
    Number(config.huntPersistConcurrency ?? 4),
  );

  const persistOne = async (idx) => {
    const openingRaw = openings[idx];
    const opening = toPersistableOpening(openingRaw, idx);
    const matchScore = Number(opening.matchScore ?? 0);
    const normalizedUrl = normalizeOpeningUrl(opening.url);

    const openingRows = await sql`
      insert into openings (
        external_id,
        platform,
        normalized_url,
        title,
        raw_payload
      )
      values (
        ${opening.externalId},
        ${opening.platform},
        ${normalizedUrl},
        ${opening.title},
        ${JSON.stringify(openingRaw ?? {})}
      )
      on conflict (platform, normalized_url)
      do update set
        title = excluded.title,
        raw_payload = excluded.raw_payload
      returning id;
    `;

    const openingId = openingRows[0]?.id;
    if (!openingId) {
      throw new Error("Falha ao obter openingId durante persistência.");
    }

    const appRows = await sql`
      insert into applications (
        user_id,
        hunt_id,
        opening_id,
        opening_url,
        source_url,
        status,
        match_score,
        notes
      )
      values (
        ${userId},
        ${huntId},
        ${openingId},
        ${normalizedUrl || opening.url || ""},
        ${opening.url || null},
        ${matchScore >= config.interestingMatchScore ? "shortlisted" : "suggested"},
        ${matchScore},
        ${null}
      )
      on conflict (user_id, opening_id, hunt_id)
      do nothing
      returning id;
    `;

    const isInteresting = matchScore >= config.interestingMatchScore;
    if (isInteresting) {
      interestingCount++;
      if (onNotify) {
        await onNotify("interesting_opening_found", {
          title: opening.title,
          platform: opening.platform,
          url: opening.url,
          matchScore,
          threshold: config.interestingMatchScore,
          message: `Vaga interessante encontrada: ${opening.title} (${matchScore})`,
        });
      }
    }

    if (appRows.length > 0) {
      applicationCount++;
      if (onNotify) {
        await onNotify("application_created", {
          openingId,
          title: opening.title,
          platform: opening.platform,
          url: opening.url,
          matchScore,
          message: `Nova candidatura criada: ${opening.title}`,
        });
      }
    }

    persisted++;
    if (onProgress) {
      await onProgress({
        phase: "persist_progress",
        persisted,
        totalToPersist: openings.length,
        applicationCount,
        interestingCount,
        message: `Persistindo resultados: ${persisted}/${openings.length} vagas processadas.`,
      });
    }
  };

  const workerLoop = async () => {
    while (nextIndex < openings.length) {
      const idx = nextIndex++;
      await persistOne(idx);
    }
  };

  const workers = Array.from({ length: maxConcurrency }, () => workerLoop());
  await Promise.all(workers);

  return { applicationCount, interestingCount };
}

/**
 * Executa hunt usando Provider Gateway directamente (Fase B)
 * Mais eficiente do que pelo MCP pois evita serialização JSON/IPC
 */
async function runDirectGatewayHunt(
  criteriaJson,
  onProgress = null,
  runContext = {},
) {
  try {
    const deadlineAt = Number(
      runContext.deadlineAt ?? nowMs() + config.huntMaxDurationMs,
    );
    const deadlineExceeded = () => nowMs() > deadlineAt;

    // 1. Busca via gateway
    const searchStartedAt = Date.now();
    if (onProgress) {
      await onProgress({
        phase: "search_started",
        message: "Executando busca via Provider Gateway...",
      });
      await onProgress({
        phase: "search_provider_hint",
        message:
          "Buscando vagas em LinkedIn, Nerdin, Greenhouse, Lever e GitHub...",
      });
    }

    const gatewaySearch = await gateway.search(
      {
        keywords: criteriaJson.keywords ?? [],
        location: criteriaJson.targetCountries?.[0] ?? "BR",
        filters: {
          keywords: criteriaJson.keywords ?? [],
          skills: criteriaJson.skills ?? [],
          jobTitles: criteriaJson.jobTitles ?? [],
          seniorityLevel: criteriaJson.seniorityLevel,
          workArrangement: criteriaJson.workArrangement,
          targetCountries: criteriaJson.targetCountries ?? ["BR"],
          excludedKeywords: criteriaJson.excludedKeywords ?? [],
          perPage: Number(criteriaJson.perPage ?? 25),
        },
      },
      deadlineAt,
    );

    const rawOpenings = gatewaySearch.openings || [];
    const searchElapsedMs = Date.now() - searchStartedAt;

    // 2. Deduplica
    const limitedOpenings = rawOpenings.slice(
      0,
      config.huntMaxOpeningsFromSearch,
    );
    const dedupedOpenings = dedupeOpeningsLocal(limitedOpenings);
    const openingsToScore = dedupedOpenings.slice(
      0,
      config.huntMaxOpeningsToScore,
    );

    if (onProgress) {
      await onProgress({
        phase: "search_done",
        message: `${rawOpenings.length} vagas encontradas, ${dedupedOpenings.length} após deduplicação.`,
        rawCount: rawOpenings.length,
        dedupedCount: dedupedOpenings.length,
        providers: gatewaySearch.meta.providers,
        totalProviderElapsedMs: gatewaySearch.meta.totalElapsedMs,
      });

      const previews = dedupedOpenings.slice(0, 5);
      for (const preview of previews) {
        await onProgress({
          phase: "opening_preview",
          title: String(preview?.title ?? "Vaga"),
          platform: String(preview?.platform ?? "plataforma"),
          message: `Vaga encontrada: ${String(preview?.title ?? "Vaga")} (${String(preview?.platform ?? "plataforma")}).`,
        });
      }
    }

    // 3. Score em concorrência com deadline
    if (onProgress) {
      await onProgress({
        phase: "score_started",
        message: `Iniciando pontuação de ${openingsToScore.length} vagas...`,
        totalToScore: openingsToScore.length,
      });
    }

    // 3. Score usando Scoring Engine (Fase C)
    if (onProgress) {
      await onProgress({
        phase: "score_started",
        message: `Iniciando pontuação com engine (${openingsToScore.length} vagas)...`,
        totalToScore: openingsToScore.length,
      });
    }

    const scoreStartedAt = Date.now();
    const scoreConcurrency = Math.max(1, config.huntScoreConcurrency);

    const scored = await scoreEngine.scoreMany(
      openingsToScore,
      criteriaJson,
      `user-${runContext.userId}-profile`,
      scoreConcurrency,
      async (progress) => {
        if (onProgress) {
          const totalToScore = Number(
            progress.totalToScore ?? progress.total ?? openingsToScore.length,
          );
          await onProgress({
            phase: "score_progress",
            processed: progress.processed,
            totalToScore,
            batchesCompleted: progress.batchesCompleted,
            totalBatches: progress.totalBatches,
            llmCandidates: progress.llmCandidates,
            heuristicOnlyCount: progress.heuristicOnlyCount,
            message: `Pontuação: ${progress.processed}/${totalToScore} vagas (batch ${progress.batchesCompleted}/${progress.totalBatches}).`,
          });
        }
      },
    );

    const scoreElapsedMs = Date.now() - scoreStartedAt;
    const scoreStats = scoreEngine.getStats();

    // 4. Classifica vagas por confiança (Fase D)
    if (onProgress) {
      await onProgress({
        phase: "classification_started",
        message: `Classificando ${scored.length} vagas para candidatura assistida...`,
      });
    }

    const classificationStartedAt = Date.now();
    const classified = appEngine.classifyMany(scored, criteriaJson, {
      autoApplyThreshold: criteriaJson.autoApplyThreshold ?? 75,
      reviewThreshold: criteriaJson.reviewThreshold ?? 50,
      allowedAutoApplySources: criteriaJson.allowedAutoApplySources ?? [
        "linkedin",
        "nerdin",
      ],
      excludedKeywords: criteriaJson.excludedKeywords ?? [],
    });

    const classificationElapsedMs = Date.now() - classificationStartedAt;
    const appStats = appEngine.getStats();

    // 5. Gera drafts para revisão
    if (onProgress) {
      await onProgress({
        phase: "drafts_generation",
        message: `Gerando candidaturas para revisão...`,
      });
    }

    const draftsGenerated = appEngine.generateDraftsForReview(
      classified,
      runContext.userId,
      criteriaJson,
    );

    if (onProgress) {
      await onProgress({
        phase: "classification_done",
        message: `Classificação concluída: ${appStats.autoApplyCandidates} auto-candidatas, ${appStats.reviewRecommended} para revisão, ${appStats.keepForLater} guardadas.`,
        autoApplyCandidates: appStats.autoApplyCandidates,
        reviewRecommended: appStats.reviewRecommended,
        keepForLater: appStats.keepForLater,
        draftsCreated: draftsGenerated.length,
      });
    }

    // 5.5 No schema atual não existe tabela de drafts; mantemos drafts em memória/eventos.
    const persistedDraftsCount = 0;
    const createdApplicationsCount = 0;
    if (draftsGenerated.length > 0 && onProgress) {
      await onProgress({
        phase: "drafts_ready_for_review",
        message: `${draftsGenerated.length} rascunhos prontos para revisão (não persistidos nesta etapa).`,
        draftsCreated: draftsGenerated.length,
      });
    }

    // 6. Ranqueia
    const rankedOpenings = [...scored].sort(
      (a, b) => Number(b?.matchScore ?? 0) - Number(a?.matchScore ?? 0),
    );

    const persistableOpenings = rankedOpenings.map((opening, idx) =>
      toPersistableOpening(opening, idx),
    );

    const trackingStats = trackingEngine.getStats();

    return {
      openings: persistableOpenings,
      drafts: draftsGenerated,
      metrics: {
        rawCount: rawOpenings.length,
        limitedCount: limitedOpenings.length,
        dedupedCount: dedupedOpenings.length,
        scoredCount: scored.length,
        rankedCount: rankedOpenings.length,
        rankFallbackUsed: false,
        scoreConcurrency,
        deadlineExceeded: deadlineExceeded(),
        searchElapsedMs,
        scoreElapsedMs,
        classificationElapsedMs,
        persistedDraftsCount,
        createdApplicationsCount,
        gatewayElapsedMs: gatewaySearch.meta.totalElapsedMs,
        providers: gatewaySearch.meta.providers,
        cacheHit: gatewaySearch.meta.cached ?? false,
        // Scoring engine stats
        scoreEngineCacheHitRate: scoreStats.cacheHitRate,
        scoreEngineGroqCalls: scoreStats.groqCalls,
        scoreEngineGroqErrors: scoreStats.groqErrors,
        scoreEngineHeuristicFallbacks: scoreStats.heuristicFallbacks,
        scoreEngineCacheSize: scoreStats.cacheSize,
        // Application engine stats
        autoApplyCandidates: appStats.autoApplyCandidates,
        reviewRecommended: appStats.reviewRecommended,
        keepForLater: appStats.keepForLater,
        draftsCreated: draftsGenerated.length,
        // Tracking engine stats (Phase 5)
        trackingTotalApplications: trackingStats.totalApplications,
        trackingSubmittedCount: trackingStats.submittedCount,
        trackingPendingCount: trackingStats.pendingCount,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "direct_gateway_hunt_failed", { error: message });
    throw error;
  }
}

async function runMcpHuntPipeline(
  criteriaJson,
  onProgress = null,
  runContext = {},
) {
  const mcp = new HunterMcpClient();
  await mcp.start();

  try {
    const deadlineAt = Number(
      runContext.deadlineAt ?? nowMs() + config.huntMaxDurationMs,
    );
    const deadlineExceeded = () => nowMs() > deadlineAt;

    const callToolWithRetry = async (
      toolName,
      args,
      phase,
      retries = config.mcpToolRetries,
      timeoutMs,
    ) => {
      let lastError = null;

      for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
          return await mcp.callTool(toolName, args, timeoutMs);
        } catch (error) {
          lastError = error;
          if (attempt > retries) {
            break;
          }
          await sleep(config.mcpToolRetryDelayMs * attempt);
        }
      }

      const msg =
        lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Falha em ${phase} (${toolName}): ${msg}`);
    };

    const searchStartedAt = Date.now();
    if (onProgress) {
      await onProgress({
        phase: "search_provider_hint",
        message:
          "Buscando vagas em múltiplas fontes (LinkedIn, Nerdin, Greenhouse, Lever e GitHub)...",
      });
    }

    const search = await callToolWithRetry(
      "search_openings",
      {
        filters: {
          keywords: criteriaJson.keywords ?? [],
          skills: criteriaJson.skills ?? [],
          jobTitles: criteriaJson.jobTitles ?? [],
          seniorityLevel: criteriaJson.seniorityLevel,
          workArrangement: criteriaJson.workArrangement,
          targetCountries: criteriaJson.targetCountries ?? ["BR"],
          excludedKeywords: criteriaJson.excludedKeywords ?? [],
          perPage: Number(criteriaJson.perPage ?? 25),
        },
      },
      "busca de vagas",
    );

    const rawOpenings = Array.isArray(search?.openings) ? search.openings : [];
    const searchMeta =
      search &&
      typeof search === "object" &&
      search.meta &&
      typeof search.meta === "object"
        ? search.meta
        : {};
    const searchProviders = Array.isArray(searchMeta.providers)
      ? searchMeta.providers
      : [];
    const searchCacheHit = Boolean(searchMeta.cached ?? false);
    const searchCacheHits = Number(searchMeta.cacheHits ?? 0);
    const searchElapsedMs = Date.now() - searchStartedAt;
    const searchTotalElapsedMs = Number(
      searchMeta.totalElapsedMs ?? searchElapsedMs,
    );
    const limitedOpenings = rawOpenings.slice(
      0,
      config.huntMaxOpeningsFromSearch,
    );
    const dedupedOpenings = dedupeOpeningsLocal(limitedOpenings);

    const openingsToScore = dedupedOpenings.slice(
      0,
      config.huntMaxOpeningsToScore,
    );

    if (onProgress) {
      await onProgress({
        phase: "search_done",
        message: `${rawOpenings.length} vagas encontradas, ${dedupedOpenings.length} após deduplicação.`,
        rawCount: rawOpenings.length,
        dedupedCount: dedupedOpenings.length,
        providers: searchProviders,
        cacheHit: searchCacheHit,
        cacheHits: searchCacheHits,
        totalProviderElapsedMs: searchTotalElapsedMs,
      });

      for (const provider of searchProviders) {
        const name = String(provider?.provider ?? "provider");
        const count = Number(provider?.count ?? 0);
        await onProgress({
          phase: "provider_summary",
          provider: name,
          count,
          message: `Busca em ${name}: ${count} vagas encontradas.`,
        });
      }

      const previews = dedupedOpenings.slice(0, 5);
      for (const preview of previews) {
        await onProgress({
          phase: "opening_preview",
          title: String(preview?.title ?? "Vaga"),
          platform: String(preview?.platform ?? "plataforma"),
          message: `Vaga encontrada: ${String(preview?.title ?? "Vaga")} (${String(preview?.platform ?? "plataforma")}).`,
        });
      }
    }

    if (onProgress) {
      await onProgress({
        phase: "score_started",
        message: `Iniciando pontuação de ${openingsToScore.length} vagas...`,
        totalToScore: openingsToScore.length,
      });
    }

    const scored = [];
    let scoreTimeoutCount = 0;
    let scoreFailureCount = 0;
    let scoreSkippedByDeadline = 0;
    let scoreBypassedByCircuit = 0;
    let consecutiveScoreTimeouts = 0;
    let scoreCircuitOpen = false;
    const scoreStartedAt = Date.now();
    let processed = 0;
    let nextIndex = 0;
    const maxConcurrency = Math.max(1, config.huntScoreConcurrency);
    let heartbeatTimer = null;

    const emitScoreProgress = async () => {
      if (!onProgress) return;
      if (
        processed === openingsToScore.length ||
        processed % Math.max(1, config.huntScoreProgressEvery) === 0
      ) {
        await onProgress({
          phase: "score_progress",
          processed,
          totalToScore: openingsToScore.length,
          scoreFailureCount,
          scoreTimeoutCount,
          scoreBypassedByCircuit,
          scoreSkippedByDeadline,
          message: `Pontuação em andamento: ${processed}/${openingsToScore.length} vagas processadas.`,
        });
      }
    };

    if (onProgress && openingsToScore.length > 0) {
      heartbeatTimer = setInterval(() => {
        void onProgress({
          phase: "score_heartbeat",
          processed,
          totalToScore: openingsToScore.length,
          scoreFailureCount,
          scoreTimeoutCount,
          scoreBypassedByCircuit,
          scoreSkippedByDeadline,
          elapsedMs: Date.now() - scoreStartedAt,
          message: `Score em execução: ${processed}/${openingsToScore.length} vagas processadas.`,
        });
      }, 10000);
    }

    const scoreOne = async (opening) => {
      if (scoreCircuitOpen) {
        scoreBypassedByCircuit++;
        const fallbackScore = localHeuristicScore(opening, criteriaJson);
        return {
          ...opening,
          matchScore: fallbackScore,
          scoreFallback: true,
          scoreFallbackSource: "local_heuristic",
          scoreCircuitOpen: true,
          scoreError: "score_circuit_open",
        };
      }

      try {
        const score = await callToolWithRetry(
          "score_opening_with_groq",
          {
            opening,
            profile: criteriaJson,
          },
          "pontuação",
          config.mcpScoreToolRetries,
          config.mcpScoreRequestTimeoutMs,
        );
        consecutiveScoreTimeouts = 0;
        return score;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.includes("MCP timeout");
        if (isTimeout) {
          scoreTimeoutCount++;
          consecutiveScoreTimeouts++;
          const threshold = Math.max(
            1,
            Number(config.mcpScoreCircuitBreakerTimeouts ?? 3),
          );
          if (consecutiveScoreTimeouts >= threshold) {
            scoreCircuitOpen = true;
          }
        } else {
          consecutiveScoreTimeouts = 0;
        }
        scoreFailureCount++;

        if (!config.huntScoreTimeoutContinue) {
          throw error;
        }

        const fallbackScore = localHeuristicScore(opening, criteriaJson);

        return {
          ...opening,
          matchScore: fallbackScore,
          scoreFallback: true,
          scoreError: message,
          scoreFallbackSource: "local_heuristic",
          scoreCircuitOpen,
        };
      }
    };

    const workerLoop = async () => {
      while (nextIndex < openingsToScore.length) {
        if (deadlineExceeded()) {
          const remaining = openingsToScore.length - nextIndex;
          scoreSkippedByDeadline += remaining;
          nextIndex = openingsToScore.length;
          break;
        }

        const idx = nextIndex++;
        const opening = openingsToScore[idx];
        const scoredOpening = await scoreOne(opening);
        scored.push(scoredOpening);
        processed++;

        if (onProgress) {
          await onProgress({
            phase: "score_item_done",
            processed,
            totalToScore: openingsToScore.length,
            title: String(opening?.title ?? "Vaga"),
            platform: String(opening?.platform ?? "plataforma"),
            matchScore: Number(scoredOpening?.matchScore ?? 0),
            scoreCircuitOpen: Boolean(scoredOpening?.scoreCircuitOpen ?? false),
            message: `Pontuada: ${String(opening?.title ?? "Vaga")} (${Number(scoredOpening?.matchScore ?? 0)}).`,
          });
        }

        await emitScoreProgress();
      }
    };

    const workers = Array.from({ length: maxConcurrency }, () => workerLoop());
    await Promise.all(workers);

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    const scoreElapsedMs = Date.now() - scoreStartedAt;

    let rankedOpenings = [];
    let rankFallbackUsed = false;
    let rankMode = "local";

    if (onProgress) {
      await onProgress({
        phase: "rank_started",
        rankedInputCount: scored.length,
        message: config.mcpRankEnabled
          ? `Ranqueando ${scored.length} vagas com MCP...`
          : `Ranqueando ${scored.length} vagas localmente...`,
      });
    }

    if (config.mcpRankEnabled) {
      try {
        const ranked = await callToolWithRetry(
          "rank_openings",
          {
            openings: scored,
          },
          "ranqueamento",
          config.mcpRankToolRetries,
          config.mcpRankRequestTimeoutMs,
        );

        rankedOpenings = Array.isArray(ranked?.openings) ? ranked.openings : [];
        rankMode = "mcp";
      } catch {
        rankFallbackUsed = true;
        rankedOpenings = [...scored].sort(
          (a, b) => Number(b?.matchScore ?? 0) - Number(a?.matchScore ?? 0),
        );
      }
    } else {
      rankFallbackUsed = true;
      rankedOpenings = [...scored].sort(
        (a, b) => Number(b?.matchScore ?? 0) - Number(a?.matchScore ?? 0),
      );
    }

    if (onProgress) {
      await onProgress({
        phase: "rank_done",
        rankedCount: rankedOpenings.length,
        rankMode,
        rankFallbackUsed,
        message: `Ranqueamento concluído (${rankMode}): ${rankedOpenings.length} vagas ordenadas.`,
      });
    }

    const persistableOpenings = rankedOpenings.map((opening, idx) =>
      toPersistableOpening(opening, idx),
    );

    return {
      openings: persistableOpenings,
      metrics: {
        rawCount: rawOpenings.length,
        limitedCount: limitedOpenings.length,
        dedupedCount: dedupedOpenings.length,
        scoredCount: scored.length,
        scoreFailureCount,
        scoreTimeoutCount,
        scoreBypassedByCircuit,
        scoreSkippedByDeadline,
        rankedCount: rankedOpenings.length,
        rankMode,
        rankFallbackUsed,
        scoreConcurrency: maxConcurrency,
        deadlineExceeded: deadlineExceeded(),
        searchElapsedMs,
        scoreElapsedMs,
        providers: searchProviders,
        cacheHit: searchCacheHit,
        cacheHits: searchCacheHits,
        totalProviderElapsedMs: searchTotalElapsedMs,
      },
    };
  } finally {
    await mcp.stop();
  }
}

async function claimNextJob() {
  const rows = await sql`
    with picked as (
      select id
      from jobs
      where status = 'queued'
        and run_after <= now()
      order by created_at asc
      for update skip locked
      limit 1
    )
    update jobs j
    set
      status = 'processing',
      attempts = j.attempts + 1,
      updated_at = now(),
      last_error = null
    from picked
    where j.id = picked.id
    returning j.id, j.type, j.user_id as "userId", j.payload, j.attempts, j.max_attempts as "maxAttempts";
  `;

  return rows[0] ?? null;
}

async function emitHuntEvent(huntId, userId, eventType, payload = {}) {
  await sql`
    insert into hunt_events (hunt_id, user_id, event_type, payload)
    values (${huntId}, ${userId}, ${eventType}, ${payload});
  `;
}

async function assertHuntNotCancelled(huntId, userId) {
  const rows = await sql`
    select status
    from hunts
    where id = ${huntId}
      and user_id = ${userId}
    limit 1;
  `;

  const status = rows?.[0]?.status;
  if (status === "cancelled") {
    throw new HuntCancelledError(
      "Caçada cancelada manualmente pelo utilizador.",
    );
  }
}

async function markJobDone(jobId) {
  await sql`
    update jobs
    set status = 'done', updated_at = now(), last_error = null
    where id = ${jobId};
  `;
}

async function markJobFailed(job, errorMessage) {
  const attempts = Number(job.attempts ?? 1);
  const maxAttempts = Number(job.maxAttempts ?? 3);

  if (attempts >= maxAttempts) {
    await sql`
      update jobs
      set
        status = 'dead',
        updated_at = now(),
        last_error = ${errorMessage}
      where id = ${job.id};
    `;
    return "dead";
  }

  const minutes = backoffMinutes(attempts);
  await sql`
    update jobs
    set
      status = 'queued',
      run_after = now() + (${minutes} * interval '1 minute'),
      updated_at = now(),
      last_error = ${errorMessage}
    where id = ${job.id};
  `;
  return "queued";
}

async function processRunHunt(job) {
  const huntId = job.payload?.huntId;
  const strategyId = job.payload?.strategyId;
  if (!huntId) {
    throw new Error("payload.huntId ausente no job run_hunt");
  }

  // 1. Carregar hunt + strategy snapshot
  const huntRow = await sql`
    select id, user_id, status, strategy_snapshot_json
    from hunts
    where id = ${huntId}
      and user_id = ${job.userId}
    limit 1;
  `;

  if (!huntRow || huntRow.length === 0) {
    throw new Error(`Hunt ${huntId} não encontrada`);
  }

  const hunt = huntRow[0];
  if (hunt.status === "cancelled") {
    throw new HuntCancelledError(
      "Caçada já estava cancelada antes da execução.",
    );
  }

  const strategySnapshot =
    hunt.strategy_snapshot_json ||
    (strategyId
      ? (
          await sql`
      select criteria_json from strategies
      where id = ${strategyId} and user_id = ${job.userId}
      limit 1;
    `
        )[0]?.criteria_json
      : null);

  if (!strategySnapshot) {
    throw new Error(
      `Strategy snapshot ausente em hunt ${huntId} ou estratégia não existe`,
    );
  }

  const normalizedCriteria = normalizeCriteriaSnapshot(strategySnapshot);

  // 2. Atualizar hunt status para running
  const startedRows = await sql`
    update hunts
    set
      status = 'running',
      started_at = coalesce(started_at, now()),
      finished_at = null,
      error_message = null
    where id = ${huntId}
      and user_id = ${job.userId}
      and status <> 'cancelled'
    returning id;
  `;

  if (!startedRows[0]) {
    throw new HuntCancelledError(
      "Caçada cancelada antes de iniciar o processamento.",
    );
  }

  await emitHuntEvent(huntId, job.userId, "hunt_started", {
    jobId: job.id,
    strategyId: strategyId,
  });

  const runStartedAt = nowMs();
  const deadlineAt = runStartedAt + config.huntMaxDurationMs;
  let heartbeatTimer = null;
  let currentPhase = "pipeline_setup";

  try {
    // 3. Iniciar pipeline MCP
    await emitHuntEvent(huntId, job.userId, "hunt_progress", {
      phase: "pipeline_setup",
      message: "Preparando pipeline de busca...",
      criteriaSummary: {
        keywords: Number(normalizedCriteria.keywords?.length ?? 0),
        skills: Number(normalizedCriteria.skills?.length ?? 0),
        jobTitles: Number(normalizedCriteria.jobTitles?.length ?? 0),
        countries: Number(normalizedCriteria.targetCountries?.length ?? 0),
      },
    });
    currentPhase = "pipeline_setup";

    heartbeatTimer = setInterval(() => {
      void emitHuntEvent(huntId, job.userId, "hunt_progress", {
        phase: "pipeline_heartbeat",
        currentPhase,
        elapsedMs: nowMs() - runStartedAt,
        message: `Pipeline em execução (${currentPhase}).`,
      });
    }, 8000);

    log("info", "mcp_hunt_start", { huntId, attemptedProvider: "mcp" });

    await emitHuntEvent(huntId, job.userId, "hunt_progress", {
      phase: "search_started",
      message: "Executando busca de vagas com Hunter MCP...",
    });
    currentPhase = "search_started";

    await assertHuntNotCancelled(huntId, job.userId);

    const pipelineMode =
      config.huntPipelineMode === "mcp" ? "mcp" : "direct_gateway";
    const huntRunner =
      pipelineMode === "direct_gateway"
        ? runDirectGatewayHunt
        : runMcpHuntPipeline;

    const {
      openings,
      metrics,
      drafts: pipelineDrafts = [],
    } = await huntRunner(
      normalizedCriteria,
      async (progressPayload) => {
        if (
          progressPayload &&
          typeof progressPayload.phase === "string" &&
          progressPayload.phase.trim()
        ) {
          currentPhase = progressPayload.phase;
        }
        await emitHuntEvent(
          huntId,
          job.userId,
          "hunt_progress",
          progressPayload,
        );
      },
      {
        deadlineAt,
      },
    );

    const classified = appEngine.classifyMany(openings, normalizedCriteria, {
      autoApplyThreshold: Number(normalizedCriteria.autoApplyThreshold ?? 85),
      reviewThreshold: Number(normalizedCriteria.reviewThreshold ?? 70),
      allowedAutoApplySources: Array.isArray(
        normalizedCriteria.allowedAutoApplySources,
      )
        ? normalizedCriteria.allowedAutoApplySources
        : ["linkedin", "greenhouse", "lever"],
      excludedKeywords: Array.isArray(normalizedCriteria.excludedKeywords)
        ? normalizedCriteria.excludedKeywords
        : [],
    });

    const generatedDrafts = appEngine.generateDraftsForReview(
      classified,
      job.userId,
      normalizedCriteria,
    );
    const autoApplyCandidates = classified.filter(
      (item) => item.classification.class === "auto_apply_candidate",
    ).length;
    const drafts = [...pipelineDrafts, ...generatedDrafts];

    await assertHuntNotCancelled(huntId, job.userId);

    await emitHuntEvent(huntId, job.userId, "hunt_progress", {
      phase: "mcp_pipeline_done",
      message: `Busca concluída (${pipelineMode}): ${metrics.rawCount} encontradas, ${metrics.dedupedCount} após deduplicação local, ${metrics.scoredCount} pontuadas.`,
      pipelineMode,
      draftsCount: drafts.length,
      autoApplyCandidates,
      ...metrics,
    });
    currentPhase = "mcp_pipeline_done";

    await emitHuntEvent(huntId, job.userId, "hunt_progress", {
      phase: "application_plan_ready",
      message: `Plano de candidatura: ${autoApplyCandidates} auto apply candidatas e ${drafts.length} para revisão.`,
      autoApplyCandidates,
      draftsCount: drafts.length,
    });

    if (Number(metrics.scoreFailureCount ?? 0) > 0) {
      await emitHuntEvent(huntId, job.userId, "hunt_warning", {
        source: "score_opening_with_groq",
        scoreFailureCount: metrics.scoreFailureCount,
        scoreTimeoutCount: metrics.scoreTimeoutCount,
        message: `Pontuação parcial: ${metrics.scoreFailureCount} vagas usaram fallback (${metrics.scoreTimeoutCount} timeout).`,
      });
    }

    if (Number(metrics.scoreBypassedByCircuit ?? 0) > 0) {
      await emitHuntEvent(huntId, job.userId, "hunt_warning", {
        source: "score_circuit_breaker",
        scoreBypassedByCircuit: Number(metrics.scoreBypassedByCircuit ?? 0),
        message: `Proteção de score ativada: ${Number(metrics.scoreBypassedByCircuit ?? 0)} vagas processadas com fallback local para reduzir latência.`,
      });
    }

    if (metrics.rankFallbackUsed) {
      await emitHuntEvent(huntId, job.userId, "hunt_warning", {
        source: "rank_openings",
        rankFallbackUsed: true,
        message:
          "Ranqueamento local aplicado devido a falha temporária no MCP.",
      });
    }

    if (metrics.deadlineExceeded) {
      await emitHuntEvent(huntId, job.userId, "hunt_warning", {
        source: "hunt_deadline",
        deadlineMs: config.huntMaxDurationMs,
        scoreSkippedByDeadline: metrics.scoreSkippedByDeadline,
        message:
          "Tempo máximo da hunt atingido; execução finalizada com resultados parciais.",
      });
    }

    log("info", "mcp_hunt_success", {
      huntId,
      openingCount: openings.length,
      mcpToolRetries: config.mcpToolRetries,
      maxOpeningsToScore: config.huntMaxOpeningsToScore,
      maxOpeningsFromSearch: config.huntMaxOpeningsFromSearch,
      ...metrics,
    });

    // 6. Persistir resultados
    await emitHuntEvent(huntId, job.userId, "hunt_progress", {
      phase: "persist_started",
      message: `Persistindo ${openings.length} vagas e criando candidaturas...`,
      totalToPersist: openings.length,
    });
    currentPhase = "persist_started";

    const { applicationCount, interestingCount } = await persistHuntResults(
      huntId,
      job.userId,
      openings,
      async (eventType, payload) => {
        await emitHuntEvent(huntId, job.userId, eventType, payload);
      },
      async (progressPayload) => {
        currentPhase = "persist_progress";
        const every = Math.max(1, Number(config.huntScoreProgressEvery ?? 5));
        const persisted = Number(progressPayload?.persisted ?? 0);
        const totalToPersist = Number(progressPayload?.totalToPersist ?? 0);

        if (persisted === totalToPersist || persisted % every === 0) {
          await emitHuntEvent(huntId, job.userId, "hunt_progress", {
            ...progressPayload,
          });
        }
      },
    );

    await emitHuntEvent(huntId, job.userId, "hunt_progress", {
      phase: "persist_done",
      message: `Encontradas ${openings.length} vagas, ${interestingCount} interessantes e ${applicationCount} novas aplicações criadas.`,
      openingCount: openings.length,
      interestingCount,
      applicationCount,
    });
    currentPhase = "persist_done";

    let autoApplySummary = {
      enabled: false,
      dryRun: false,
      totalCandidates: 0,
      submittedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };

    if (config.autoApplyEnabled) {
      await emitHuntEvent(huntId, job.userId, "hunt_progress", {
        phase: "auto_apply_started",
        message: config.autoApplyDryRun
          ? "Auto-apply em modo simulação (dry run)."
          : "Auto-apply em execução.",
        dryRun: config.autoApplyDryRun,
      });

      const autoApplyResult = await runTier3AutoSubmit(job.userId, {
        huntId,
        autoApplyThreshold: config.autoApplyThreshold,
        allowedAutoApplySources: config.autoApplyAllowedSources,
        dryRun: config.autoApplyDryRun,
        maxSubmissions: config.autoApplyMaxSubmissions,
        onEvent: async (phase, payload) => {
          await emitHuntEvent(huntId, job.userId, "hunt_progress", {
            phase,
            ...payload,
          });
        },
      });

      autoApplySummary = {
        enabled: true,
        dryRun: Boolean(autoApplyResult?.dryRun ?? false),
        totalCandidates: Number(autoApplyResult?.totalCandidates ?? 0),
        submittedCount: Number(autoApplyResult?.submittedCount ?? 0),
        skippedCount: Number(autoApplyResult?.skippedCount ?? 0),
        failedCount: Number(autoApplyResult?.failedCount ?? 0),
      };

      await emitHuntEvent(huntId, job.userId, "auto_apply_completed", {
        message: `Auto-apply finalizado: ${autoApplySummary.submittedCount} enviadas, ${autoApplySummary.skippedCount} ignoradas, ${autoApplySummary.failedCount} falhas.`,
        ...autoApplySummary,
      });
    }

    // 7. Atualizar hunt para completed
    await sql`
      update hunts
      set
        status = 'completed',
        finished_at = now(),
        error_message = null
      where id = ${huntId}
        and user_id = ${job.userId};
    `;

    await emitHuntEvent(huntId, job.userId, "hunt_completed", {
      jobId: job.id,
      pipelineMode,
      draftsCount: drafts.length,
      openingCount: openings.length,
      interestingCount,
      applicationCount,
      autoApply: autoApplySummary,
    });

    await emitHuntEvent(huntId, job.userId, "hunt_stopped", {
      reason: "completed",
      openingCount: openings.length,
      interestingCount,
      applicationCount,
      message: "Caçada concluída.",
    });

    log("info", "hunt_completed", {
      huntId,
      openingCount: openings.length,
      interestingCount,
      applicationCount,
      autoApply: autoApplySummary,
    });

    await sendHuntSummaryNotification(job.userId, {
      status: "completed",
      huntId,
      openingCount: openings.length,
      interestingCount,
      applicationCount,
      scoreFailureCount: Number(metrics.scoreFailureCount ?? 0),
      scoreTimeoutCount: Number(metrics.scoreTimeoutCount ?? 0),
      scoreBypassedByCircuit: Number(metrics.scoreBypassedByCircuit ?? 0),
      searchElapsedMs: Number(metrics.searchElapsedMs ?? 0),
      scoreElapsedMs: Number(metrics.scoreElapsedMs ?? 0),
      autoApply: autoApplySummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitHuntEvent(huntId, job.userId, "hunt_warning", {
      message,
      source: "worker_pipeline",
    });
    log("error", "hunt_processing_failed", { huntId, error: message });

    await sendHuntSummaryNotification(job.userId, {
      status: "failed",
      huntId,
      openingCount: 0,
      interestingCount: 0,
      applicationCount: 0,
      scoreFailureCount: 0,
      scoreTimeoutCount: 0,
      scoreBypassedByCircuit: 0,
      searchElapsedMs: 0,
      scoreElapsedMs: 0,
      error: message,
    });

    throw error; // Deixar processJob lidar com o erro
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }
}

async function processJob(job) {
  log("info", "job_claimed", {
    jobId: job.id,
    type: job.type,
    userId: job.userId,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
  });

  try {
    if (job.type === "run_hunt") {
      await processRunHunt(job);
    } else {
      throw new Error(`tipo de job nao suportado: ${job.type}`);
    }

    await markJobDone(job.id);
    log("info", "job_done", { jobId: job.id, type: job.type });
  } catch (error) {
    if (error instanceof HuntCancelledError) {
      const huntId = job.payload?.huntId;
      if (huntId) {
        await emitHuntEvent(huntId, job.userId, "hunt_stopped", {
          reason: "cancelled",
          message: error.message,
        });
      }

      await markJobDone(job.id);
      log("info", "job_cancelled", {
        jobId: job.id,
        type: job.type,
        reason: error.message,
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);

    const huntId = job.payload?.huntId;
    if (huntId) {
      await sql`
        update hunts
        set
          status = 'failed',
          finished_at = now(),
          error_message = ${message}
        where id = ${huntId}
          and user_id = ${job.userId};
      `;

      await emitHuntEvent(huntId, job.userId, "hunt_failed", {
        jobId: job.id,
        error: message,
      });

      await emitHuntEvent(huntId, job.userId, "hunt_stopped", {
        reason: "failed",
        error: message,
        message: "Caçada interrompida por falha.",
      });
    }

    const nextStatus = await markJobFailed(job, message);
    log("error", "job_failed", {
      jobId: job.id,
      type: job.type,
      nextStatus,
      error: message,
    });
  }
}

// ============= TIER 2: APPLICATION SUBMISSION =============

/**
 * Tier 2: Submit application depois que usuário revisa
 * Workflow: Draft → User Revisa → Clica "Enviar" → Application criada + rastreada + enviada
 */
async function submitApplicationTier2(draftId, userId, editedFields = null) {
  const applicationId = draftId;
  try {
    const rows = await sql`
      select
        a.id,
        a.user_id,
        a.opening_id,
        a.opening_url,
        a.source_url,
        a.match_score,
        o.title as opening_title,
        o.platform as opening_platform,
        o.raw_payload as opening_raw_payload
      from applications a
      join openings o on o.id = a.opening_id
      where a.id = ${applicationId}
        and a.user_id = ${userId}
      limit 1;
    `;

    if (!rows.length) {
      return { success: false, error: "Application não encontrada" };
    }

    const appRow = rows[0];
    const finalFields = { ...(editedFields || {}) };

    const application = {
      id: appRow.id,
      userId,
      openingId: appRow.opening_id,
      openingTitle: appRow.opening_title || "Vaga",
      openingUrl: appRow.opening_url,
      openingSource: appRow.opening_platform,
      submittedFields: finalFields,
      matchScore: appRow.match_score,
    };

    const tracked = trackingEngine.createApplication(
      applicationId,
      userId,
      {
        id: application.openingId,
        title: application.openingTitle,
        url: application.openingUrl,
        platform: application.openingSource,
      },
      finalFields,
      "user",
    );

    const submission = await submissionEngine.submitApplication(
      application,
      userId,
      { email: finalFields.email, targetEmail: null },
    );

    await sql`
      update applications
      set
        status = ${submission.success ? "applied" : "failed"},
        applied_at = ${submission.success ? new Date().toISOString() : null},
        notes = ${JSON.stringify({
          submissionMethod: submission.submission?.method ?? null,
          submittedBy: "user",
          submittedAt: new Date().toISOString(),
          submittedFields: finalFields,
          error: submission.success ? null : submission.error,
        })},
        updated_at = now()
      where id = ${applicationId}
        and user_id = ${userId};
    `;

    if (submission.success) {
      trackingEngine.updateApplicationStatus(
        tracked.id,
        "pending",
        userId,
        "Aplicação enviada via Tier 2",
      );
    }

    log("info", "tier2_submission_success", {
      applicationId: application.id,
      openingTitle: application.openingTitle,
      submissionMethod: submission.submissionId ? "api" : "email",
    });

    return {
      success: submission.success,
      application: tracked,
      submission,
      message: submission.success
        ? `Aplicação enviada com sucesso: ${application.openingTitle}`
        : `Falha ao enviar aplicação: ${application.openingTitle}`,
      error: submission.success ? null : submission.error,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", "tier2_submission_error", {
      applicationId,
      userId,
      error: msg,
    });
    return { success: false, error: msg };
  }
}

/**
 * Tier 2: Get applications para usuário (com filtros opcionais)
 */
async function getApplicationsForUser(userId, filters = {}) {
  try {
    const applications = trackingEngine.getApplications(userId, filters);

    return {
      success: true,
      applications,
      metrics: trackingEngine.getMetrics(userId),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", "get_applications_error", {
      userId,
      error: msg,
    });

    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Tier 2: Get follow-up reminders (aplicações aguardando resposta há 7+ dias)
 */
async function getFollowupRemindersForUser(userId) {
  try {
    const reminders = trackingEngine.getFollowupReminders(userId);

    return {
      success: true,
      reminders,
      count: reminders.length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", "get_followup_reminders_error", {
      userId,
      error: msg,
    });

    return {
      success: false,
      error: msg,
    };
  }
}

// ============= END TIER 2 =============

// ============= TIER 3: AUTO-SUBMIT =============

function tokenizeForAts(text) {
  const stopWords = new Set([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "em",
    "para",
    "com",
    "sem",
    "que",
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "por",
    "uma",
    "um",
  ]);

  return normalizeToken(text)
    .split(/[^a-z0-9+#.]+/g)
    .filter((token) => token.length >= 3)
    .filter((token) => !stopWords.has(token));
}

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function llmProviderOrder() {
  const preferred = String(process.env.LLM_PROVIDER ?? "groq").toLowerCase();
  const base = [preferred, "groq", "gemini", "openai"];
  return [...new Set(base)].filter((name) =>
    ["groq", "gemini", "openai"].includes(name),
  );
}

async function callGroqForTailoredResume(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY ausente");
  }
  const model = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1800,
        messages: [
          {
            role: "system",
            content:
              "Voce e um especialista ATS. Reescreva curriculo sem inventar experiencias, sem mentir, e sem adicionar habilidades nao comprovadas no texto original.",
          },
          { role: "user", content: prompt },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Groq HTTP ${response.status}`);
  }
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

async function callOpenAiForTailoredResume(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ausente");
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content:
            "Voce e um especialista ATS. Reescreva curriculo sem inventar experiencias, sem mentir, e sem adicionar habilidades nao comprovadas no texto original.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI HTTP ${response.status}`);
  }
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

async function callGeminiForTailoredResume(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY ausente");
  }
  const model = "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1800,
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini HTTP ${response.status}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => String(part?.text ?? ""))
    .join("\n")
    .trim();
  return String(text ?? "");
}

async function buildAtsTailoredResumeWithLlm(
  opening,
  resumeText,
  profile,
  maxChars = 6000,
) {
  const rawResume = String(resumeText ?? "").trim();
  if (!rawResume) {
    return {
      resume: "Curriculo indisponivel",
      provider: "none",
      model: "none",
      usedLlm: false,
      error: "resume_vazio",
    };
  }

  const prompt = [
    "Objetivo: reestruturar curriculo para ATS da vaga sem mentir.",
    "Regras obrigatorias:",
    "1) Nao inventar experiencia, certificacao, formacao, projeto, numero, cargo, empresa ou habilidade.",
    "2) Usar somente fatos presentes no CV original.",
    "3) Reordenar e destacar termos aderentes a vaga para ATS.",
    "4) Saida em texto puro em pt-BR com secoes: RESUMO, SKILLS, EXPERIENCIA RELEVANTE, PROJETOS/IMPACTO, EDUCACAO.",
    "5) Ser objetivo e escaneavel.",
    "",
    `Vaga titulo: ${String(opening?.title ?? "")}`,
    `Vaga empresa/plataforma: ${String(opening?.companyName ?? "")}`,
    `Vaga descricao: ${String(opening?.description ?? "").slice(0, 5000)}`,
    `Candidato: ${String(profile?.display_name ?? profile?.email ?? "")}`,
    "",
    "CV original (fonte unica de verdade):",
    rawResume,
  ].join("\n");

  const providers = llmProviderOrder();
  let lastError = "";

  for (const provider of providers) {
    try {
      let output = "";
      if (provider === "groq") {
        output = await callGroqForTailoredResume(prompt);
      } else if (provider === "gemini") {
        output = await callGeminiForTailoredResume(prompt);
      } else if (provider === "openai") {
        output = await callOpenAiForTailoredResume(prompt);
      }

      const clean = String(output ?? "").trim();
      if (!clean) {
        throw new Error("saida_vazia");
      }

      return {
        resume: clean.slice(0, maxChars),
        provider,
        model:
          provider === "groq"
            ? (process.env.GROQ_MODEL ?? "llama-3.1-8b-instant")
            : provider,
        usedLlm: true,
        error: null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      log("warn", "ats_tailor_llm_provider_failed", {
        provider,
        error: lastError,
      });
    }
  }

  return {
    resume: buildAtsTailoredResume(opening, rawResume, profile, maxChars),
    provider: "heuristic",
    model: "heuristic",
    usedLlm: false,
    error: lastError || "llm_indisponivel",
  };
}

async function renderTailoredResumePdfBuffer(application, tailoredResumeText) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 48,
      });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("error", reject);
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      doc.fontSize(16).text("Curriculo ajustado para vaga (ATS)", {
        align: "left",
      });
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .fillColor("#555")
        .text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);
      doc.text(`Vaga: ${String(application?.openingTitle ?? "")}`);
      doc.text(`Fonte: ${String(application?.openingSource ?? "")}`);
      doc.moveDown(1);
      doc.fillColor("#000").fontSize(11).text(tailoredResumeText, {
        align: "left",
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function uploadTailoredResumePdf(userId, applicationId, pdfBuffer) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return {
      storagePath: null,
      uploaded: false,
      error: "supabase_nao_configurado",
    };
  }

  const bucket = process.env.CV_STORAGE_BUCKET || "cvs";
  const storagePath = `${userId}/tailored/${applicationId}-${Date.now()}.pdf`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (error) {
    return { storagePath: null, uploaded: false, error: error.message };
  }

  return { storagePath, uploaded: true, error: null };
}

function buildAtsTailoredResume(opening, resumeText, profile, maxChars = 6000) {
  const rawResume = String(resumeText ?? "").trim();
  if (!rawResume) {
    return "Curriculo indisponivel";
  }

  const lines = rawResume
    .split(/\r?\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const cvLines =
    lines.length > 0
      ? lines
      : rawResume
          .split(/[.!?]\s+/g)
          .map((line) => line.trim())
          .filter(Boolean);

  const jobTokens = tokenizeForAts(
    `${opening?.title ?? ""} ${opening?.description ?? ""} ${opening?.companyName ?? ""}`,
  );
  const jobTokenSet = new Set(jobTokens);

  const scoredLines = cvLines
    .map((line) => {
      const tokens = tokenizeForAts(line);
      const overlap = tokens.filter((token) => jobTokenSet.has(token));
      return {
        line,
        score: overlap.length,
      };
    })
    .sort((a, b) => b.score - a.score);

  const relevantLines = scoredLines
    .filter((item) => item.score > 0)
    .slice(0, 18)
    .map((item) => item.line);

  const fallbackLines = cvLines.slice(0, 12);
  const chosenLines = relevantLines.length ? relevantLines : fallbackLines;

  const resumeTokens = new Set(tokenizeForAts(rawResume));
  const matchedSkills = [...new Set(jobTokens)]
    .filter((token) => resumeTokens.has(token))
    .slice(0, 20);

  const sections = [
    "CURRICULO OTIMIZADO PARA ATS (sem inventar experiencia)",
    `Vaga alvo: ${String(opening?.title ?? "Vaga")}`,
    profile?.display_name ? `Candidato: ${String(profile.display_name)}` : null,
    matchedSkills.length
      ? `Habilidades aderentes extraidas do CV: ${matchedSkills.join(", ")}`
      : null,
    "Experiencias e entregas mais aderentes (trechos do CV original):",
    ...chosenLines.map((line) => `- ${line}`),
  ].filter(Boolean);

  const tailored = sections.join("\n");
  if (tailored.length <= maxChars) {
    return tailored;
  }
  return tailored.slice(0, maxChars);
}

/**
 * Tier 3: Auto-submit de candidaturas de alta confiança
 * Guardrails:
 *  - score >= autoApplyThreshold
 *  - source em allowedAutoApplySources
 *  - sem excludedKeywords
 */
async function runTier3AutoSubmit(userId, options = {}) {
  const {
    huntId = null,
    autoApplyThreshold = 75,
    allowedAutoApplySources = ["nerdin", "github"],
    dryRun = false,
    maxSubmissions = 20,
    onEvent = null,
  } = options;

  try {
    const profileRows = await sql`
      select user_id, email, display_name
      from profiles
      where user_id = ${userId}
      limit 1;
    `;
    const profile = profileRows[0] ?? null;

    const latestCvRows = await sql`
      select extracted_text
      from cvs
      where user_id = ${userId}
      order by created_at desc
      limit 1;
    `;
    const resumeText = String(latestCvRows[0]?.extracted_text ?? "").trim();

    // Busca applications elegíveis no schema atual
    const candidates = await sql`
      select
        a.id,
        a.user_id,
        a.opening_id,
        a.opening_url,
        a.source_url,
        a.match_score,
        o.title as opening_title,
        o.platform as opening_platform
      from applications a
      join openings o on o.id = a.opening_id
      where a.user_id = ${userId}
        ${huntId ? sql`and a.hunt_id = ${huntId}` : sql``}
        and a.status in ('shortlisted', 'suggested')
      order by a.match_score desc nulls last
      limit ${maxSubmissions};
    `;

    const results = [];
    let submittedCount = 0;
    let skippedCount = 0;

    for (const candidate of candidates) {
      const source = String(candidate.opening_platform || "").toLowerCase();
      const score = Number(candidate.match_score || 0);

      // Guardrails
      const eligibleByScore = score >= autoApplyThreshold;
      const eligibleBySource = allowedAutoApplySources.includes(source);

      if (!eligibleByScore || !eligibleBySource) {
        skippedCount++;
        if (onEvent) {
          await onEvent("auto_apply_item", {
            applicationId: candidate.id,
            status: "skipped",
            source,
            score,
            reason: !eligibleByScore
              ? `score ${score} abaixo do threshold ${autoApplyThreshold}`
              : `source ${source} não permitida`,
          });
        }
        results.push({
          applicationId: candidate.id,
          status: "skipped",
          reason: !eligibleByScore
            ? `score ${score} abaixo do threshold ${autoApplyThreshold}`
            : `source ${source} não permitida`,
        });
        continue;
      }

      if (dryRun) {
        if (onEvent) {
          await onEvent("auto_apply_item", {
            applicationId: candidate.id,
            status: "dry_run_eligible",
            source,
            score,
          });
        }
        results.push({
          applicationId: candidate.id,
          status: "dry_run_eligible",
          source,
          score,
        });
        continue;
      }

      // Cria application para auto-submit
      const application = {
        id: candidate.id,
        userId,
        openingId: candidate.opening_id,
        openingTitle: candidate.opening_title || "Vaga",
        openingUrl: candidate.opening_url,
        openingSource: source,
        submittedFields: {
          email: profile?.email || "",
          name: profile?.display_name || profile?.email || "Candidato",
          resume: "",
          resumePdfPath: null,
          message: "Candidatura enviada automaticamente pelo Hunter.",
        },
      };

      const openingForTailor = {
        title: candidate.opening_title,
        description: String(
          candidate?.opening_raw_payload?.description ??
            candidate?.opening_raw_payload?.metadata?.description ??
            "",
        ),
        companyName: candidate.opening_platform,
      };

      const tailored = config.atsTailorResumeEnabled
        ? await buildAtsTailoredResumeWithLlm(
            openingForTailor,
            resumeText,
            profile,
            config.atsTailorResumeMaxChars,
          )
        : {
            resume: resumeText || "Curriculo indisponivel",
            provider: "disabled",
            model: "disabled",
            usedLlm: false,
            error: null,
          };

      application.submittedFields.resume = tailored.resume;

      let tailoredPdfMeta = {
        uploaded: false,
        storagePath: null,
        error: null,
      };

      try {
        const tailoredPdf = await renderTailoredResumePdfBuffer(
          application,
          tailored.resume,
        );
        tailoredPdfMeta = await uploadTailoredResumePdf(
          userId,
          String(candidate.id),
          tailoredPdf,
        );
        application.submittedFields.resumePdfPath = tailoredPdfMeta.storagePath;
      } catch (error) {
        tailoredPdfMeta = {
          uploaded: false,
          storagePath: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      await sql`
        update applications
        set status = 'applying', updated_at = now()
        where id = ${candidate.id}
          and user_id = ${userId};
      `;

      // Tracking
      const tracked = trackingEngine.createApplication(
        candidate.id,
        userId,
        {
          id: application.openingId,
          title: application.openingTitle,
          url: application.openingUrl,
          platform: application.openingSource,
        },
        application.submittedFields,
        "tier3_auto",
      );

      // Submit
      const submission = await submissionEngine.submitApplication(
        application,
        userId,
        {
          email: application.submittedFields.email,
          accessToken: process.env.AUTO_APPLY_ACCESS_TOKEN || "",
          jobId: application.openingId,
        },
      );

      if (submission.success) {
        submittedCount++;

        // Persistência no banco
        await sql`
          update applications
          set
            status = 'applied',
            applied_at = ${new Date().toISOString()},
            notes = ${JSON.stringify({
              submissionMethod: submission.submission?.method ?? null,
              submittedBy: "tier3_auto",
              submittedAt: new Date().toISOString(),
              tailoredResume: {
                enabled: config.atsTailorResumeEnabled,
                usedLlm: tailored.usedLlm,
                provider: tailored.provider,
                model: tailored.model,
                llmError: tailored.error,
                pdfUploaded: tailoredPdfMeta.uploaded,
                pdfStoragePath: tailoredPdfMeta.storagePath,
                pdfError: tailoredPdfMeta.error,
              },
            })},
            updated_at = now()
          where id = ${candidate.id}
            and user_id = ${userId};
        `;

        trackingEngine.updateApplicationStatus(
          tracked.id,
          "pending",
          userId,
          "Aplicação enviada automaticamente (Tier 3)",
        );

        results.push({
          applicationId: application.id,
          status: "submitted",
          source,
          score,
        });
        if (onEvent) {
          await onEvent("auto_apply_item", {
            applicationId: application.id,
            status: "submitted",
            source,
            score,
          });
        }
      } else {
        const isConfigError =
          typeof submission?.error === "string" &&
          submission.error.includes("Configuração incompleta");

        await sql`
          update applications
          set
            status = ${isConfigError ? "skipped" : "failed"},
            notes = ${JSON.stringify({
              submissionMethod: submission.submission?.method ?? null,
              submittedBy: "tier3_auto",
              submittedAt: new Date().toISOString(),
              error: submission.error,
              tailoredResume: {
                enabled: config.atsTailorResumeEnabled,
                usedLlm: tailored.usedLlm,
                provider: tailored.provider,
                model: tailored.model,
                llmError: tailored.error,
                pdfUploaded: tailoredPdfMeta.uploaded,
                pdfStoragePath: tailoredPdfMeta.storagePath,
                pdfError: tailoredPdfMeta.error,
              },
            })},
            updated_at = now()
          where id = ${candidate.id}
            and user_id = ${userId};
        `;

        if (isConfigError) {
          skippedCount++;
        }

        results.push({
          applicationId: candidate.id,
          status: isConfigError ? "skipped" : "failed",
          source,
          score,
          error: submission.error,
        });
        if (onEvent) {
          await onEvent("auto_apply_item", {
            applicationId: candidate.id,
            status: isConfigError ? "skipped" : "failed",
            source,
            score,
            error: submission.error,
          });
        }
      }
    }

    // Notificação resumida
    await emitAutoSubmitSummaryNotification(userId, {
      totalCandidates: candidates.length,
      submittedCount,
      skippedCount,
      failedCount: results.filter((r) => r.status === "failed").length,
      dryRun,
    });

    if (onEvent) {
      await onEvent("auto_apply_done", {
        totalCandidates: candidates.length,
        submittedCount,
        skippedCount,
        failedCount: results.filter((r) => r.status === "failed").length,
        dryRun,
      });
    }

    log("info", "tier3_auto_submit_completed", {
      userId,
      totalCandidates: candidates.length,
      submittedCount,
      skippedCount,
      dryRun,
    });

    return {
      success: true,
      dryRun,
      totalCandidates: candidates.length,
      submittedCount,
      skippedCount,
      failedCount: results.filter((r) => r.status === "failed").length,
      results,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", "tier3_auto_submit_error", { userId, error: msg });

    return {
      success: false,
      error: msg,
    };
  }
}

async function emitAutoSubmitSummaryNotification(userId, summary) {
  log("info", "auto_submit_summary_notification", {
    userId,
    ...summary,
  });

  // Hook para integração futura de email/push
  // Exemplo: sendEmail(userId, `Tier 3 finalizado: ${summary.submittedCount} enviadas`)
}

// ============= END TIER 3 =============

async function runLoop() {
  log("info", "worker_started", {
    once: config.once,
    pollIntervalMs: config.pollIntervalMs,
  });

  while (!isShuttingDown) {
    try {
      const job = await claimNextJob();

      if (!job) {
        if (config.once) {
          break;
        }
        await sleep(config.pollIntervalMs);
        continue;
      }

      await processJob(job);

      if (config.once) {
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "worker_loop_transient_error", {
        error: message,
      });

      await sendWebhookNotification("worker_warning", {
        message,
      });

      if (config.once) {
        throw error;
      }

      await sleep(Math.max(1000, config.pollIntervalMs));
    }
  }

  await sql.end({ timeout: 5 });
  log("info", "worker_stopped");
}

process.on("SIGINT", () => {
  isShuttingDown = true;
});

process.on("SIGTERM", () => {
  isShuttingDown = true;
});

runLoop().catch(async (error) => {
  log("error", "worker_crash", {
    error: error instanceof Error ? error.message : String(error),
  });
  await sql.end({ timeout: 5 });
  process.exit(1);
});
