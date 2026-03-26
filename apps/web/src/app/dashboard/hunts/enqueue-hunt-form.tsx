"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type StrategyOption = {
  id: string;
  name: string;
  isActive: boolean;
};

type Props = {
  strategies: StrategyOption[];
};

export function EnqueueHuntForm({ strategies }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [strategyId, setStrategyId] = useState(
    strategies.find((s) => s.isActive)?.id ?? strategies[0]?.id ?? "",
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  if (strategies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Cria uma estratégia em /dashboard/strategies antes de iniciar hunts.
      </p>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    const response = await fetch("/api/hunts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategyId }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? `Erro ${response.status}`);
      return;
    }

    setMessage("Hunt enfileirada com sucesso.");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <select
          name="strategyId"
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:max-w-md"
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
        >
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.isActive ? " (activa)" : ""}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={isPending || !strategyId}>
          Enfileirar Hunt
        </Button>
      </form>

      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
