"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type ApplicationStatus =
  | "suggested"
  | "shortlisted"
  | "queued"
  | "applying"
  | "applied"
  | "failed"
  | "skipped";

type Props = {
  applicationId: string;
  status: ApplicationStatus;
};

export function ApplicationsActionsCell({ applicationId, status }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const availableActions = useMemo(() => {
    return {
      canShortlist: status !== "applied",
      canQueue: status !== "applied" && status !== "queued",
      canMarkApplied:
        status === "queued" ||
        status === "applying" ||
        status === "shortlisted",
      canSkip: status !== "applied" && status !== "skipped",
    };
  }, [status]);

  async function patchStatus(
    nextStatus: "shortlisted" | "queued" | "skipped" | "applied",
  ) {
    setError("");

    const response = await fetch(`/api/applications/${applicationId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Erro ${response.status}`);
    }

    startTransition(() => {
      router.refresh();
    });
  }

  async function handleClick(
    nextStatus: "shortlisted" | "queued" | "skipped" | "applied",
  ) {
    try {
      await patchStatus(nextStatus);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao atualizar status.",
      );
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {availableActions.canShortlist ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              void handleClick("shortlisted");
            }}
          >
            Pré-selecionar
          </Button>
        ) : null}

        {availableActions.canQueue ? (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => {
              void handleClick("queued");
            }}
          >
            Enfileirar
          </Button>
        ) : null}

        {availableActions.canMarkApplied ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isPending}
            onClick={() => {
              void handleClick("applied");
            }}
          >
            Marcar enviada
          </Button>
        ) : null}

        {availableActions.canSkip ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-destructive"
            disabled={isPending}
            onClick={() => {
              void handleClick("skipped");
            }}
          >
            Ignorar
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
