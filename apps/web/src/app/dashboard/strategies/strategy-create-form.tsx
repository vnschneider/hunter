"use client";

import { useActionState } from "react";
import { createStrategy, type StrategyFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initial: StrategyFormState = {};

export function StrategyCreateForm() {
  const [state, formAction, pending] = useActionState(
    createStrategy,
    initial,
  );

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="name">Nome</Label>
        <Input
          id="name"
          name="name"
          placeholder="Ex.: Remoto BR — fullstack"
          required
        />
        {state.fieldErrors?.name?.[0] ? (
          <p className="text-xs text-destructive">{state.fieldErrors.name[0]}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="promptText">Texto para o agente</Label>
        <Textarea
          id="promptText"
          name="promptText"
          placeholder="Critérios em linguagem natural (equivalente ao user-prompt)…"
          required
          className="min-h-[200px] font-mono text-sm"
        />
        {state.fieldErrors?.promptText?.[0] ? (
          <p className="text-xs text-destructive">
            {state.fieldErrors.promptText[0]}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="criteriaJsonText">Critérios (JSON opcional)</Label>
        <Textarea
          id="criteriaJsonText"
          name="criteriaJsonText"
          placeholder='{ "keywords": ["React", "Node"] }'
          className="min-h-[100px] font-mono text-sm"
          defaultValue="{}"
        />
        {state.fieldErrors?.criteriaJsonText?.[0] ? (
          <p className="text-xs text-destructive">
            {state.fieldErrors.criteriaJsonText[0]}
          </p>
        ) : null}
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "A guardar…" : "Criar estratégia"}
        </Button>
      </div>
    </form>
  );
}
