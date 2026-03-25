import { z } from "zod";

export function parseCriteriaJson(raw: string): Record<string, unknown> {
  const t = raw.trim();
  if (!t) return {};
  const parsed: unknown = JSON.parse(t);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Deve ser um objecto JSON");
  }
  return parsed as Record<string, unknown>;
}

export const strategyBaseSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(200),
  promptText: z.string().min(1, "Texto para o agente é obrigatório"),
});
