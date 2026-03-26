import { NoDatabaseBanner } from "@/components/no-database-banner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  listHuntsWithStrategies,
  listStrategies,
} from "@/lib/dashboard-queries";
import { hasDatabase, requireUserId } from "@/lib/session";
import { HuntsLiveFeed } from "./hunts-live-feed";
import { EnqueueHuntForm } from "./enqueue-hunt-form";
import { StopHuntButton } from "./stop-hunt-button";

type PageProps = {
  searchParams: Promise<{ error?: string; queued?: string; stopped?: string }>;
};

function huntStatusVariant(
  status: string,
): "default" | "secondary" | "success" | "warning" | "destructive" | "muted" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "destructive";
    case "running":
      return "warning";
    case "cancelled":
      return "muted";
    case "pending":
      return "secondary";
    default:
      return "default";
  }
}

export default async function HuntsPage({ searchParams }: PageProps) {
  const userId = await requireUserId();
  const dbOk = hasDatabase();
  const params = await searchParams;

  const [strategies, hunts] = dbOk
    ? await Promise.all([
        listStrategies(userId),
        listHuntsWithStrategies(userId),
      ])
    : [[], []];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Caçadas</h1>
        <p className="mt-1 text-muted-foreground">
          Enfileira uma nova caçada e acompanha o estado de execução do worker.
        </p>
      </div>

      {!dbOk ? <NoDatabaseBanner /> : null}

      {params.queued ? (
        <p className="text-sm text-emerald-700" role="status">
          Hunt enfileirada com sucesso.
        </p>
      ) : null}

      {params.stopped ? (
        <p className="text-sm text-amber-700" role="status">
          Hunt cancelada com sucesso.
        </p>
      ) : null}

      {params.error ? (
        <p className="text-sm text-destructive" role="alert">
          {params.error}
        </p>
      ) : null}

      {dbOk ? (
        <Card>
          <CardHeader>
            <CardTitle>Nova Caçada</CardTitle>
            <CardDescription>
              Seleciona uma estratégia e cria um job do tipo run_hunt.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EnqueueHuntForm
              strategies={strategies.map((s) => ({
                id: s.id,
                name: s.name,
                isActive: s.isActive,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {dbOk ? (
        <Card>
          <CardHeader>
            <CardTitle>Histórico</CardTitle>
            <CardDescription>
              Últimas caçadas criadas para a tua conta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hunts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem hunts ainda.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 font-medium">Estratégia</th>
                      <th className="px-3 py-2 font-medium">Estado</th>
                      <th className="px-3 py-2 font-medium">Criada</th>
                      <th className="px-3 py-2 font-medium">Início/Fim</th>
                      <th className="px-3 py-2 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hunts.map((hunt) => (
                      <tr
                        key={hunt.id}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="px-3 py-2">
                          <p className="font-medium">{hunt.strategyName}</p>
                          <p className="text-xs text-muted-foreground">
                            {hunt.id}
                          </p>
                          {hunt.errorMessage ? (
                            <p className="mt-1 text-xs text-destructive">
                              {hunt.errorMessage}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={huntStatusVariant(hunt.status)}>
                            {hunt.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(hunt.createdAt).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {hunt.startedAt
                            ? new Date(hunt.startedAt).toLocaleString("pt-BR")
                            : "-"}
                          {" / "}
                          {hunt.finishedAt
                            ? new Date(hunt.finishedAt).toLocaleString("pt-BR")
                            : "-"}
                        </td>
                        <td className="px-3 py-2">
                          {hunt.status === "pending" ||
                          hunt.status === "running" ? (
                            <StopHuntButton huntId={hunt.id} />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              -
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {dbOk ? (
        <Card>
          <CardHeader>
            <CardTitle>Live (Polling)</CardTitle>
            <CardDescription>
              Atualiza eventos da hunt em tempo quase real a cada 4 segundos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HuntsLiveFeed
              hunts={hunts.map((hunt) => ({
                id: hunt.id,
                status: hunt.status,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
