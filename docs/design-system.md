# Design system e UI kit — Hunter Platform

Documento de referência visual para **Next.js 16** + **Tailwind CSS v4** (ou v3) + **shadcn/ui**. Objectivo: **acabamento premium**, **confiança** e **consistência** em todo o painel. Valores abaixo são **proposta inicial** — ao inicializar shadcn, mapear estes tokens para `globals.css` e `tailwind.config`.

---

## 1. Princípios

1. **Uma marca, dois modos** — claro e escuro com **paridade** (não tratar dark como secundário).
2. **Densidade legível** — dados de trabalho (vagas, scores) pedem hierarquia clara; evitar clutter.
3. **Semântica estável** — cores de estado (sucesso, aviso, erro) **iguais** em tabelas, formulários e toasts.
4. **Motion contida** — 150–200ms; respeitar `prefers-reduced-motion`.

---

## 2. Paleta de cores (tokens semânticos)

Base **neutra** inspirada em zinc/slate; **acento** único para acções primárias e foco; **semânticos** para feedback e estados de candidatura.

### 2.1 Neutros (superfícies e texto)

| Token | Claro (`:root`) | Escuro (`.dark`) | Uso |
|-------|-----------------|------------------|-----|
| `--background` | `oklch(0.99 0 0)` ou `#fafafa` | `oklch(0.14 0.01 260)` | fundo app |
| `--foreground` | `oklch(0.2 0.02 260)` | `oklch(0.95 0.01 260)` | texto principal |
| `--card` | `#ffffff` | `oklch(0.18 0.01 260)` | cards, modais |
| `--card-foreground` | igual `--foreground` | igual | texto em card |
| `--muted` | `oklch(0.96 0.005 260)` | `oklch(0.22 0.01 260)` | fundos secundários |
| `--muted-foreground` | `oklch(0.45 0.02 260)` | `oklch(0.65 0.02 260)` | labels, hints |
| `--border` | `oklch(0.90 0.01 260)` | `oklch(0.28 0.02 260)` | divisores, inputs |
| `--input` | igual `--border` | igual | borda de input |
| `--ring` | `--primary` com opacidade | igual | foco acessível |

### 2.2 Primário (marca / acção principal)

Proposta **confiança + tech** (não vermelho agressivo):

| Token | Claro | Escuro | Uso |
|-------|-------|--------|-----|
| `--primary` | `oklch(0.45 0.14 250)` (~azul royal) | `oklch(0.62 0.16 250)` | botões primários, links chave |
| `--primary-foreground` | `oklch(0.99 0 0)` | `oklch(0.12 0.02 260)` | texto sobre primário |

**Alternativa** se quiseres mais “growth / oportunidade”: acento **teal** `oklch(0.5 0.12 180)` — escolher **uma** e documentar aqui.

### 2.3 Semânticos

| Token | Claro | Uso |
|-------|-------|-----|
| `--destructive` | `oklch(0.55 0.22 25)` | apagar, falha crítica |
| `--success` | `oklch(0.55 0.16 145)` | candidatura aplicada, hunt OK |
| `--warning` | `oklch(0.75 0.15 85)` | pausas, quotas |
| `--info` | `oklch(0.55 0.14 230)` | dicas, live stream |

Mapear em shadcn: `destructive` já existe; adicionar **custom** `success` / `warning` / `info` como classes utilitárias ou variantes de `Badge` / `Alert`.

### 2.4 Estados de candidatura (badges)

| Estado | Cor sugerida | Ícone mental |
|--------|--------------|--------------|
| `suggested` | `muted` + outline | neutro |
| `shortlisted` | `info` | atenção positiva |
| `queued` | `warning` | à espera |
| `applying` | `primary` | em progresso |
| `applied` | `success` | concluído |
| `failed` | `destructive` | erro |
| `skipped` | `muted-foreground` | ignorado |

Implementação: componente `ApplicationStatusBadge` com variantes fixas (nunca cor *ad hoc* por página).

### 2.5 Sidebar

