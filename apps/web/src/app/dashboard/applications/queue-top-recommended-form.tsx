"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  period: number;
  minMatch: number;
};

export function QueueTopRecommendedForm({ period, minMatch }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [limit, setLimit] = useState(5);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setError("");

    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period, minMatch, limit }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? `Erro ${response.status}`);
      return;
    }

    const body = await response.json();
    const queuedCount = Number(body?.data?.queuedCount ?? 0);
    setMessage(`${queuedCount} vagas recomendadas enfileiradas.`);

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 border-t border-border/70 pt-3">
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <Input
          type="number"
          name="limit"
          min={1}
          max={30}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value || 5))}
          className="sm:max-w-[180px]"
        />
        <Button type="submit" size="sm" disabled={isPending}>
          Enfileirar top recomendadas
        </Button>
      </form>

      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
