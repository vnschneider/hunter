import { applications, hunts, openings, strategies } from "@hunter/db/schema";
import { getDb } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

export type DashboardSummary = {
  periodDays: number;
  totals: {
    strategies: number;
    huntsAll: number;
    applicationsAll: number;
  };
  period: {
    huntsStarted: number;
    huntsCompleted: number;
    huntsFailed: number;
    huntsCancelled: number;
    applicationsCreated: number;
    avgMatchScore: number | null;
  };
  topPlatforms: Array<{
    platform: string;
    count: number;
  }>;
};

export async function listStrategies(userId: string) {
  const db = getDb();
  return db
    .select()
    .from(strategies)
    .where(eq(strategies.userId, userId))
    .orderBy(desc(strategies.updatedAt));
}

export async function getStrategy(userId: string, id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.userId !== userId) {
    return null;
  }
  return row;
}

export async function listApplicationsWithOpenings(userId: string) {
  const db = getDb();
  return db
    .select({
      id: applications.id,
      openingUrl: applications.openingUrl,
      status: applications.status,
      matchScore: applications.matchScore,
      createdAt: applications.createdAt,
      updatedAt: applications.updatedAt,
      title: openings.title,
      platform: openings.platform,
    })
    .from(applications)
    .innerJoin(openings, eq(applications.openingId, openings.id))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.updatedAt))
    .limit(200);
}

export async function listHuntsWithStrategies(userId: string) {
  const db = getDb();
  return db
    .select({
      id: hunts.id,
      status: hunts.status,
      createdAt: hunts.createdAt,
      startedAt: hunts.startedAt,
      finishedAt: hunts.finishedAt,
      errorMessage: hunts.errorMessage,
      strategyId: hunts.strategyId,
      strategyName: strategies.name,
    })
    .from(hunts)
    .innerJoin(strategies, eq(hunts.strategyId, strategies.id))
    .where(eq(hunts.userId, userId))
    .orderBy(desc(hunts.createdAt))
    .limit(100);
}

export async function getDashboardSummary(
  userId: string,
  periodDays = 30,
): Promise<DashboardSummary> {
  const db = getDb();
  const days = Math.min(Math.max(periodDays, 1), 365);
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [strategyRows, huntRows, applicationRows] = await Promise.all([
    db
      .select({ id: strategies.id })
      .from(strategies)
      .where(eq(strategies.userId, userId)),
    db
      .select({
        id: hunts.id,
        status: hunts.status,
        startedAt: hunts.startedAt,
      })
      .from(hunts)
      .where(eq(hunts.userId, userId)),
    db
      .select({
        id: applications.id,
        createdAt: applications.createdAt,
        matchScore: applications.matchScore,
        platform: openings.platform,
      })
      .from(applications)
      .innerJoin(openings, eq(applications.openingId, openings.id))
      .where(eq(applications.userId, userId)),
  ]);

  const periodHunts = huntRows.filter(
    (row) => row.startedAt && new Date(row.startedAt) >= fromDate,
  );
  const periodApplications = applicationRows.filter(
    (row) => new Date(row.createdAt) >= fromDate,
  );

  const matchScores = periodApplications
    .map((row) => (row.matchScore == null ? null : Number(row.matchScore)))
    .filter((score): score is number => Number.isFinite(score));

  const avgMatchScore =
    matchScores.length > 0
      ? Math.round(
          matchScores.reduce((acc, score) => acc + score, 0) /
            matchScores.length,
        )
      : null;

  const platformMap = new Map<string, number>();
  for (const row of periodApplications) {
    const key = row.platform || "unknown";
    platformMap.set(key, (platformMap.get(key) ?? 0) + 1);
  }

  const topPlatforms = Array.from(platformMap.entries())
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    periodDays: days,
    totals: {
      strategies: strategyRows.length,
      huntsAll: huntRows.length,
      applicationsAll: applicationRows.length,
    },
    period: {
      huntsStarted: periodHunts.length,
      huntsCompleted: periodHunts.filter((h) => h.status === "completed")
        .length,
      huntsFailed: periodHunts.filter((h) => h.status === "failed").length,
      huntsCancelled: periodHunts.filter((h) => h.status === "cancelled")
        .length,
      applicationsCreated: periodApplications.length,
      avgMatchScore,
    },
    topPlatforms,
  };
}
