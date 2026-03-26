/**
 * Scoring Engine - Fase C
 *
 * Motor de pontuação desacoplado com:
 * - Cache por fingerprint (abertura + profile)
 * - Batch processing e concorrência dinâmica
 * - Integração com Groq LLM com fallback heurístico
 * - Telemetria (cache hit rate, API calls, latência)
 *
 * Modelo: { opening, profile } → { opening + matchScore + metadata }
 */

/**
 * Cria fingerprint para deduplicar scores
 * Baseado em: opening.sourceUrl + opening.sourceId + profile hash
 */
function buildScoreFingerprint(opening, profileId) {
  const openingKey = `${opening.source}|${opening.sourceId}|${opening.sourceUrl}`;
  return `${openingKey}|profile=${profileId}`;
}

/**
 * Calcula overlap de keywords (fallback heurístico)
 */
function calculateKeywordOverlap(openingText, profileKeywords) {
  if (!profileKeywords || profileKeywords.length === 0) {
    return 0;
  }

  const normalized = openingText
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const keywordSet = new Set(profileKeywords.map((k) => k.toLowerCase()));

  let matches = 0;
  for (const word of normalized) {
    if (keywordSet.has(word)) {
      matches++;
    }
  }

  const coverage = (matches / normalized.length) * 100;
  return Math.round(Math.max(0, Math.min(100, coverage)));
}

/**
 * Factory: cria scoring engine com cache e batch processing
 */
