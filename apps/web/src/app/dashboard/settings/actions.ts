"use server";

import { cvs, strategies } from "@hunter/db/schema";
import { getDb } from "@/lib/db";
import { hasDatabase, requireUserId } from "@/lib/session";
import { getLLMFactory } from "@/lib/llm";
import type { LLMProviderName } from "@/lib/llm";
import { revalidatePath } from "next/cache";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const MAX_CV_FILE_BYTES = 5 * 1024 * 1024;
const CV_STORAGE_BUCKET = process.env.CV_STORAGE_BUCKET || "cvs";

const analyzeStrategySentenceSchema = z.object({
  cvText: z.string().optional(),
  jobPreferences: z.string().optional(),
  provider: z.enum(["auto", "gemini", "openai", "groq"]).optional(),
});

type ProviderAttempt = {
  provider: LLMProviderName;
  status: "success" | "error" | "not_configured";
  error?: string;
  modelUsed?: string;
};

type AnalysisExecutionTrace = {
  requestedProvider: "auto" | LLMProviderName;
  preferredProvider: LLMProviderName;
  attempts: ProviderAttempt[];
};

function normalizeProviderError(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 200 ? `${compact.slice(0, 200)}...` : compact;
}

function isQuotaOrRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("too many requests") ||
    m.includes("quota") ||
    m.includes("resource_exhausted")
  );
}

async function extractTextFromPdf(file: File): Promise<string> {
  if (file.size > MAX_CV_FILE_BYTES) {
    throw new Error("PDF excede o limite de 5MB.");
  }

  if (file.type !== "application/pdf") {
    throw new Error("Apenas arquivos PDF sao suportados.");
  }

  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
    dataBuffer: Buffer,
  ) => Promise<{ text?: string }>;

  const arrayBuffer = await file.arrayBuffer();
  const result = await pdfParse(Buffer.from(arrayBuffer));
  const text = result.text?.trim() ?? "";
  if (!text) {
    throw new Error("Nao foi possivel extrair texto deste PDF.");
  }
  return text;
}

export type AnalyzeStrategyState = {
  success?: boolean;
  data?: {
    cvId?: string;
    criteriaJson: Record<string, unknown>;
    promptText: string;
    summary?: string;
    confidence?: number;
    note?: string;
    providerUsed?: LLMProviderName;
    modelUsed?: string;
    processingMs?: number;
  };
  executionTrace?: AnalysisExecutionTrace;
  error?: string;
};

export type SaveStrategyState = {
  success?: boolean;
  error?: string;
};

const deleteCvSchema = z.object({
  cvId: z.string().uuid("CV invalido"),
});

const saveAnalyzedStrategySchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatorio").max(200),
  promptText: z.string().trim().min(1, "Prompt da estrategia obrigatorio"),
  criteriaJsonText: z.string().trim().min(2, "Criteria JSON invalido"),
  cvId: z.string().uuid().optional(),
});

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

