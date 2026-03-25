import { eq } from "drizzle-orm";
import { profiles } from "@hunter/db/schema";
import { getDb } from "@/lib/db";

type User = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

export async function ensureProfile(user: User) {
  if (!process.env.DATABASE_URL) {
    return;
  }
  const db = getDb();
  const now = new Date();
  await db
    .insert(profiles)
    .values({
      userId: user.id,
      email: user.email ?? null,
      displayName: user.name ?? null,
      avatarUrl: user.image ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: {
        email: user.email ?? null,
        displayName: user.name ?? null,
        avatarUrl: user.image ?? null,
        updatedAt: now,
      },
    });
}

export async function getProfile(userId: string) {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}
