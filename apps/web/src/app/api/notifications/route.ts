import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { hasDatabase } from "@/lib/session";
import { huntEvents } from "@hunter/db/schema";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

const IMPORTANT_EVENTS = [
  "hunt_started",
  "hunt_progress",
  "interesting_opening_found",
  "application_created",
  "hunt_warning",
  "auto_apply_completed",
  "hunt_completed",
  "hunt_failed",
  "hunt_stopped",
] as const;

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const afterId = Number(url.searchParams.get("afterId") ?? "0");
  const limitRaw = Number(url.searchParams.get("limit") ?? "40");
  const limit = Math.min(Math.max(limitRaw, 1), 100);

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: huntEvents.id,
        huntId: huntEvents.huntId,
        eventType: huntEvents.eventType,
        payload: huntEvents.payload,
        createdAt: huntEvents.createdAt,
      })
      .from(huntEvents)
      .where(
        and(
          eq(huntEvents.userId, userId),
          gt(huntEvents.id, Number.isFinite(afterId) ? afterId : 0),
          inArray(huntEvents.eventType, [...IMPORTANT_EVENTS]),
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
