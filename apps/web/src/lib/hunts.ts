import { hunts, jobs, strategies } from "@hunter/db/schema";
import { getDb } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export async function enqueueHuntForUser(params: {
  userId: string;
  strategyId: string;
}) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const strategyRows = await tx
      .select()
      .from(strategies)
      .where(
        and(
          eq(strategies.id, params.strategyId),
          eq(strategies.userId, params.userId),
        ),
      )
      .limit(1);

    const strategy = strategyRows[0];
    if (!strategy) {
      throw new Error("Estrategia nao encontrada para este utilizador.");
    }

    const strategySnapshotJson = {
      id: strategy.id,
      name: strategy.name,
      promptText: strategy.promptText,
      criteriaJson: strategy.criteriaJson,
      version: strategy.version,
      cvId: strategy.cvId,
    };

    const huntRows = await tx
      .insert(hunts)
      .values({
        userId: params.userId,
        strategyId: strategy.id,
        strategySnapshotJson,
        status: "pending",
      })
      .returning({
        id: hunts.id,
        createdAt: hunts.createdAt,
        status: hunts.status,
      });

    const hunt = huntRows[0];
    if (!hunt) {
      throw new Error("Falha ao criar hunt.");
    }

    await tx.insert(jobs).values({
      type: "run_hunt",
      userId: params.userId,
      payload: {
        huntId: hunt.id,
        strategyId: strategy.id,
      },
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      idempotencyKey: `${params.userId}:${hunt.id}:${randomUUID()}`,
      updatedAt: new Date(),
    });

    return hunt;
  });
}

export async function listUserHunts(params: {
  userId: string;
  limit?: number;
}) {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);

  return db
    .select({
      id: hunts.id,
      status: hunts.status,
      startedAt: hunts.startedAt,
      finishedAt: hunts.finishedAt,
      createdAt: hunts.createdAt,
      strategyId: hunts.strategyId,
      strategyName: strategies.name,
      errorMessage: hunts.errorMessage,
    })
    .from(hunts)
    .innerJoin(strategies, eq(hunts.strategyId, strategies.id))
    .where(eq(hunts.userId, params.userId))
    .orderBy(desc(hunts.createdAt))
    .limit(limit);
}
