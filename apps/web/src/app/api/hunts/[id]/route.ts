import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { hasDatabase } from "@/lib/session";
import { huntEvents, hunts } from "@hunter/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const patchSchema = z.object({
  action: z.enum(["cancel"]),
});

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL nao configurado." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Payload invalido." },
      { status: 400 },
    );
  }

  const { id: huntId } = await context.params;
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
            eq(hunts.id, huntId),
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
          and payload->>'huntId' = ${huntId};
      `);

      await tx.insert(huntEvents).values({
        huntId,
        userId,
        eventType: "hunt_stopped",
        payload: {
          reason: "cancelled",
          message: "Caçada cancelada manualmente.",
        },
      });
    });

    return NextResponse.json(
      {
        data: {
          id: huntId,
          status: "cancelled",
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
