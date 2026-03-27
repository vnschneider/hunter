import { cvs } from "@hunter/db/schema";
import { NoDatabaseBanner } from "@/components/no-database-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

      <Card>
        <CardHeader>
          <CardTitle>Notificações e relatórios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            O Hunter mantém notificações em tempo real dentro do painel e também
            suporta envio externo por webhook e email (sem Discord).
          </p>
          <p>
            Relatório JSON:{" "}
            <span className="font-mono">
              /api/reports/period?period=30&amp;minMatch=70
            </span>
          </p>
          <p>
            Relatório CSV:{" "}
            <span className="font-mono">
              /api/reports/period?period=30&amp;minMatch=70&amp;format=csv
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
