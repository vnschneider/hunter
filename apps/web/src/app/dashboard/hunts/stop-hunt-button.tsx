"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  huntId: string;
};

export function StopHuntButton({ huntId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function handleStop() {
    setError("");

    const response = await fetch(`/api/hunts/${huntId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? `Erro ${response.status}`);
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-destructive"
        disabled={isPending}
        onClick={() => {
          void handleStop();
        }}
      >
        Parar
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
