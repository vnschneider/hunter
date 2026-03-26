import Link from "next/link";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/session";
import { getDashboardSummary } from "@/lib/dashboard-queries";
import { NoDatabaseBanner } from "@/components/no-database-banner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Sparkles, TrendingUp, Target } from "lucide-react";

type PageProps = {
  searchParams: Promise<{ period?: string }>;
};

const PERIOD_OPTIONS = [7, 30, 90];

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await auth();
  const params = await searchParams;
  const requestedPeriod = Number(params.period ?? "30");
  const period = PERIOD_OPTIONS.includes(requestedPeriod)
    ? requestedPeriod
    : 30;
  const dbOk = hasDatabase();

  const summary =
    dbOk && session?.user?.id
      ? await getDashboardSummary(session.user.id, period)
      : null;

  const completionRate =
    summary && summary.period.huntsStarted > 0
      ? Math.round(
          (summary.period.huntsCompleted / summary.period.huntsStarted) * 100,
        )
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-muted-foreground">
          Resumo operacional da tua conta Hunter.
        </p>
      </div>

      {!dbOk ? <NoDatabaseBanner /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map((days) => (
          <Link
            key={days}
            href={`/dashboard?period=${days}`}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              period === days
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            Últimos {days} dias
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">
              Hunts no período
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {summary?.period.huntsStarted ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">
              Concluídas: {summary?.period.huntsCompleted ?? 0} | Falharam:{" "}
              {summary?.period.huntsFailed ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Target className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">
              Candidaturas criadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {summary?.period.applicationsCreated ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">
              Total acumulado: {summary?.totals.applicationsAll ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Match médio</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {summary?.period.avgMatchScore != null
                ? `${summary.period.avgMatchScore}%`
                : "-"}
            </p>
            <p className="text-xs text-muted-foreground">
              Em vagas criadas no período
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">
              Taxa de conclusão
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {completionRate != null ? `${completionRate}%` : "-"}
            </p>
            <p className="text-xs text-muted-foreground">
              Hunts concluídas / iniciadas
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funil no período</CardTitle>
            <CardDescription>
              Visão rápida da execução nos últimos {period} dias.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-sm">Hunts iniciadas</span>
              <Badge variant="secondary">
                {summary?.period.huntsStarted ?? 0}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-sm">Hunts concluídas</span>
              <Badge variant="success">
                {summary?.period.huntsCompleted ?? 0}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-sm">Hunts canceladas</span>
              <Badge variant="muted">
                {summary?.period.huntsCancelled ?? 0}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-sm">Hunts com falha</span>
              <Badge variant="destructive">
                {summary?.period.huntsFailed ?? 0}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top plataformas</CardTitle>
            <CardDescription>
              Origem das candidaturas criadas nos últimos {period} dias.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summary && summary.topPlatforms.length > 0 ? (
              <div className="space-y-2">
                {summary.topPlatforms.map((item) => (
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
                Ainda sem candidaturas no período selecionado.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Próximos passos</CardTitle>
          <CardDescription>
            Ações recomendadas para aumentar volume e qualidade das
            oportunidades.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          <p>
            1. Refinar
            <Link
              href="/dashboard/strategies"
              className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              estratégias
            </Link>
            com palavras negativas e senioridade.
          </p>
          <p>
            2. Acompanhar
            <Link
              href="/dashboard/hunts"
              className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              hunts ao vivo
            </Link>
            e cancelar execuções ruins cedo.
          </p>
          <p>
            3. Revisar
            <Link
              href="/dashboard/applications"
              className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              candidaturas
            </Link>
            por match para priorizar aplicações manuais.
          </p>
          <p>
            4. Atualizar CV em
            <Link
              href="/dashboard/settings"
              className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              definições
            </Link>
            para melhorar scoring.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
