"use server";

import { enqueueHuntForUser } from "@/lib/hunts";
import { getDb } from "@/lib/db";
import { hasDatabase, requireUserId } from "@/lib/session";
import { huntEvents, hunts } from "@hunter/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const startHuntSchema = z.object({
  strategyId: z.string().uuid("Estrategia invalida"),
});

const stopHuntSchema = z.object({
  huntId: z.string().uuid("Hunt invalida"),
});

export async function startHunt(formData: FormData) {
  if (!hasDatabase()) {
    redirect("/dashboard/hunts?error=DATABASE_URL%20nao%20configurado");
  }

  const userId = await requireUserId();
  const parsed = startHuntSchema.safeParse({
    strategyId: String(formData.get("strategyId") ?? ""),
  });

  if (!parsed.success) {
    redirect("/dashboard/hunts?error=Estrategia%20invalida");
  }

  try {
    await enqueueHuntForUser({ userId, strategyId: parsed.data.strategyId });
    revalidatePath("/dashboard/hunts");
    redirect("/dashboard/hunts?queued=1");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado";
    redirect(`/dashboard/hunts?error=${encodeURIComponent(message)}`);
  }
}

export async function stopHunt(formData: FormData) {
  if (!hasDatabase()) {
    redirect("/dashboard/hunts?error=DATABASE_URL%20nao%20configurado");
  }

  const userId = await requireUserId();
  const parsed = stopHuntSchema.safeParse({
    huntId: String(formData.get("huntId") ?? ""),
  });

  if (!parsed.success) {
    redirect("/dashboard/hunts?error=Hunt%20invalida");
  }

  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(hunts)
        .set({
          status: "cancelled",
          finishedAt: new Date(),
          errorMessage: "Caçada cancelada manualmente.",
        })
        .where(
          and(
            eq(hunts.id, parsed.data.huntId),
            eq(hunts.userId, userId),
            inArray(hunts.status, ["pending", "running"]),
          ),
        )
        .returning({ id: hunts.id });

      if (!rows[0]) {
        throw new Error("Hunt nao encontrada ou ja finalizada.");
      }

      await tx.execute(sql`
        update jobs
        set
          status = 'done',
          updated_at = now(),
          last_error = 'Cancelada manualmente pelo utilizador'
        where user_id = ${userId}
          and type = 'run_hunt'
          and status in ('queued', 'processing')
          and payload->>'huntId' = ${parsed.data.huntId};
      `);

      await tx.insert(huntEvents).values({
        huntId: parsed.data.huntId,
        userId,
        eventType: "hunt_stopped",
        payload: {
          reason: "cancelled",
          message: "Caçada cancelada manualmente.",
        },
      });
    });

    revalidatePath("/dashboard/hunts");
    redirect("/dashboard/hunts?stopped=1");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado";
    redirect(`/dashboard/hunts?error=${encodeURIComponent(message)}`);
  }
}
