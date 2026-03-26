import { cvs } from "@hunter/db/schema";
import { NoDatabaseBanner } from "@/components/no-database-banner";
import { getDb } from "@/lib/db";
import { hasDatabase, requireUserId } from "@/lib/session";
import { desc, eq } from "drizzle-orm";
import { CVAnalysisForm } from "./cv-analysis-form";

export default async function SettingsPage() {
  const userId = await requireUserId();
  const dbOk = hasDatabase();

  const savedCvs = dbOk
    ? await getDb()
        .select({
          id: cvs.id,
          fileName: cvs.fileName,
          sizeBytes: cvs.sizeBytes,
          createdAt: cvs.createdAt,
        })
        .from(cvs)
        .where(eq(cvs.userId, userId))
        .orderBy(desc(cvs.createdAt))
        .limit(20)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Definições</h1>
        <p className="mt-1 text-muted-foreground">
          CV, estratégia de caça e integrações.
        </p>
      </div>

      {!dbOk ? <NoDatabaseBanner /> : null}

      <CVAnalysisForm savedCvs={savedCvs} />
    </div>
  );
}
