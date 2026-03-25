import Link from "next/link";
import { StrategyCreateForm } from "../strategy-create-form";
import { hasDatabase } from "@/lib/session";
import { NoDatabaseBanner } from "@/components/no-database-banner";
import { Button } from "@/components/ui/button";

export default function NewStrategyPage() {
  const dbOk = hasDatabase();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/strategies">← Voltar</Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nova estratégia</h1>
        <p className="mt-1 text-muted-foreground">
          O texto principal será enviado ao agente tal como no{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">user-prompt.md</code>.
        </p>
      </div>
      {!dbOk ? <NoDatabaseBanner /> : <StrategyCreateForm />}
    </div>
  );
}
