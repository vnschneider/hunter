import { auth } from "@/auth";
import { listApplicationsWithOpenings } from "@/lib/dashboard-queries";
import { getDb } from "@/lib/db";
import { hasDatabase } from "@/lib/session";
import { applications } from "@hunter/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const queueTopSchema = z.object({
  period: z.coerce.number().int().min(1).max(90).default(7),
  minMatch: z.coerce.number().int().min(0).max(100).default(70),
  limit: z.coerce.number().int().min(1).max(30).default(5),
});

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
  const statusFilter = String(url.searchParams.get("status") ?? "").trim();
  const minMatchRaw = Number(url.searchParams.get("minMatch") ?? "");
  const minMatch = Number.isFinite(minMatchRaw)
    ? Math.min(Math.max(minMatchRaw, 0), 100)
    : null;

  const rows = await listApplicationsWithOpenings(userId);

  const filtered = rows.filter((row) => {
    if (statusFilter && row.status !== statusFilter) {
      return false;
    }
    if (minMatch != null && Number(row.matchScore ?? 0) < minMatch) {
      return false;
    }
    return true;
  });

  return NextResponse.json({ data: filtered }, { status: 200 });
}

export async function POST(request: Request) {
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
  const parsed = queueTopSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Payload invalido." },
      { status: 400 },
    );
  }

  const db = getDb();
  const fromDate = new Date(
    Date.now() - parsed.data.period * 24 * 60 * 60 * 1000,
  );

  try {
    const candidates = await db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.userId, userId),
          inArray(applications.status, ["suggested", "shortlisted"]),
          gte(applications.createdAt, fromDate),
          gte(applications.matchScore, parsed.data.minMatch),
        ),
      )
      .orderBy(desc(applications.matchScore), desc(applications.createdAt))
      .limit(parsed.data.limit);

    if (candidates.length > 0) {
      await db
        .update(applications)
        .set({
          status: "queued",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(applications.userId, userId),
            inArray(
              applications.id,
              candidates.map((candidate) => candidate.id),
            ),
          ),
        );
    }

    return NextResponse.json(
      {
        data: {
          queuedCount: candidates.length,
          ids: candidates.map((c) => c.id),
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro ao enfileirar recomendadas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
