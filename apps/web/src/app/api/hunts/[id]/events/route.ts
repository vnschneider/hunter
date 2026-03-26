import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { hasDatabase } from "@/lib/session";
import { huntEvents, hunts } from "@hunter/db/schema";
import { and, asc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
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

  const { id: huntId } = await context.params;
  const url = new URL(request.url);
  const afterId = Number(url.searchParams.get("afterId") ?? "0");
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Math.min(Math.max(limitRaw, 1), 60);

  try {
    const db = getDb();

    const ownedHunt = await db
      .select({ id: hunts.id })
      .from(hunts)
      .where(and(eq(hunts.id, huntId), eq(hunts.userId, userId)))
      .limit(1);

    if (!ownedHunt[0]) {
      return NextResponse.json(
        { error: "Hunt nao encontrada para este utilizador." },
        { status: 404 },
      );
    }

    const rows = await db
      .select({
        id: huntEvents.id,
        eventType: huntEvents.eventType,
        payload: huntEvents.payload,
        createdAt: huntEvents.createdAt,
      })
      .from(huntEvents)
      .where(
        and(
          eq(huntEvents.huntId, huntId),
          eq(huntEvents.userId, userId),
          gt(huntEvents.id, Number.isFinite(afterId) ? afterId : 0),
        ),
      )
      .orderBy(asc(huntEvents.id))
      .limit(limit);

    const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : afterId;

    return NextResponse.json(
      {
        data: rows,
        nextCursor,
        hasMore: rows.length === limit,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Base de dados temporariamente indisponível." },
      { status: 503 },
    );
  }
}
