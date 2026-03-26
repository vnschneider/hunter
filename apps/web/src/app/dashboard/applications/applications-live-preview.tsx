"use client";

import { useEffect, useMemo, useState } from "react";

type HuntOption = {
  id: string;
  status: string;
};

type HuntEventRow = {
  id: number;
  eventType: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

type Props = {
  hunts: HuntOption[];
};

function formatPhase(phase: string) {
  switch (phase) {
    case "pipeline_setup":
      return "Preparando pipeline";
    case "search_started":
      return "Buscando vagas";
    case "search_provider_hint":
      return "Consultando fontes";
    case "provider_summary":
      return "Resumo por fonte";
    case "opening_preview":
      return "Vaga encontrada";
    case "score_started":
      return "Pontuando vagas";
    case "score_progress":
      return "Pontuação em progresso";
    case "score_item_done":
      return "Vaga pontuada";
    case "persist_started":
      return "Criando candidaturas";
    case "persist_progress":
      return "Persistindo resultados";
    case "persist_done":
      return "Persistência concluída";
    case "mcp_pipeline_done":
      return "Busca concluída";
    case "pipeline_heartbeat":
      return "Pipeline ativa";
    default:
      return phase;
  }
}

export function ApplicationsLivePreview({ hunts }: Props) {
  const defaultHuntId = useMemo(
    () => hunts.find((h) => h.status === "running")?.id ?? hunts[0]?.id ?? "",
    [hunts],
  );

  const [huntId, setHuntId] = useState(defaultHuntId);
  const [cursor, setCursor] = useState(0);
  const [events, setEvents] = useState<HuntEventRow[]>([]);
  const [error, setError] = useState("");

  const latestProgress = useMemo(() => {
    const progressEvent = events.find(
      (event) => event.eventType === "hunt_progress",
    );
    const payload = progressEvent?.payload ?? {};

    return {
      phase:
        typeof payload.phase === "string" && payload.phase.trim().length > 0
          ? payload.phase
          : null,
      rawCount:
        typeof payload.rawCount === "number" ? Number(payload.rawCount) : null,
      dedupedCount:
        typeof payload.dedupedCount === "number"
          ? Number(payload.dedupedCount)
          : null,
      scoredCount:
        typeof payload.scoredCount === "number"
          ? Number(payload.scoredCount)
          : null,
      persisted:
        typeof payload.persisted === "number"
          ? Number(payload.persisted)
          : null,
      totalToPersist:
        typeof payload.totalToPersist === "number"
          ? Number(payload.totalToPersist)
          : null,
      message:
        typeof payload.message === "string" && payload.message.trim().length > 0
          ? payload.message
          : null,
    };
  }, [events]);

  const recentItems = useMemo(
    () =>
      events
        .filter((event) => {
          const payload = event.payload ?? {};
          return (
            event.eventType === "application_created" ||
            (event.eventType === "hunt_progress" &&
              (payload.phase === "opening_preview" ||
                payload.phase === "score_item_done"))
          );
        })
        .slice(0, 10),
    [events],
  );

  const isRunning = useMemo(() => {
    const selected = hunts.find((hunt) => hunt.id === huntId);
    return selected?.status === "running";
  }, [hunts, huntId]);

  useEffect(() => {
    setHuntId(defaultHuntId);
  }, [defaultHuntId]);

  useEffect(() => {
    setCursor(0);
    setEvents([]);
    setError("");
  }, [huntId]);

  useEffect(() => {
    if (!huntId) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const response = await fetch(
          `/api/hunts/${huntId}/events?afterId=${cursor}&limit=40`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `Erro ${response.status}`);
        }

        const body = await response.json();
        if (cancelled) return;

        const rows = (body.data ?? []) as HuntEventRow[];
        if (rows.length > 0) {
          setEvents((prev) => [...rows, ...prev].slice(0, 120));
          setCursor(Number(body.nextCursor ?? cursor));
        }

        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao obter preview");
      }
    };

    void tick();
    const interval = setInterval(
      () => {
        void tick();
      },
      isRunning ? 3000 : 7000,
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [huntId, cursor, isRunning]);

  if (!huntId) {
    return (
      <p className="text-sm text-muted-foreground">
        Ainda não há hunts para mostrar preview em tempo real.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">
            Preview da hunt na aba de aplicações
          </p>
          <p className="text-xs text-muted-foreground">
            Mostra progresso antes das candidaturas aparecerem na lista final.
          </p>
        </div>
        <select
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:max-w-md"
          value={huntId}
          onChange={(e) => setHuntId(e.target.value)}
        >
          {hunts.map((hunt) => (
            <option key={hunt.id} value={hunt.id}>
              {hunt.id} ({hunt.status})
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <p>
          Etapa:{" "}
          {latestProgress.phase ? formatPhase(latestProgress.phase) : "-"}
        </p>
        <p>Encontradas: {latestProgress.rawCount ?? "-"}</p>
        <p>Pontuadas: {latestProgress.scoredCount ?? "-"}</p>
        <p>
          Persistidas: {latestProgress.persisted ?? "-"}
          {typeof latestProgress.totalToPersist === "number"
            ? ` / ${latestProgress.totalToPersist}`
            : ""}
        </p>
      </div>

      {latestProgress.message ? (
        <p className="text-sm text-muted-foreground">
          {latestProgress.message}
        </p>
      ) : null}

      <div className="max-h-[260px] overflow-auto rounded-md border border-border/70 bg-muted/20">
        {recentItems.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            Aguardando eventos de busca, pontuação ou criação de candidatura.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {recentItems.map((event) => {
              const payload = event.payload ?? {};
              const title =
                typeof payload.title === "string"
                  ? payload.title
                  : "Sem título";
              const phase =
                typeof payload.phase === "string"
                  ? formatPhase(payload.phase)
                  : null;
              const match =
                typeof payload.matchScore === "number"
                  ? Number(payload.matchScore)
                  : null;
              const message =
                typeof payload.message === "string" ? payload.message : null;

              return (
                <li key={event.id} className="p-3">
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString("pt-BR")}
                  </p>
                  <p className="text-sm font-medium">{title}</p>
                  {phase ? (
                    <p className="text-xs text-muted-foreground">
                      Etapa: {phase}
                    </p>
                  ) : null}
                  {match != null ? (
                    <p className="text-xs text-muted-foreground">
                      Match: {match}
                    </p>
                  ) : null}
                  {message ? (
                    <p className="text-xs text-muted-foreground">{message}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
