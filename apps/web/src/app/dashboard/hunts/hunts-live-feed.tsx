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

function formatEventTitle(eventType: string) {
  switch (eventType) {
    case "hunt_started":
      return "Caçada iniciada";
    case "hunt_progress":
      return "Progresso";
    case "interesting_opening_found":
      return "Vaga interessante";
    case "application_created":
      return "Candidatura criada";
    case "hunt_completed":
      return "Caçada concluída";
    case "hunt_failed":
      return "Caçada falhou";
    case "hunt_stopped":
      return "Caçada encerrada";
    case "hunt_warning":
      return "Aviso";
    case "pipeline_heartbeat":
      return "Pipeline ativa";
    default:
      return eventType;
  }
}

export function HuntsLiveFeed({ hunts }: Props) {
  const activeDefault = useMemo(
    () => hunts.find((h) => h.status === "running")?.id ?? hunts[0]?.id ?? "",
    [hunts],
  );

  const [huntId, setHuntId] = useState(activeDefault);
  const [cursor, setCursor] = useState(0);
  const [events, setEvents] = useState<HuntEventRow[]>([]);
  const [error, setError] = useState("");

  const isLiveRunning = useMemo(() => {
    const latestStatusEvent = events.find(
      (event) =>
        event.eventType === "hunt_completed" ||
        event.eventType === "hunt_failed" ||
        event.eventType === "hunt_stopped",
    );

    if (!latestStatusEvent) {
      return true;
    }

    return false;
  }, [events]);

  const pollIntervalMs = isLiveRunning ? 3000 : 7000;

  const latestTelemetry = useMemo(() => {
    const progressEvents = events.filter(
      (event) => event.eventType === "hunt_progress",
    );

    const candidate =
      progressEvents.find((event) => {
        const payload = event.payload ?? {};
        return (
          typeof payload.scoredCount === "number" ||
          typeof payload.rankedCount === "number" ||
          typeof payload.scoreFailureCount === "number" ||
          typeof payload.scoreEngineGroqCalls === "number"
        );
      }) ??
      progressEvents.find((event) => {
        const payload = event.payload ?? {};
        return (
          typeof payload.rawCount === "number" ||
          Array.isArray(payload.providers) ||
          typeof payload.pipelineMode === "string"
        );
      });

    if (!candidate) {
      return null;
    }

    const payload = candidate.payload ?? {};
    const providers = Array.isArray(payload.providers)
      ? payload.providers.filter(
          (item): item is Record<string, unknown> =>
            item != null && typeof item === "object",
        )
      : [];

    return {
      pipelineMode:
        typeof payload.pipelineMode === "string"
          ? payload.pipelineMode
          : "direct_gateway",
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
      rankedCount:
        typeof payload.rankedCount === "number"
          ? Number(payload.rankedCount)
          : null,
      scoreFailureCount:
        typeof payload.scoreFailureCount === "number"
          ? Number(payload.scoreFailureCount)
          : null,
      scoreTimeoutCount:
        typeof payload.scoreTimeoutCount === "number"
          ? Number(payload.scoreTimeoutCount)
          : null,
      scoreEngineGroqCalls:
        typeof payload.scoreEngineGroqCalls === "number"
          ? Number(payload.scoreEngineGroqCalls)
          : null,
      llmCandidates:
        typeof payload.llmCandidates === "number"
          ? Number(payload.llmCandidates)
          : null,
      heuristicOnlyCount:
        typeof payload.heuristicOnlyCount === "number"
          ? Number(payload.heuristicOnlyCount)
          : null,
      scoreEngineCacheHitRate:
        typeof payload.scoreEngineCacheHitRate === "string"
          ? payload.scoreEngineCacheHitRate
          : null,
      providers,
    };
  }, [events]);

  useEffect(() => {
    setHuntId(activeDefault);
  }, [activeDefault]);

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
          setEvents((prev) => [...rows, ...prev].slice(0, 80));
          setCursor(Number(body.nextCursor ?? cursor));
        }

        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao obter eventos");
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [huntId, cursor, pollIntervalMs]);

  if (!huntId) {
    return (
      <p className="text-sm text-muted-foreground">
        Cria a primeira hunt para acompanhar eventos em tempo quase real.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label
          className="text-sm text-muted-foreground"
          htmlFor="hunt-live-select"
        >
          Hunt monitorada
        </label>
        <select
          id="hunt-live-select"
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

      {latestTelemetry ? (
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Telemetria MCP/Worker
          </p>
          <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <p>Pipeline: {latestTelemetry.pipelineMode}</p>
            <p>
              Busca: {latestTelemetry.rawCount ?? "-"} / dedupe{" "}
              {latestTelemetry.dedupedCount ?? "-"}
            </p>
            <p>
              Score: {latestTelemetry.scoredCount ?? "-"} / rank{" "}
              {latestTelemetry.rankedCount ?? "-"}
            </p>
            <p>
              Falhas score: {latestTelemetry.scoreFailureCount ?? "-"} / timeout{" "}
              {latestTelemetry.scoreTimeoutCount ?? "-"}
            </p>
            <p>Cache score: {latestTelemetry.scoreEngineCacheHitRate ?? "-"}</p>
            <p>Chamadas LLM: {latestTelemetry.scoreEngineGroqCalls ?? "-"}</p>
            <p>
              Candidatas LLM: {latestTelemetry.llmCandidates ?? "-"} /
              Heurística {latestTelemetry.heuristicOnlyCount ?? "-"}
            </p>
          </div>
          {latestTelemetry.providers.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {latestTelemetry.providers.map((provider, idx) => {
                const name = String(provider.provider ?? "provider");
                const count = Number(provider.count ?? 0);
                const elapsed = Number(provider.elapsedMs ?? 0);
                const ok = Boolean(provider.ok ?? false);
                return (
                  <span
                    key={`${name}-${idx}`}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground"
                  >
                    {name}: {count} ({elapsed}ms) {ok ? "ok" : "erro"}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="max-h-[360px] overflow-auto rounded-lg border border-border bg-muted/20">
        {events.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            Sem eventos ainda.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {events.map((event) => (
              <li key={event.id} className="p-3">
                <p className="text-xs text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString("pt-BR")}
                </p>
                <p className="text-sm font-medium">
                  {formatEventTitle(event.eventType)}
                </p>
                {event.payload?.message ? (
                  <p className="text-sm text-muted-foreground">
                    {String(event.payload.message)}
                  </p>
                ) : null}
                {event.payload?.phase ? (
                  <p className="text-xs text-muted-foreground">
                    Etapa: {String(event.payload.phase)}
                  </p>
                ) : null}
                {typeof event.payload?.rawCount === "number" ? (
                  <p className="text-xs text-muted-foreground">
                    Encontradas: {Number(event.payload.rawCount)}
                  </p>
                ) : null}
                {typeof event.payload?.dedupedCount === "number" ? (
                  <p className="text-xs text-muted-foreground">
                    Após dedupe: {Number(event.payload.dedupedCount)}
                  </p>
                ) : null}
                {typeof event.payload?.scoredCount === "number" ? (
                  <p className="text-xs text-muted-foreground">
                    Pontuadas: {Number(event.payload.scoredCount)}
                  </p>
                ) : null}
                {typeof event.payload?.persisted === "number" ? (
                  <p className="text-xs text-muted-foreground">
                    Persistidas: {Number(event.payload.persisted)}
                    {typeof event.payload?.totalToPersist === "number"
                      ? ` / ${Number(event.payload.totalToPersist)}`
                      : ""}
                  </p>
                ) : null}
                {typeof event.payload?.elapsedMs === "number" ? (
                  <p className="text-xs text-muted-foreground">
                    Tempo decorrido:{" "}
                    {Math.round(Number(event.payload.elapsedMs) / 1000)}s
                  </p>
                ) : null}
                {event.payload?.title ? (
                  <p className="text-xs text-muted-foreground">
                    Vaga: {String(event.payload.title)}
                  </p>
                ) : null}
                {typeof event.payload?.matchScore === "number" ? (
                  <p className="text-xs text-muted-foreground">
                    Match: {Number(event.payload.matchScore)}
                  </p>
                ) : null}
                {event.payload?.url ? (
                  <a
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    href={String(event.payload.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir vaga
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
