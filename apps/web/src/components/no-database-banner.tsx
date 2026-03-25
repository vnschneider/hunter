import { AlertTriangle } from "lucide-react";

export function NoDatabaseBanner() {
  return (
    <div
      className="mb-6 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
      role="status"
    >
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">Base de dados não configurada</p>
        <p className="mt-1 text-muted-foreground">
          Define <code className="rounded bg-muted px-1 py-0.5 text-xs">DATABASE_URL</code>{" "}
          em <code className="rounded bg-muted px-1 py-0.5 text-xs">apps/web/.env.local</code>{" "}
          e corre <code className="rounded bg-muted px-1 py-0.5 text-xs">yarn db:push</code> na raiz do monorepo.
        </p>
      </div>
    </div>
  );
}
