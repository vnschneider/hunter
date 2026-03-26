"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Bell } from "lucide-react";

type NotificationRow = {
  id: number;
  huntId: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

function eventBadgeLabel(eventType: string) {
  switch (eventType) {
    case "interesting_opening_found":
      return "Vaga";
    case "application_created":
      return "Candidatura";
    case "hunt_failed":
    case "hunt_warning":
      return "Alerta";
    case "hunt_completed":
      return "Concluída";
    default:
      return "Caçada";
  }
}

function renderMessage(event: NotificationRow) {
  const payload = event.payload ?? {};
  const message = payload.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  switch (event.eventType) {
    case "hunt_started":
      return "Caçada iniciada.";
    case "hunt_progress":
      return "Atualização de progresso da caçada.";
    case "interesting_opening_found":
      return "Vaga interessante encontrada.";
    case "application_created":
      return "Nova candidatura criada.";
    case "hunt_completed":
      return "Caçada concluída.";
    case "hunt_failed":
      return "Caçada falhou.";
    case "hunt_stopped":
      return "Caçada encerrada.";
    default:
      return event.eventType;
  }
}

export function NotificationsCenter() {
  const [cursor, setCursor] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const response = await fetch(
          `/api/notifications?afterId=${cursor}&limit=30`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `Erro ${response.status}`);
        }

        const body = await response.json();
        if (cancelled) return;

        const rows = (body.data ?? []) as NotificationRow[];
        if (rows.length > 0) {
          setItems((prev) => [...rows, ...prev].slice(0, 60));
          setCursor(Number(body.nextCursor ?? cursor));
          setUnread((count) => count + rows.length);
        }

        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha em notificações");
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 7000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [cursor]);

  useEffect(() => {
    if (open) {
      setUnread(0);
    }
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" aria-hidden />
        Notificações
        {unread > 0 ? <Badge variant="destructive">{unread}</Badge> : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[360px] rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium">Atualizações em tempo real</p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <div className="max-h-[420px] overflow-auto">
            {items.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                Sem notificações.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {items.map((item) => (
                  <li key={item.id} className="p-3">
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("pt-BR")}
                    </p>
                    <p className="text-sm font-medium">{renderMessage(item)}</p>
                    <div className="mt-1">
                      <Badge variant="secondary">
                        {eventBadgeLabel(item.eventType)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Hunt: {item.huntId}
                    </p>
                    {item.payload?.title ? (
                      <p className="text-xs text-muted-foreground">
                        Vaga: {String(item.payload.title)}
                      </p>
                    ) : null}
                    {typeof item.payload?.matchScore === "number" ? (
                      <p className="text-xs text-muted-foreground">
                        Match: {Number(item.payload.matchScore)}
                      </p>
                    ) : null}
                    {item.payload?.phase ? (
                      <p className="text-xs text-muted-foreground">
                        Etapa: {String(item.payload.phase)}
                      </p>
                    ) : null}
                    {typeof item.payload?.rawCount === "number" ? (
                      <p className="text-xs text-muted-foreground">
                        Encontradas: {Number(item.payload.rawCount)}
                      </p>
                    ) : null}
                    {typeof item.payload?.dedupedCount === "number" ? (
                      <p className="text-xs text-muted-foreground">
                        Após dedupe: {Number(item.payload.dedupedCount)}
                      </p>
                    ) : null}
                    {typeof item.payload?.scoredCount === "number" ? (
                      <p className="text-xs text-muted-foreground">
                        Pontuadas: {Number(item.payload.scoredCount)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