| Token | Valor sugerido |
|-------|----------------|
| `--sidebar` | ligeiramente mais escuro que `--background` no claro; no escuro, alinhar a `--card` ou um passo abaixo |
| `--sidebar-primary` | igual `--primary` |
| `--sidebar-accent` | hover item de menu |

shadcn `Sidebar` já traz variáveis — alinhar com a tabela de neutros acima.

---

## 3. Tipografia

| Uso | Fonte | Fallback |
|-----|-------|----------|
| UI / corpo | **Geist Sans** ou **Inter** | `system-ui, sans-serif` |
| Números / scores (opcional) | **Geist Mono** ou **tabular-nums** na mesma sans | — |
| Marketing (landing futura) | Opcional display (Cal Sans, etc.) | — |

**Escala (rem):**

| Token | Tamanho | Peso | Uso |
|-------|---------|------|-----|
| `text-xs` | 0.75rem | 400–500 | meta, timestamps |
| `text-sm` | 0.875rem | 400 | corpo denso, tabelas |
| `text-base` | 1rem | 400 | corpo padrão |
| `text-lg` | 1.125rem | 500–600 | subtítulos de secção |
| `text-xl` → `text-2xl` | 1.25–1.5rem | 600 | títulos de página |

**Line-height:** `leading-relaxed` em blocos longos; tabelas `leading-tight` ou `normal`.

**Regra:** títulos de página **uma** família + peso 600; não misturar mais de **dois** pesos por ecrã.

---

## 4. Espaçamento e raio

- **Grid base:** múltiplos de **4px**; secções verticais **24–32px** (`gap-6` / `gap-8`).
- **Padding de página:** `px-4 md:px-6 lg:px-8`, `py-6`.
- **Cards:** `p-6`, `rounded-xl` (12px) ou `rounded-lg` (8px) — **um** raio dominante em todo o produto.
- **Inputs / botões:** altura mínima **40px** (touch); primário **44px** em mobile crítico.

---

## 5. Elevação e profundidade

| Nível | Sombra | Uso |
|-------|--------|-----|
| `0` | sem sombra | listas dentro de card |
| `1` | `shadow-sm` + `border` | card padrão |
| `2` | `shadow-md` | dropdown, popover |
| `3` | `shadow-lg` | modal |

Evitar sombras pesadas em cada célula — preferir **borda** `border` + fundo `card`.

---

## 6. Componentes shadcn — mapa obrigatório

| Área | Componentes |
|------|-------------|
| **Shell** | `Sidebar`, `SidebarProvider`, `Breadcrumb`, `Separator` |
| **Navegação** | `DropdownMenu`, `Command` (⌘K), `Button`, `Tooltip` |
| **Dados** | `Table`, `DataTable` (TanStack), `Badge`, `Skeleton`, `ScrollArea` |
| **Formulários** | `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Form`, `Label` |
| **Feedback** | `Sonner`, `Alert`, `Dialog`, `AlertDialog` |
| **Ficheiros** | `Card` + dropzone custom ou `input type=file` estilizado |

---

## 7. Ícones

- **Lucide** (padrão shadcn); tamanhos **16px** (inline) e **20px** (ações).
- Ícone **externo** em links de vaga: `ExternalLink` consistente.

---

## 8. Ficheiros a versionar no repo

Sugerido:

```
src/app/globals.css       # variáveis CSS + tema dark
tailwind.config.ts        # extend theme (se v3)
components/ui/            # shadcn
components/hunter/        # ApplicationStatusBadge, HuntLiveFeed, etc.
```

---

## 9. Acessibilidade

- Contraste texto/fundo **≥ 4.5:1** para corpo; **≥ 3:1** para UI grande (botões).
- **Focus ring** visível (`ring-2 ring-ring`) em todos os interactivos.
- ** prefers-reduced-motion:** desactivar translate/scale decorativos; manter opacity para estados.

---

## 10. Referências

- [shadcn Theming](https://ui.shadcn.com/docs/theming)
- [Tailwind — dark mode](https://tailwindcss.com/docs/dark-mode)
- [OKLCH](https://oklch.com) — afinar primário sem saltos perceptivos

Este ficheiro deve ser actualizado quando o **primário de marca** for escolhido definitivamente (cor hex/oklch final).
