import { auth } from "@/auth";
import {
  listApplicationsWithOpenings,
  listHuntsWithStrategies,
} from "@/lib/dashboard-queries";
import { hasDatabase } from "@/lib/session";
import { NextResponse } from "next/server";

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\n") || raw.includes('"')) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

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
  const periodRaw = Number(url.searchParams.get("period") ?? "30");
  const minMatchRaw = Number(url.searchParams.get("minMatch") ?? "0");
  const format = String(url.searchParams.get("format") ?? "json").toLowerCase();

  const periodDays = Number.isFinite(periodRaw)
    ? Math.min(Math.max(periodRaw, 1), 365)
    : 30;
  const minMatch = Number.isFinite(minMatchRaw)
    ? Math.min(Math.max(minMatchRaw, 0), 100)
    : 0;

  const fromDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const [applications, hunts] = await Promise.all([
    listApplicationsWithOpenings(userId),
    listHuntsWithStrategies(userId),
  ]);

  const periodApplications = applications
    .filter((row) => new Date(row.createdAt) >= fromDate)
    .filter((row) => Number(row.matchScore ?? 0) >= minMatch)
    .sort((a, b) => Number(b.matchScore ?? 0) - Number(a.matchScore ?? 0));

  const periodHunts = hunts.filter((row) => {
    const sourceDate = row.startedAt ?? row.createdAt;
    return new Date(sourceDate) >= fromDate;
  });

  const byStatus = periodApplications.reduce<Record<string, number>>(
    (acc, row) => {
      const key = row.status || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const byPlatform = periodApplications.reduce<Record<string, number>>(
    (acc, row) => {
      const key = row.platform || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const matchScores = periodApplications
    .map((row) => Number(row.matchScore ?? NaN))
    .filter((value) => Number.isFinite(value));

  const avgMatchScore =
    matchScores.length > 0
      ? Math.round(
          matchScores.reduce((sum, score) => sum + score, 0) /
            matchScores.length,
        )
      : null;

  const payload = {
    generatedAt: new Date().toISOString(),
    periodDays,
    minMatch,
    hunts: {
      total: periodHunts.length,
      completed: periodHunts.filter((row) => row.status === "completed").length,
      failed: periodHunts.filter((row) => row.status === "failed").length,
      cancelled: periodHunts.filter((row) => row.status === "cancelled").length,
    },
    applications: {
      total: periodApplications.length,
      avgMatchScore,
      byStatus,
      byPlatform,
      rows: periodApplications.map((row) => ({
        id: row.id,
        title: row.title,
        platform: row.platform,
        status: row.status,
        matchScore: Number(row.matchScore ?? 0),
        openingUrl: row.openingUrl,
        createdAt: row.createdAt,
      })),
    },
  };

  if (format === "csv") {
    const header = [
      "id",
      "title",
      "platform",
      "status",
      "matchScore",
      "openingUrl",
      "createdAt",
    ].join(",");

    const lines = payload.applications.rows.map((row) =>
      [
        csvEscape(row.id),
        csvEscape(row.title),
        csvEscape(row.platform),
        csvEscape(row.status),
        csvEscape(row.matchScore),
        csvEscape(row.openingUrl),
        csvEscape(row.createdAt),
      ].join(","),
    );

    return new Response([header, ...lines].join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=report-${periodDays}d.csv`,
      },
    });
  }

  return NextResponse.json({ data: payload }, { status: 200 });
}
