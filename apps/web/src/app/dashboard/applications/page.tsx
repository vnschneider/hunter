import Link from "next/link";
import { listApplicationsWithOpenings } from "@/lib/dashboard-queries";
import { hasDatabase, requireUserId } from "@/lib/session";
import { NoDatabaseBanner } from "@/components/no-database-banner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";

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

export default async function ApplicationsPage() {
  const userId = await requireUserId();
  const dbOk = hasDatabase();
  const rows = dbOk ? await listApplicationsWithOpenings(userId) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Candidaturas</h1>
        <p className="mt-1 text-muted-foreground">
          Vagas com <strong>URL original</strong> e estado do pipeline (preenchido pelo worker após caçadas).
        </p>
      </div>

      {!dbOk ? <NoDatabaseBanner /> : null}

      {dbOk && rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sem candidaturas</CardTitle>
            <CardDescription>
              Quando o worker registar vagas, aparecem aqui com link e plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Podes continuar a usar o CLI:{" "}
            <code className="rounded bg-muted px-1 py-0.5">bash main.sh</code>
          </CardContent>
        </Card>
      ) : null}

      {dbOk && rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 font-medium">Vaga</th>
                <th className="px-4 py-3 font-medium">Plataforma</th>
                <th className="px-4 py-3 font-medium">Match</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="max-w-[280px] font-medium leading-snug">
                      {r.title}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.platform}</td>
                  <td className="px-4 py-3">
                    {r.matchScore != null ? `${r.matchScore}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusBadgeVariant(r.status)}>
                      {statusLabel[r.status] ?? r.status}
                    </Badge>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