async function persistCvFromPdf(
  userId: string,
  file: File,
  extractedText: string,
) {
  if (!hasDatabase()) {
    return { cvId: undefined as string | undefined, note: "" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const cvId = randomUUID();
  const fileName = file.name || `${cvId}.pdf`;
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${userId}/${cvId}-${safeName}`;

  const db = getDb();
  const supabase = getSupabaseAdminClient();
  let note = "";

  if (supabase) {
    const { error } = await supabase.storage
      .from(CV_STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (error) {
      note = `PDF analisado, mas upload falhou no Storage (${error.message}).`;
    }
  } else {
    note =
      "PDF analisado sem upload no Storage (credenciais Supabase ausentes).";
  }

  await db.insert(cvs).values({
    id: cvId,
    userId,
    storagePath,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: file.size,
    sha256,
    extractedText,
  });

  return { cvId, note };
}

export async function analyzeCV(
  _prev: AnalyzeStrategyState,
  formData: FormData,
): Promise<AnalyzeStrategyState> {
  const startedAt = Date.now();
  try {
    const userId = await requireUserId();
    const cvTextInput = String(formData.get("cvText") ?? "").trim();
    const jobPreferences = String(formData.get("jobPreferences") ?? "");
    const providerInput = String(formData.get("provider") ?? "auto").trim();
    const fileField = formData.get("cvFile");
    const pdfFile =
      fileField instanceof File && fileField.size > 0 ? fileField : null;

    const parsed = analyzeStrategySentenceSchema.safeParse({
      cvText: cvTextInput || undefined,
      jobPreferences: jobPreferences || undefined,
      provider: providerInput || "auto",
    });

    if (!parsed.success) {
      return {
        error: parsed.error.errors[0]?.message || "Invalid input",
      };
    }

    let cvText = parsed.data.cvText ?? "";
    let cvId: string | undefined;
    let note: string | undefined;
    if (!cvText && pdfFile) {
      cvText = await extractTextFromPdf(pdfFile);
    }

    if (pdfFile) {
      const persisted = await persistCvFromPdf(userId, pdfFile, cvText || "");
      cvId = persisted.cvId;
      note = persisted.note || undefined;
    }

    if (cvText.length < 50) {
      return {
        error:
          "Forneca texto do CV com pelo menos 50 caracteres ou envie um PDF valido (max 5MB).",
      };
    }

    const factory = getLLMFactory();
    const preferredFromEnv = (process.env.LLM_PROVIDER ||
      "gemini") as LLMProviderName;
    const preferredFromForm =
      parsed.data.provider && parsed.data.provider !== "auto"
        ? parsed.data.provider
        : undefined;
    const preferred = preferredFromForm || preferredFromEnv;
    const requestedProvider =
      parsed.data.provider === "auto" || !parsed.data.provider
        ? "auto"
        : parsed.data.provider;

    const providerOrder = [preferred, "openai", "groq", "gemini"].filter(
      (name, idx, arr) => arr.indexOf(name) === idx,
    ) as LLMProviderName[];
    const attempts: ProviderAttempt[] = [];

    let result:
      | {
          criteriaJson: Record<string, unknown>;
          promptText: string;
          summary?: string;
          confidence?: number;
          providerUsed?: LLMProviderName;
          modelUsed?: string;
        }
      | undefined;
    const providerErrors: string[] = [];

    for (const providerName of providerOrder) {
      const provider = factory.getProviderByName(providerName);
      if (!provider.isConfigured()) {
        attempts.push({ provider: providerName, status: "not_configured" });
        providerErrors.push(`${providerName}: não configurado`);
        continue;
      }

      try {
        result = await provider.analyzeCV({
          cvText,
          jobPreferences: parsed.data.jobPreferences,
          language: "pt",
        });
        attempts.push({
          provider: providerName,
          status: "success",
          modelUsed: result.modelUsed,
        });

        if (providerName !== preferred) {
          note = note
            ? `${note} Fallback LLM usado: ${providerName}.`
            : `Fallback LLM usado: ${providerName}.`;
        }
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({
          provider: providerName,
          status: "error",
          error: normalizeProviderError(message),
        });
        providerErrors.push(`${providerName}: ${message}`);

        // Se erro não for de quota/rate-limit no provider preferido,
        // ainda tentamos próximos providers configurados para robustez.
        if (providerName === preferred && !isQuotaOrRateLimitError(message)) {
          // segue fallback mesmo assim
        }
      }
    }

    if (!result) {
      const details = providerErrors.join(" | ");
      return {
        executionTrace: {
          requestedProvider,
          preferredProvider: preferred,
          attempts,
        },
        error:
          "Nenhum provedor de IA conseguiu responder. Verifica quotas/chaves (Gemini/OpenAI/Groq). " +
          details,
      };
    }

    // Validar que recebemos um JSON válido
    if (!result.criteriaJson || !result.promptText) {
      return {
        error: "LLM failed to generate valid criteria. Try again.",
      };
    }

    return {
      success: true,
      executionTrace: {
        requestedProvider,
        preferredProvider: preferred,
        attempts,
      },
      data: {
        ...result,
        cvId,
        note,
        processingMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[analyzeCV] Error:", message);
    return {
      error: `Failed to analyze CV: ${message}`,
    };
  }
}

export async function saveAnalyzedStrategy(
  _prev: SaveStrategyState,
  formData: FormData,
): Promise<SaveStrategyState> {
  if (!hasDatabase()) {
    return { error: "DATABASE_URL nao configurado." };
  }

  const userId = await requireUserId();
  const parsed = saveAnalyzedStrategySchema.safeParse({
    name: formData.get("name"),
    promptText: formData.get("promptText"),
    criteriaJsonText: formData.get("criteriaJsonText"),
    cvId: String(formData.get("cvId") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.errors[0]?.message || "Dados invalidos para guardar.",
    };
  }

  let criteriaJson: Record<string, unknown>;
  try {
    const raw = JSON.parse(parsed.data.criteriaJsonText) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { error: "Criteria JSON deve ser um objeto." };
    }
    criteriaJson = raw as Record<string, unknown>;
  } catch {
    return { error: "Criteria JSON invalido." };
  }

  const db = getDb();
  await db.insert(strategies).values({
    userId,
    cvId: parsed.data.cvId,
    name: parsed.data.name,
    promptText: parsed.data.promptText,
    criteriaJson,
    isActive: false,
    updatedAt: new Date(),
  });

  revalidatePath("/dashboard/strategies");

  return { success: true };
}

export async function deleteCv(formData: FormData): Promise<void> {
  if (!hasDatabase()) {
    return;
  }

  const parsed = deleteCvSchema.safeParse({
    cvId: formData.get("cvId"),
  });
  if (!parsed.success) {
    return;
  }

  const userId = await requireUserId();
  const db = getDb();

  const rows = await db
    .select({ id: cvs.id, storagePath: cvs.storagePath })
    .from(cvs)
    .where(and(eq(cvs.id, parsed.data.cvId), eq(cvs.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    await supabase.storage.from(CV_STORAGE_BUCKET).remove([row.storagePath]);
  }

  await db.delete(cvs).where(and(eq(cvs.id, row.id), eq(cvs.userId, userId)));

  revalidatePath("/dashboard/settings");
}
