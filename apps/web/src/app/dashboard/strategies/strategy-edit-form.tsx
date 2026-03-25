"use client";

import { useActionState } from "react";
import { updateStrategy, type StrategyFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  strategyId: string;
  name: string;
  promptText: string;
  criteriaJson: Record<string, unknown>;
};

const initial: StrategyFormState = {};

export function StrategyEditForm({
  strategyId,
  name,
  promptText,
  criteriaJson,
}: Props) {
  const [state, formAction, pending] = useActionState(
    updateStrategy,
    initial,
  );

  const criteriaText =
    Object.keys(criteriaJson).length === 0
      ? "{}"
      : JSON.stringify(criteriaJson, null, 2);

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <input type="hidden" name="id" value={strategyId} />
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="name">Nome</Label>
        <Input id="name" name="name" defaultValue={name} required />
        {state.fieldErrors?.name?.[0] ? (
          <p className="text-xs text-destructive">{state.fieldErrors.name[0]}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="promptText">Texto para o agente</Label>
        <Textarea
          id="promptText"
          name="promptText"
          defaultValue={promptText}
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
          defaultValue={criteriaText}
          className="min-h-[120px] font-mono text-sm"
        />
        {state.fieldErrors?.criteriaJsonText?.[0] ? (
          <p className="text-xs text-destructive">
            {state.fieldErrors.criteriaJsonText[0]}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "A guardar…" : "Guardar alterações"}
      </Button>
    </form>
  );
}
