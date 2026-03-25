import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@hunter/db/schema";

type GlobalWithDb = typeof globalThis & {
  hunterPostgres?: ReturnType<typeof postgres>;
};

function getPostgres() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não definido");
  }
  const g = globalThis as GlobalWithDb;
  if (!g.hunterPostgres) {
    g.hunterPostgres = postgres(url, { max: 10, prepare: false });
  }
  return g.hunterPostgres;
}

export function getDb() {
  return drizzle(getPostgres(), { schema });
}
