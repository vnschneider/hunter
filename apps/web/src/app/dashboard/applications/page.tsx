import Link from "next/link";
import {
  listApplicationsWithOpenings,
  listHuntsWithStrategies,
} from "@/lib/dashboard-queries";
import { hasDatabase, requireUserId } from "@/lib/session";
import { NoDatabaseBanner } from "@/components/no-database-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowUpRight,
  CalendarDays,
  ExternalLink,
  Filter,
  Sparkles,
  Target,
} from "lucide-react";
import { ApplicationsLivePreview } from "./applications-live-preview";
import { ApplicationsActionsCell } from "./applications-actions-cell";
import { QueueTopRecommendedForm } from "./queue-top-recommended-form";

type PageProps = {
  searchParams: Promise<{
    period?: string;
    minMatch?: string;
    updated?: string;
    queuedTop?: string;
    error?: string;
  }>;
};

const PERIOD_OPTIONS = [1, 7, 30, 90] as const;

function statusBadgeVariant(
  s: string,
): "default" | "secondary" | "success" | "warning" | "destructive" | "muted" {
  switch (s) {
    case "applied":
      return "success";
    case "failed":
      return "destructive";
    case "queued":
    case "applying":
      return "warning";
    case "skipped":
      return "muted";
    case "shortlisted":
      return "default";
    default:
      return "secondary";
  }
}

const statusLabel: Record<string, string> = {
  suggested: "Sugerida",
  shortlisted: "Pré-selecionada",
  queued: "Em fila",
  applying: "A candidatar",
  applied: "Candidatada",
  failed: "Falhou",
  skipped: "Ignorada",
};

function extractTailoredPdfPath(notes: string | null) {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as {
      tailoredResume?: { pdfStoragePath?: string | null };
    };
    const path = parsed?.tailoredResume?.pdfStoragePath;
    return path ? String(path) : null;
  } catch {
    return null;
  }
}

