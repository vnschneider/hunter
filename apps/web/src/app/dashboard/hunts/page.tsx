import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HuntsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Caçadas</h1>
        <p className="mt-1 text-muted-foreground">
          Histórico de execuções do agente e exportações CSV.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Em breve</CardTitle>
          <CardDescription>
            Lista de hunts, estados e ligação ao worker serão ligados aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Enquanto isso, podes continuar a usar{" "}
          <code className="rounded bg-muted px-1 py-0.5">bash main.sh</code> no
          repositório raiz.
        </CardContent>
      </Card>
    </div>
  );
}
