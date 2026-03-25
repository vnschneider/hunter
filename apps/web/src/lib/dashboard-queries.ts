import { applications, openings, strategies } from "@hunter/db/schema";
import { getDb } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

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
