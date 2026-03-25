import Link from "next/link";
import { notFound } from "next/navigation";
import { getStrategy } from "@/lib/dashboard-queries";
import { StrategyEditForm } from "../../strategy-edit-form";
import { requireUserId } from "@/lib/session";
import { hasDatabase } from "@/lib/session";
import { NoDatabaseBanner } from "@/components/no-database-banner";
import { Button } from "@/components/ui/button";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditStrategyPage({ params }: PageProps) {
  const { id } = await params;
  const userId = await requireUserId();

  if (!hasDatabase()) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/strategies">← Voltar</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Editar estratégia</h1>
        <NoDatabaseBanner />
      </div>
    );
  }

  const row = await getStrategy(userId, id);
  if (!row) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/strategies">← Voltar</Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Editar estratégia</h1>
        <p className="mt-1 text-muted-foreground">{row.name}</p>
      </div>
      <StrategyEditForm
        strategyId={row.id}
        name={row.name}
        promptText={row.promptText}
        criteriaJson={row.criteriaJson}
      />
    </div>
  );
}
