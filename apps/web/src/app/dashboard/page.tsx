import Link from "next/link";
import { auth } from "@/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Sparkles } from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-muted-foreground">
          Resumo da tua conta Hunter. Em seguida liga o worker e as caçadas.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Estado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Worker ainda não ligado — configura{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">DATABASE_URL</code>{" "}
              e executa migrações Drizzle.
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Próximos passos</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="text-sm leading-relaxed">
              Gere{" "}
              <Link href="/dashboard/strategies" className="font-medium text-primary underline-offset-4 hover:underline">
                estratégias de caça
              </Link>
              , vê candidaturas e, em seguida, liga o worker. Mais em{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">docs/</code>.
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
