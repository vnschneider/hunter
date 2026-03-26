#!/usr/bin/env node

import { searchGithubIssues } from "./connectors/github-issues.mjs";
import { searchGreenhouse } from "./connectors/greenhouse.mjs";
import { searchLinkedIn } from "./connectors/linkedin.mjs";
import { searchLever } from "./connectors/lever.mjs";
import { searchNerdin } from "./connectors/nerdin.mjs";
import {
  keywordOverlapScore,
  normalizeText,
  withTimeout,
} from "./connectors/shared.mjs";
import { createProviderGateway } from "../worker/core/provider-gateway.mjs";

const PROVIDER_TIMEOUT_MS = Number(
  process.env.MCP_PROVIDER_TIMEOUT_MS ?? "25000",
);
const SCORE_HTTP_TIMEOUT_MS = Number(
  process.env.MCP_SCORE_HTTP_TIMEOUT_MS ?? "9000",
);

const providersRegistry = {
  linkedin: searchLinkedIn,
  nerdin: searchNerdin,
  greenhouse: searchGreenhouse,
  lever: searchLever,
  github: searchGithubIssues,
};

const gateway = createProviderGateway(providersRegistry, console);

const tools = {
  search_openings: {
    description:
      "Busca vagas em fontes configuradas (LinkedIn, Nerdin, GitHub Issues, Greenhouse, Lever) e retorna formato canônico. Implementado com Provider Gateway v2 (cache + telemetria forte).",
    inputSchema: {
      type: "object",
      properties: {
        filters: { type: "object" },
      },
      required: ["filters"],
    },
    handler: async ({ filters }) => {
      // Extrai critério de busca do filtro
      const criteria = {
        keywords: filters.keywords ?? "",
        location: filters.location ?? "",
        filters: {
          sources: filters.sources ?? [
            "linkedin",
            "nerdin",
            "greenhouse",
            "lever",
            "github",
          ],
          minConfidence: filters.minConfidence ?? 0,
          seniority: filters.seniority,
          remoteType: filters.remoteType,
          publicationDays: filters.publicationDays,
        },
      };

      // Usa gateway com deadline se foi passado
      const deadline = filters.deadline ? Date.now() + filters.deadline : null;
      const { openings, meta } = await gateway.search(
        criteria,
        deadline,
        filters.sources,
      );

      // Normaliza todos os resultados
      const normalized = openings.map(normalizeOpening);

      return {
        openings: normalized,
        meta: {
          total: normalized.length,
          providers: meta.providers,
          totalElapsedMs: meta.totalElapsedMs,
          cached: meta.cached ?? false,
          cacheHits: meta.cacheHits ?? 0,
        },
      };
    },
  },

  get_opening_detail: {
    description:
      "Retorna detalhes de uma vaga a partir de um objeto canônico recebido.",
    inputSchema: {
      type: "object",
      properties: {
        opening: { type: "object" },
      },
      required: ["opening"],
    },
    handler: async ({ opening }) => opening,
  },

  normalize_opening: {
    description:
      "Normaliza campos de texto para consistência e preenchimento de defaults.",
    inputSchema: {
      type: "object",
      properties: {
        opening: { type: "object" },
      },
      required: ["opening"],
    },
    handler: async ({ opening }) => normalizeOpening(opening),
  },

  dedupe_openings: {
    description:
      "Remove duplicatas por fingerprint de empresa, titulo e link principal.",
    inputSchema: {
      type: "object",
      properties: {
        openings: { type: "array", items: { type: "object" } },
      },
      required: ["openings"],
    },
    handler: async ({ openings }) => dedupe(openings),
  },

  score_opening_with_groq: {
    description:
      "Atribui score de aderência. Usa Groq quando GROQ_API_KEY estiver definido, com fallback heurístico.",
    inputSchema: {
      type: "object",
      properties: {
        opening: { type: "object" },
        profile: { type: "object" },
      },
      required: ["opening", "profile"],
    },
    handler: async ({ opening, profile }) => {
      const normalized = normalizeOpening(opening);
      const score = await scoreOpening(normalized, profile);
      return {
        ...normalized,
        matchScore: score,
      };
    },
  },

  rank_openings: {
    description: "Ordena vagas por score e recência.",
    inputSchema: {
      type: "object",
      properties: {
        openings: { type: "array", items: { type: "object" } },
      },
      required: ["openings"],
    },
    handler: async ({ openings }) => {
      const sorted = [...openings].sort((a, b) => {
        const scoreDiff = Number(b.matchScore ?? 0) - Number(a.matchScore ?? 0);
        if (scoreDiff !== 0) return scoreDiff;

        const aDate = new Date(a.postedAt ?? 0).getTime();
        const bDate = new Date(b.postedAt ?? 0).getTime();
        return bDate - aDate;
      });

      return {
        openings: sorted,
      };
    },
  },
};

