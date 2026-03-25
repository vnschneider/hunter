"use server";

import { hunts, strategies } from "@hunter/db/schema";
import { getDb } from "@/lib/db";
import { hasDatabase, requireUserId } from "@/lib/session";
import { parseCriteriaJson, strategyBaseSchema } from "@/lib/validations/strategy";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type StrategyFormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export async function createStrategy(
  _prev: StrategyFormState,
  formData: FormData,
): Promise<StrategyFormState> {
  if (!hasDatabase()) {
    return { error: "DATABASE_URL não configurado." };
  }
  const userId = await requireUserId();
  const parsed = strategyBaseSchema.safeParse({
    name: formData.get("name"),
    promptText: formData.get("promptText"),
  });
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return { fieldErrors: fe as Record<string, string[] | undefined> };
  }
  let criteriaJson: Record<string, unknown>;
  try {
    criteriaJson = parseCriteriaJson(
      String(formData.get("criteriaJsonText") ?? ""),
    );
  } catch {
    return {
      fieldErrors: {
        criteriaJsonText: ["JSON inválido — usa um objecto ou deixa vazio."],
      },
    };
  }
  const db = getDb();
  const now = new Date();
  await db.insert(strategies).values({
    userId,
    name: parsed.data.name,
    promptText: parsed.data.promptText,
    criteriaJson,
    isActive: false,
    updatedAt: now,
  });
  revalidatePath("/dashboard/strategies");
  redirect("/dashboard/strategies");
}

export async function updateStrategy(
  _prev: StrategyFormState,
  formData: FormData,
): Promise<StrategyFormState> {
  if (!hasDatabase()) {
    return { error: "DATABASE_URL não configurado." };
  }
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "ID em falta." };
  }
  const parsed = strategyBaseSchema.safeParse({
    name: formData.get("name"),
    promptText: formData.get("promptText"),
  });
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return { fieldErrors: fe as Record<string, string[] | undefined> };
  }
  let criteriaJson: Record<string, unknown>;
  try {
    criteriaJson = parseCriteriaJson(
      String(formData.get("criteriaJsonText") ?? ""),
    );
  } catch {
    return {
      fieldErrors: {
        criteriaJsonText: ["JSON inválido — usa um objecto ou deixa vazio."],
      },
    };
  }
  const db = getDb();
  const rows = await db
    .update(strategies)
    .set({
      name: parsed.data.name,
      promptText: parsed.data.promptText,
      criteriaJson,
      updatedAt: new Date(),
    })
    .where(and(eq(strategies.id, id), eq(strategies.userId, userId)))
    .returning({ id: strategies.id });
  if (!rows.length) {
    return { error: "Estratégia não encontrada." };
  }
  revalidatePath("/dashboard/strategies");
  revalidatePath(`/dashboard/strategies/${id}/edit`);
  redirect("/dashboard/strategies");
}

export async function deleteStrategy(formData: FormData) {
  if (!hasDatabase()) {
    return;
  }
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  const [agg] = await db
    .select({ n: count() })
    .from(hunts)
    .where(eq(hunts.strategyId, id));
  const c = Number(agg?.n ?? 0);
  if (c > 0) {
    revalidatePath("/dashboard/strategies");
    redirect(
      `/dashboard/strategies?error=${encodeURIComponent("Não é possível apagar: existem caçadas associadas.")}`,
    );
  }
  await db
    .delete(strategies)
    .where(and(eq(strategies.id, id), eq(strategies.userId, userId)));
  revalidatePath("/dashboard/strategies");
  redirect("/dashboard/strategies");
}

export async function setActiveStrategy(formData: FormData) {
  if (!hasDatabase()) {
    return;
  }
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  await db
    .update(strategies)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(strategies.userId, userId));
  await db
    .update(strategies)
    .set({ isActive: true, updatedAt: new Date() })
    .where(and(eq(strategies.id, id), eq(strategies.userId, userId)));
  revalidatePath("/dashboard/strategies");
}
