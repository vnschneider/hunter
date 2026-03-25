import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Definições</h1>
        <p className="mt-1 text-muted-foreground">
          CV, estratégia de caça e integrações.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Em breve</CardTitle>
          <CardDescription>
            Upload de CV, assistente de IA e preferências de notificação.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Variáveis de ambiente e Supabase Storage estão descritos em{" "}
          <code className="rounded bg-muted px-1 py-0.5">docs/integracoes-externas.md</code>.
        </CardContent>
      </Card>
    </div>
  );
}