function normalizeOpening(opening) {
  return {
    source: opening.source ?? "unknown",
    sourceId: String(opening.sourceId ?? ""),
    title: String(opening.title ?? "").trim(),
    companyName: String(opening.companyName ?? "").trim(),
    description: String(opening.description ?? ""),
    locationText: opening.locationText ?? null,
    countryCode: opening.countryCode ?? null,
    remoteType: opening.remoteType ?? "unspecified",
    employmentType: opening.employmentType ?? null,
    seniority: opening.seniority ?? null,
    skills: Array.isArray(opening.skills) ? opening.skills : [],
    salaryMin: opening.salaryMin ?? null,
    salaryMax: opening.salaryMax ?? null,
    salaryCurrency: opening.salaryCurrency ?? null,
    postedAt: opening.postedAt ?? null,
    validThrough: opening.validThrough ?? null,
    applyUrl: opening.applyUrl ?? opening.sourceUrl ?? null,
    sourceUrl: opening.sourceUrl ?? opening.applyUrl ?? null,
    language: opening.language ?? null,
    metadata: opening.metadata ?? {},
    dedupeFingerprint: createFingerprint(opening),
  };
}

function createFingerprint(opening) {
  const company = normalizeText(opening.companyName);
  const title = normalizeText(opening.title);
  const location = normalizeText(opening.locationText ?? "remote");
  const sourceUrl = normalizeText(opening.sourceUrl ?? opening.applyUrl ?? "");
  return `${company}|${title}|${location}|${sourceUrl}`;
}

function dedupe(openings) {
  const seen = new Set();
  const deduped = [];

  for (const opening of openings) {
    const normalized = normalizeOpening(opening);
    if (seen.has(normalized.dedupeFingerprint)) continue;
    seen.add(normalized.dedupeFingerprint);
    deduped.push(normalized);
  }

  return {
    openings: deduped,
    removed: openings.length - deduped.length,
  };
}

async function scoreOpening(opening, profile) {
  const apiKey = process.env.GROQ_API_KEY;
  const keywords = [
    ...(profile.keywords ?? []),
    ...(profile.skills ?? []),
    ...(profile.jobTitles ?? []),
  ];

  if (!apiKey) {
    return keywordOverlapScore(
      `${opening.title} ${opening.description}`,
      keywords,
    );
  }

  try {
    const model = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
    const prompt = [
      "Score this opening from 0 to 100 for profile match.",
      "Return only a number.",
      `Opening title: ${opening.title}`,
      `Opening description: ${opening.description.slice(0, 1500)}`,
      `Profile keywords: ${(keywords ?? []).join(", ")}`,
      `Profile seniority: ${profile.seniorityLevel ?? "unknown"}`,
      `Profile arrangement: ${profile.workArrangement ?? "unknown"}`,
      `Profile target countries: ${(profile.targetCountries ?? []).join(", ")}`,
    ].join("\n");

    const response = await withTimeout(
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You score job-to-profile matching. Return only one integer from 0 to 100.",
            },
            { role: "user", content: prompt },
          ],
        }),
      }),
      SCORE_HTTP_TIMEOUT_MS,
      `Groq timeout after ${SCORE_HTTP_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      throw new Error(`Groq HTTP ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const num = Number(String(content).match(/\d{1,3}/)?.[0] ?? 0);
    return Math.max(0, Math.min(100, Math.round(num)));
  } catch {
    return keywordOverlapScore(
      `${opening.title} ${opening.description}`,
      keywords,
    );
  }
}

function createResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function createError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function writeMessage(message) {
  const payload = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n`;
  process.stdout.write(header + payload);
}

let buffer = "";

function processBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = "";
      return;
    }

    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;

    const payload = buffer.slice(start, start + length);
    buffer = buffer.slice(start + length);

    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      continue;
    }

    void handleMessage(message);
  }
}

async function handleMessage(message) {
  const { id, method, params } = message;

  try {
    if (method === "initialize") {
      writeMessage(
        createResponse(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "hunter-mcp",
            version: "0.1.0",
          },
        }),
      );
      return;
    }

    if (method === "tools/list") {
      writeMessage(
        createResponse(id, {
          tools: Object.entries(tools).map(([name, def]) => ({
            name,
            description: def.description,
            inputSchema: def.inputSchema,
          })),
        }),
      );
      return;
    }

    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};
      const tool = tools[name];

      if (!tool) {
        writeMessage(createError(id, -32602, `Unknown tool: ${name}`));
        return;
      }

      const result = await tool.handler(args);
      writeMessage(
        createResponse(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }),
      );
      return;
    }

    writeMessage(createError(id, -32601, `Method not found: ${method}`));
  } catch (error) {
    writeMessage(createError(id, -32000, error?.message ?? "Internal error"));
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  processBuffer();
});
