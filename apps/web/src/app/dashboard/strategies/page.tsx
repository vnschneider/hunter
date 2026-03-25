import Link from "next/link";
import { deleteStrategy, setActiveStrategy } from "./actions";
import { listStrategies } from "@/lib/dashboard-queries";
import { hasDatabase, requireUserId } from "@/lib/session";
import { NoDatabaseBanner } from "@/components/no-database-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function StrategiesPage({ searchParams }: PageProps) {
  const userId = await requireUserId();
  const params = await searchParams;
  const dbOk = hasDatabase();

  const rows = dbOk ? await listStrategies(userId) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Estratégias</h1>
          <p className="mt-1 text-muted-foreground">
            Critérios enviados ao agente (texto + JSON opcional). Uma pode estar{" "}
            <strong>activa</strong> para futuras caçadas.
          </p>
        </div>
        {dbOk ? (
          <Button asChild>
            <Link href="/dashboard/strategies/new">
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Nova estratégia
            </Link>
          </Button>
        ) : null}
      </div>

      {!dbOk ? <NoDatabaseBanner /> : null}

      {params.error ? (
        <p className="text-sm text-destructive" role="alert">
          {params.error}
        </p>
      ) : null}

      {dbOk && rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Ainda sem estratégias</CardTitle>
            <CardDescription>
              Cria a primeira para guardar o teu &quot;user prompt&quot; estruturado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/strategies/new">Criar estratégia</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {dbOk && rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Acções</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {s.promptText}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.isActive ? (
                      <Badge variant="success">Activa</Badge>
                    ) : (
                      <Badge variant="secondary">Inactiva</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {!s.isActive ? (
                        <form action={setActiveStrategy}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button type="submit" variant="outline" size="sm">
                            <Star className="mr-1 h-3.5 w-3.5" aria-hidden />
                            Activar
                          </Button>
                        </form>
                      ) : null}
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/strategies/${s.id}/edit`}>
                          <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
                          Editar
                        </Link>
                      </Button>
                      <form action={deleteStrategy}>
                        <input type="hidden" name="id" value={s.id} />
                        <Button
                          type="submit"
                          variant="destructive"
                          size="sm"
                          title="Só permitido se não existirem caçadas com esta estratégia"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </form>
                    </div>
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