export default async function ApplicationsPage({ searchParams }: PageProps) {
  const userId = await requireUserId();
  const dbOk = hasDatabase();
  const params = await searchParams;

  const requestedPeriod = Number(params.period ?? "7");
  const periodDays = PERIOD_OPTIONS.includes(requestedPeriod as 1 | 7 | 30 | 90)
    ? requestedPeriod
    : 7;

  const requestedMinMatch = Number(params.minMatch ?? "70");
  const minMatch = Number.isFinite(requestedMinMatch)
    ? Math.min(Math.max(requestedMinMatch, 0), 100)
    : 70;

  const [rows, hunts] = dbOk
    ? await Promise.all([
        listApplicationsWithOpenings(userId),
        listHuntsWithStrategies(userId),
      ])
    : [[], []];
  const fromDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const rowsInPeriod = rows.filter((r) => new Date(r.createdAt) >= fromDate);
  const rowsRanked = [...rowsInPeriod].sort((a, b) => {
    const scoreA = Number(a.matchScore ?? -1);
    const scoreB = Number(b.matchScore ?? -1);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const recommended = rowsRanked.filter(
    (row) => Number(row.matchScore ?? 0) >= minMatch,
  );
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const todayCount = rows.filter(
    (r) => new Date(r.createdAt) >= startOfToday,
  ).length;
  const todayRows = rows
    .filter((r) => new Date(r.createdAt) >= startOfToday)
    .sort((a, b) => Number(b.matchScore ?? 0) - Number(a.matchScore ?? 0));

  const uniquePlatforms = new Set(rowsInPeriod.map((r) => r.platform)).size;

  function hrefFor(nextPeriod: number) {
    return `/dashboard/applications?period=${nextPeriod}&minMatch=${minMatch}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Oportunidades e Candidaturas
        </h1>
        <p className="mt-1 text-muted-foreground">
          Lista de vagas por dia ou período, ranqueadas por match do teu perfil
          para candidatura imediata.
        </p>
      </div>

      {!dbOk ? <NoDatabaseBanner /> : null}

      {params.updated ? (
        <p className="text-sm text-emerald-700" role="status">
          Estado atualizado para {statusLabel[params.updated] ?? params.updated}
          .
        </p>
      ) : null}

      {params.queuedTop ? (
        <p className="text-sm text-emerald-700" role="status">
          {params.queuedTop} vagas recomendadas foram enfileiradas para
          candidatura.
        </p>
      ) : null}

      {params.error ? (
        <p className="text-sm text-destructive" role="alert">
          {params.error}
        </p>
      ) : null}

      {dbOk ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="h-4 w-4" />
              Filtros de oportunidades
            </CardTitle>
            <CardDescription>
              Ajusta o período e o match mínimo para recomendar vagas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {PERIOD_OPTIONS.map((days) => (
                <Link
                  key={days}
                  href={hrefFor(days)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    periodDays === days
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {days === 1 ? "Hoje" : `${days} dias`}
                </Link>
              ))}
            </div>
            <form
              action="/dashboard/applications"
              method="get"
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <input type="hidden" name="period" value={periodDays} />
              <Input
                type="number"
                name="minMatch"
                min={0}
                max={100}
                defaultValue={minMatch}
                className="sm:max-w-[180px]"
              />
              <Button type="submit" variant="outline" size="sm">
                Aplicar match mínimo
              </Button>
            </form>
            <QueueTopRecommendedForm period={periodDays} minMatch={minMatch} />
          </CardContent>
        </Card>
      ) : null}

      {dbOk ? (
        <ApplicationsLivePreview
          hunts={hunts.map((hunt) => ({
            id: hunt.id,
            status: hunt.status,
          }))}
        />
      ) : null}

      {dbOk ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Vagas hoje</CardDescription>
              <CardTitle className="text-2xl">{todayCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Vagas no período</CardDescription>
              <CardTitle className="text-2xl">{rowsInPeriod.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Recomendadas</CardDescription>
              <CardTitle className="text-2xl">{recommended.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Plataformas ativas</CardDescription>
              <CardTitle className="text-2xl">{uniquePlatforms}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      ) : null}

      {dbOk ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              Top vagas de hoje
            </CardTitle>
            <CardDescription>
              Recomendações atualizadas no dia com base no match do teu perfil.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {todayRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ainda não há vagas geradas hoje. Executa uma hunt para popular
                esta seção.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {todayRows.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-snug">
                        {item.title}
                      </p>
                      <Badge variant="success">
                        {Number(item.matchScore ?? 0)}%
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.platform}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <Badge variant={statusBadgeVariant(item.status)}>
                        {statusLabel[item.status] ?? item.status}
                      </Badge>
                      <Button asChild size="sm" className="gap-1">
                        <Link
                          href={item.openingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Candidatar
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {dbOk && rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sem oportunidades ainda</CardTitle>
            <CardDescription>
              Quando o worker registar vagas, aparecem aqui com link e
              plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Inicia uma hunt no painel para popular automaticamente esta lista.
          </CardContent>
        </Card>
      ) : null}

      {dbOk && rowsInPeriod.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Recomendadas para candidatura agora
            </CardTitle>
            <CardDescription>Match mínimo atual: {minMatch}%.</CardDescription>
          </CardHeader>
          <CardContent>
            {recommended.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma vaga atingiu o match mínimo neste período. Reduz o
                filtro para ampliar as recomendações.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {recommended.slice(0, 8).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border bg-muted/20 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold leading-snug">
                          {item.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.platform}
                        </p>
                      </div>
                      <Badge variant="success">
                        <Target className="mr-1 h-3.5 w-3.5" />
                        {Number(item.matchScore ?? 0)}%
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
                        {new Date(item.createdAt).toLocaleString("pt-BR")}
                      </p>
                      <Button asChild size="sm" className="gap-1">
                        <Link
                          href={item.openingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Candidatar
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {dbOk && rowsInPeriod.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
            <h2 className="text-sm font-semibold">Lista completa do período</h2>
            <p className="text-xs text-muted-foreground">
              Ordenada por match e recência
            </p>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 font-medium">Vaga</th>
                <th className="px-4 py-3 font-medium">Plataforma</th>
                <th className="px-4 py-3 font-medium">Match</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Link</th>
                <th className="px-4 py-3 font-medium">CV ATS</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rowsRanked.map((r) => {
                const tailoredPdfPath = extractTailoredPdfPath(r.notes);
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="max-w-[280px] font-medium leading-snug">
                        {r.title}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.platform}
                    </td>
                    <td className="px-4 py-3">
                      {r.matchScore != null ? `${r.matchScore}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadgeVariant(r.status)}>
                        {statusLabel[r.status] ?? r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={r.openingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        Abrir
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {tailoredPdfPath ? (
                        <Link
                          href={`/api/applications/${r.id}/tailored-resume`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Baixar PDF
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ApplicationsActionsCell
                        applicationId={r.id}
                        status={r.status}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