export function createScoringEngine(config = {}, logger = console) {
  const cache = new Map(); // fingerprint -> { score, timestamp, ttlMs }
  const DEFAULT_CACHE_TTL_MS = config.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 dias
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
  const GROQ_BATCH_SIZE = config.groqBatchSize ?? 3;
  const GROQ_CONCURRENCY = config.groqConcurrency ?? 2;
  const LLM_TOP_K = Math.max(0, Number(config.llmTopK ?? 12));
  const LLM_MIN_HEURISTIC = Number(config.llmMinHeuristic ?? 35);

  // Telemetry counters
  let stats = {
    totalScores: 0,
    cacheHits: 0,
    cacheMisses: 0,
    groqCalls: 0,
    groqErrors: 0,
    heuristicFallbacks: 0,
    heuristicOnly: 0,
    totalLatencyMs: 0,
  };

  /**
   * Scores one opening with Groq (with fallback)
   */
  async function scoreWithGroq(opening, profile) {
    if (!GROQ_API_KEY) {
      return scoreWithHeuristics(opening, profile);
    }

    try {
      const keywords = [
        ...(profile.keywords ?? []),
        ...(profile.skills ?? []),
        ...(profile.jobTitles ?? []),
      ];

      const prompt = [
        "Score this job opening from 0 to 100 for profile match.",
        "Return only a single number (0-100). No explanation.",
        `Job Title: ${opening.title}`,
        `Company: ${opening.companyName}`,
        `Description (first 2000 chars): ${(opening.description ?? "").slice(0, 2000)}`,
        `Profile Keywords: ${keywords.join(", ")}`,
        `Profile Seniority: ${profile.seniorityLevel ?? "mid"}`,
        `Profile Work Type: ${profile.workArrangement ?? "hybrid"}`,
        `Profile Countries: ${(profile.targetCountries ?? ["BR"]).join(", ")}`,
        `Job Remote Type: ${opening.remoteType ?? "unspecified"}`,
        `Job Seniority: ${opening.seniority ?? "unspecified"}`,
      ].join("\n");

      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            temperature: 0,
            max_tokens: 10,
            messages: [
              {
                role: "system",
                content:
                  "You are an expert job-to-profile matcher. Return only one integer from 0 to 100, nothing else.",
              },
              {
                role: "user",
                content: prompt,
              },
            ],
          }),
        },
      );

      stats.groqCalls++;

      if (!response.ok) {
        throw new Error(`Groq HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content ?? "0";
      const score = Number(
        String(content)
          .trim()
          .match(/\d{1,3}/)?.[0] ?? 0,
      );

      return Math.max(0, Math.min(100, score));
    } catch (error) {
      stats.groqErrors++;
      logger.log("warn", "scoring-engine: groq failed, using heuristics", {
        error: error instanceof Error ? error.message : String(error),
      });
      return scoreWithHeuristics(opening, profile);
    }
  }

  /**
   * Scores with keyword overlap (fallback)
   */
  function scoreWithHeuristics(opening, profile) {
    stats.heuristicFallbacks++;

    const keywords = [
      ...(profile.keywords ?? []),
      ...(profile.skills ?? []),
      ...(profile.jobTitles ?? []),
    ];

    const titleScore = calculateKeywordOverlap(opening.title, keywords);
    const descScore = calculateKeywordOverlap(
      opening.description ?? "",
      keywords,
    );
    const avgScore = (titleScore * 0.4 + descScore * 0.6) | 0;

    // Boost if remote type matches
    let boost = 0;
    if (profile.workArrangement && opening.remoteType) {
      if (
        profile.workArrangement.toLowerCase() ===
        opening.remoteType.toLowerCase()
      ) {
        boost = 5;
      }
    }

    // Boost if seniority matches
    if (profile.seniorityLevel && opening.seniority) {
      if (
        profile.seniorityLevel.toLowerCase() === opening.seniority.toLowerCase()
      ) {
        boost += 5;
      }
    }

    return Math.max(0, Math.min(100, avgScore + boost));
  }

  async function runGroqQueue(candidates, profile, concurrency) {
    if (!candidates.length) {
      return;
    }

    let nextIdx = 0;
    const workers = Array.from({ length: Math.max(1, concurrency) }, () =>
      (async () => {
        while (nextIdx < candidates.length) {
          const idx = nextIdx++;
          const candidate = candidates[idx];
          const score = await scoreWithGroq(candidate.opening, profile);
          candidate.finalScore = score;
          candidate.source = "groq";
        }
      })(),
    );

    await Promise.all(workers);
  }

  /**
   * Main entry: score array of openings with concurrency control
   *
   * Parâmetros:
   *   openings: [] de openings para pontuar
   *   profile: { keywords[], skills[], jobTitles[], seniorityLevel, workArrangement, targetCountries }
   *   profileId: ID do perfil (para cache)
   *   concurrency?: Número de batches em paralelo (default: 2)
   *   onProgress?: Callback para progresso (item, total)
   *
   * Retorna: [{ ...opening, matchScore, scoreSource: "cache"|"groq" }]
   */
  async function scoreMany(
    openings,
    profile,
    profileId,
    concurrency = GROQ_CONCURRENCY,
    onProgress = null,
  ) {
    if (!openings || openings.length === 0) {
      return [];
    }

    logger.log("info", "scoring-engine: starting batch scoring", {
      totalOpenings: openings.length,
      batchSize: GROQ_BATCH_SIZE,
      concurrency,
      profileId,
      llmTopK: LLM_TOP_K,
      llmMinHeuristic: LLM_MIN_HEURISTIC,
    });

    stats.totalScores += openings.length;

    const results = new Array(openings.length);
    const misses = [];

    for (let i = 0; i < openings.length; i++) {
      const opening = openings[i];
      const fp = buildScoreFingerprint(opening, profileId);
      const entry = cache.get(fp);

      if (entry && Date.now() - entry.timestamp < entry.ttlMs) {
        stats.cacheHits++;
        results[i] = {
          ...opening,
          matchScore: entry.score,
          scoreSource: "cache",
        };
      } else {
        stats.cacheMisses++;
        const heuristicScore = scoreWithHeuristics(opening, profile);
        misses.push({
          index: i,
          opening,
          heuristicScore,
          finalScore: heuristicScore,
          source: "heuristic",
        });
      }
    }

    const shouldUseGroq = Boolean(GROQ_API_KEY);
    let candidates = [];

    if (shouldUseGroq && LLM_TOP_K > 0) {
      candidates = misses
        .filter((item) => item.heuristicScore >= LLM_MIN_HEURISTIC)
        .sort((a, b) => b.heuristicScore - a.heuristicScore)
        .slice(0, LLM_TOP_K);
    }

    const candidateKeys = new Set(candidates.map((item) => item.index));
    const heuristicOnlyCount = misses.length - candidates.length;
    stats.heuristicOnly += Math.max(0, heuristicOnlyCount);

    if (onProgress && heuristicOnlyCount > 0) {
      await onProgress({
        processed: results.filter(Boolean).length,
        total: openings.length,
        totalToScore: openings.length,
        batchesCompleted: 0,
        totalBatches: 1,
        llmCandidates: candidates.length,
        heuristicOnlyCount,
      });
    }

    await runGroqQueue(candidates, profile, Math.max(1, concurrency));

    let completed = results.filter(Boolean).length;
    for (const item of misses) {
      const score = item.finalScore;
      const source = candidateKeys.has(item.index) ? item.source : "heuristic";
      const fp = buildScoreFingerprint(item.opening, profileId);

      cache.set(fp, {
        score,
        timestamp: Date.now(),
        ttlMs: DEFAULT_CACHE_TTL_MS,
      });

      results[item.index] = {
        ...item.opening,
        matchScore: score,
        scoreSource: source,
      };

      completed++;
      if (onProgress) {
        await onProgress({
          processed: completed,
          total: openings.length,
          totalToScore: openings.length,
          batchesCompleted: completed,
          totalBatches: openings.length,
          llmCandidates: candidates.length,
          heuristicOnlyCount,
        });
      }
    }

    return results;
  }

  /**
   * Scores a single opening (convenience method)
   */
  async function scoreOne(opening, profile, profileId) {
    const results = await scoreMany([opening], profile, profileId, 1);
    return results[0] ?? { ...opening, matchScore: 0 };
  }

  /**
   * Retorna stats de cache e telemetria
   */
  function getStats() {
    const cacheSize = cache.size;
    const cacheHitRate =
      stats.totalScores > 0
        ? ((stats.cacheHits / stats.totalScores) * 100).toFixed(1)
        : "0";

    return {
      ...stats,
      cacheHitRate: `${cacheHitRate}%`,
      cacheSize,
      avgLatencyMs:
        stats.totalScores > 0
          ? (stats.totalLatencyMs / stats.totalScores).toFixed(0)
          : 0,
    };
  }

  /**
   * Limpa cache manualmente
   */
  function clearCache() {
    cache.clear();
  }

  /**
   * Retorna tamanho do cache
   */
  function getCacheSize() {
    return cache.size;
  }

  return {
    scoreOne,
    scoreMany,
    getStats,
    clearCache,
    getCacheSize,
  };
}
