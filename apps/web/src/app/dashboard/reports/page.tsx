import Link from "next/link";
import { hasDatabase, requireUserId } from "@/lib/session";
import {
  listApplicationsWithOpenings,
  listHuntsWithStrategies,
} from "@/lib/dashboard-queries";
import { NoDatabaseBanner } from "@/components/no-database-banner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type PageProps = {
  searchParams: Promise<{ period?: string; minMatch?: string }>;
};

const PERIOD_OPTIONS = [7, 30, 90] as const;

export default async function ReportsPage({ searchParams }: PageProps) {
  const userId = await requireUserId();
  const dbOk = hasDatabase();
  const params = await searchParams;

  const requestedPeriod = Number(params.period ?? "30");
  const periodDays = PERIOD_OPTIONS.includes(requestedPeriod as 7 | 30 | 90)
    ? requestedPeriod
    : 30;

  const requestedMinMatch = Number(params.minMatch ?? "70");
  const minMatch = Number.isFinite(requestedMinMatch)
    ? Math.min(Math.max(requestedMinMatch, 0), 100)
    : 70;

  const fromDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const [applications, hunts] = dbOk
    ? await Promise.all([
        listApplicationsWithOpenings(userId),
        listHuntsWithStrategies(userId),
      ])
    : [[], []];

  const periodApplications = applications
    .filter((row) => new Date(row.createdAt) >= fromDate)
    .filter((row) => Number(row.matchScore ?? 0) >= minMatch);

  const periodHunts = hunts.filter((row) => {
    const sourceDate = row.startedAt ?? row.createdAt;
    return new Date(sourceDate) >= fromDate;
  });

  const avgMatchScore =
    periodApplications.length > 0
      ? Math.round(
          periodApplications.reduce(
            (acc, row) => acc + Number(row.matchScore ?? 0),
            0,
          ) / periodApplications.length,
        )
      : null;

  const byPlatform = periodApplications.reduce<Record<string, number>>(
    (acc, row) => {
      const key = row.platform || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const topPlatforms = Object.entries(byPlatform)
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const exportJsonHref = `/api/reports/period?period=${periodDays}&minMatch=${minMatch}`;
  const exportCsvHref = `${exportJsonHref}&format=csv`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="mt-1 text-muted-foreground">
          Consolida resultados por período e exporta para automação.
        </p>
      </div>

      {!dbOk ? <NoDatabaseBanner /> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtro do relatório</CardTitle>
          <CardDescription>
            Ajusta janela de tempo e match mínimo para os exports.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {PERIOD_OPTIONS.map((days) => (
              <Link
                key={days}
                href={`/dashboard/reports?period=${days}&minMatch=${minMatch}`}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  periodDays === days
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                Últimos {days} dias
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[50, 60, 70, 80].map((score) => (
              <Link
                key={score}
                href={`/dashboard/reports?period=${periodDays}&minMatch=${score}`}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  minMatch === score
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                Match ≥ {score}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={exportJsonHref}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              Exportar JSON
            </a>
            <a
              href={exportCsvHref}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              Exportar CSV
            </a>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Hunts no período</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{periodHunts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Candidaturas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {periodApplications.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Match médio</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {avgMatchScore == null ? "-" : `${avgMatchScore}%`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Concluídas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {periodHunts.filter((row) => row.status === "completed").length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top plataformas</CardTitle>
          <CardDescription>
            Origem das candidaturas no período selecionado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topPlatforms.length > 0 ? (
            <div className="space-y-2">
              {topPlatforms.map((item) => (
                <div
                  key={item.platform}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <span className="text-sm font-medium">{item.platform}</span>
                  <Badge variant="outline">{item.count}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ainda sem dados para o período/filtro selecionado.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
