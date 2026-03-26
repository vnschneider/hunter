"use client";

import { useActionState, useEffect, useState } from "react";
import {
  analyzeCV,
  deleteCv,
  saveAnalyzedStrategy,
  type AnalyzeStrategyState,
  type SaveStrategyState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

const initialState: AnalyzeStrategyState = {};
const initialSaveState: SaveStrategyState = {};

type SavedCv = {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

type ProviderOption = "auto" | "gemini" | "openai" | "groq";

type AnalysisHistoryItem = {
  id: string;
  at: string;
  success: boolean;
  requestedProvider: ProviderOption;
  preferredProvider?: "gemini" | "openai" | "groq";
  finalProvider?: "gemini" | "openai" | "groq";
  finalModel?: string;
  processingMs?: number;
  attemptsSummary: string;
};

const HISTORY_KEY = "hunter.llm.analysis.history";

export function CVAnalysisForm({ savedCvs }: { savedCvs: SavedCv[] }) {
  const [state, formAction, pending] = useActionState(analyzeCV, initialState);
  const [saveState, saveAction, saving] = useActionState(
    saveAnalyzedStrategy,
    initialSaveState,
  );
  const [providerPreference, setProviderPreference] =
    useState<ProviderOption>("auto");
  const [history, setHistory] = useState<AnalysisHistoryItem[]>([]);

  useEffect(() => {
    const raw = window.localStorage.getItem("hunter.llm.provider");
    if (
      raw === "auto" ||
      raw === "gemini" ||
      raw === "openai" ||
      raw === "groq"
    ) {
      setProviderPreference(raw);
    }

    const rawHistory = window.localStorage.getItem(HISTORY_KEY);
    if (!rawHistory) {
      return;
    }
    try {
      const parsed = JSON.parse(rawHistory) as AnalysisHistoryItem[];
      if (Array.isArray(parsed)) {
        setHistory(parsed.slice(0, 8));
      }
    } catch {
      // ignore invalid local history
    }
  }, []);

  useEffect(() => {
    if (!state.executionTrace) {
      return;
    }

    const attemptsSummary = state.executionTrace.attempts
      .map((attempt) => `${attempt.provider}:${attempt.status}`)
      .join(" -> ");

    const newItem: AnalysisHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      success: Boolean(state.success),
      requestedProvider: state.executionTrace.requestedProvider,
      preferredProvider: state.executionTrace.preferredProvider,
      finalProvider: state.data?.providerUsed,
      finalModel: state.data?.modelUsed,
      processingMs: state.data?.processingMs,
      attemptsSummary,
    };

    setHistory((prev) => {
      const next = [newItem, ...prev].slice(0, 8);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, [state]);

  const hasResult = state.success && state.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>CVs Salvos</CardTitle>
          <CardDescription>
            Arquivos enviados recentemente e disponíveis para rastreio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {savedCvs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum CV salvo ainda.
            </p>
          ) : (
            <div className="space-y-3">
              {savedCvs.map((cv) => (
                <div
                  key={cv.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{cv.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(cv.sizeBytes)} •{" "}
                      {new Date(cv.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>

                  <form action={deleteCv}>
                    <input type="hidden" name="cvId" value={cv.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Excluir
                    </Button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <form action={formAction} className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold mb-4">Analisar CV com IA</h2>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cvFile">CV em PDF (opcional)</Label>
              <input
                id="cvFile"
                name="cvFile"
                type="file"
                accept="application/pdf"
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Maximo de 5MB. Se enviado, o texto sera extraido
                automaticamente.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cvText">
                Texto do CV (opcional se houver PDF)
              </Label>
              <Textarea
                id="cvText"
                name="cvText"
                placeholder="Cole o conteúdo do CV aqui, ou envie um PDF acima..."
                className="min-h-[300px] font-mono text-sm"
              />
              {state.error ? (
                <p className="text-xs text-destructive">{state.error}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="jobPreferences">
                Preferências Adicionais (opcional)
              </Label>
              <Textarea
                id="jobPreferences"
                name="jobPreferences"
                placeholder="Ex: Preferível remoto, stack React + Node, acima de €3500/mês..."
                className="min-h-[100px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">Provedor de IA</Label>
              <select
                id="provider"
                name="provider"
                value={providerPreference}
                onChange={(event) => {
                  const value = event.target.value as ProviderOption;
                  setProviderPreference(value);
                  window.localStorage.setItem("hunter.llm.provider", value);
                }}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="auto">Auto (usa fallback)</option>
                <option value="groq">Groq</option>
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Em Auto, o sistema tenta provedores alternativos se houver erro.
              </p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button type="submit" disabled={pending}>
              <Sparkles className="mr-2 h-4 w-4" />
              {pending ? "A analisar..." : "Analisar com IA"}
            </Button>
          </div>
        </div>
      </form>

      {hasResult && state.data ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-600" />
              Resultado da Análise
            </CardTitle>
            {state.data.summary && (
              <CardDescription>{state.data.summary}</CardDescription>
            )}
            {state.data.confidence !== undefined && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-muted-foreground">
                  Confiança:
                </span>
                <Badge variant="secondary">
                  {Math.round(state.data.confidence * 100)}%
                </Badge>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {state.executionTrace ? (
                <Badge variant="secondary">
                  Requested: {state.executionTrace.requestedProvider}
                </Badge>
              ) : null}
              {state.data.providerUsed ? (
                <Badge variant="outline">
                  Provider: {state.data.providerUsed}
                </Badge>
              ) : null}
              {state.data.modelUsed ? (
                <Badge variant="outline">Modelo: {state.data.modelUsed}</Badge>
              ) : null}
              {state.data.processingMs !== undefined ? (
                <Badge variant="outline">
                  Tempo: {(state.data.processingMs / 1000).toFixed(2)}s
                </Badge>
              ) : null}
            </div>

            {state.executionTrace ? (
              <div className="mt-3 rounded-md border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Diagnostico de fallback
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {state.executionTrace.attempts.map((attempt, index) => (
                    <Badge
                      key={`${attempt.provider}-${index}`}
                      variant="secondary"
                    >
                      {attempt.provider} · {attempt.status}
                    </Badge>
                  ))}
                </div>
                {state.executionTrace.attempts.some(
                  (attempt) => attempt.error,
                ) ? (
                  <div className="mt-2 space-y-1">
                    {state.executionTrace.attempts
                      .filter((attempt) => attempt.error)
                      .map((attempt, index) => (
                        <p
                          key={`${attempt.provider}-err-${index}`}
                          className="text-xs text-muted-foreground"
                        >
                          {attempt.provider}: {attempt.error}
                        </p>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-medium">Prompt para o Agente</h3>
              <div className="rounded-lg bg-muted p-3 text-sm leading-relaxed">
                {state.data.promptText}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium">Critérios (JSON)</h3>
              <pre className="rounded-lg bg-muted p-3 text-xs overflow-auto max-h-64">
                {JSON.stringify(state.data.criteriaJson, null, 2)}
              </pre>
            </div>

            {state.data.note ? (
              <p className="text-sm text-amber-700" role="status">
                {state.data.note}
              </p>
            ) : null}

            {saveState.error ? (
              <p className="text-sm text-destructive" role="alert">
                {saveState.error}
              </p>
            ) : null}

            {saveState.success ? (
              <p className="text-sm text-emerald-700" role="status">
                Estratégia guardada com sucesso. Veja em /dashboard/strategies.
              </p>
            ) : null}

            <div className="flex gap-3">
              <form action={saveAction}>
                <input
                  type="hidden"
                  name="name"
                  value={
                    state.data.summary
                      ? `IA - ${state.data.summary.slice(0, 60)}`
                      : "Estrategia gerada por IA"
                  }
                />
                <input
                  type="hidden"
                  name="promptText"
                  value={state.data.promptText}
                />
                <input
                  type="hidden"
                  name="criteriaJsonText"
                  value={JSON.stringify(state.data.criteriaJson)}
                />
                <input
                  type="hidden"
                  name="cvId"
                  value={state.data.cvId ?? ""}
                />
                <Button variant="default" type="submit" disabled={saving}>
                  {saving
                    ? "A guardar..."
                    : "Aceitar e Guardar como Estratégia"}
                </Button>
              </form>
              <Button variant="outline">Editar Antes de Guardar</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Historico de Execucoes de IA</CardTitle>
            <CardDescription>
              Ultimas tentativas (armazenadas localmente neste navegador).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border px-3 py-2 text-xs"
                >
                  <p className="font-medium">
                    {new Date(item.at).toLocaleString("pt-BR")} ·{" "}
                    {item.success ? "sucesso" : "falha"}
                  </p>
                  <p className="text-muted-foreground">
                    req={item.requestedProvider} pref=
                    {item.preferredProvider ?? "-"} final=
                    {item.finalProvider ?? "-"} model={item.finalModel ?? "-"}{" "}
                    tempo=
                    {item.processingMs !== undefined
                      ? `${(item.processingMs / 1000).toFixed(2)}s`
                      : "-"}
                  </p>
                  <p className="text-muted-foreground">
                    {item.attemptsSummary}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
