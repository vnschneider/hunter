# Plano da plataforma Hunter — estado de execução

Referência principal da visão: [plataforma-visao.md](plataforma-visao.md). Este ficheiro resume **fases**, **o que já existe no repo** e **o que falta**.

**Última actualização:** alinhada ao código em `apps/web`, `packages/db` e documentação auxiliar.

---

## Legenda

| Estado | Significado |
|--------|-------------|
| Feito | Entregue no repositório (pode ser MVP / parcial) |
| Em parte | Base existe; falta ligar dados, UX completa ou produção |
| Por fazer | Ainda não iniciado |

---

## Fase 0 — Documentação e decisões

| Item | Estado |
|------|--------|
| Visão, stack, lacunas, design system (docs) | Feito |
| Decisões explícitas (pause, estados de candidatura, Auth.js vs Supabase Auth) | Feito (em docs) |
| `user-prompt` como JSON/YAML validado (Zod) partilhado com UI | Por fazer |
| CI (lint, shellcheck `main.sh`) | Por fazer |

---

## Fase 1 — Supabase / Postgres + schema

| Item | Estado |
|------|--------|
| Schema Drizzle (`profiles`, `cvs`, `strategies`, `hunts`, `openings`, `applications`, `hunt_events`, `jobs`) | Feito (`packages/db`) |
| Migrações aplicadas na tua instância (`yarn db:push` / generate) | **Contigo** (depende de `DATABASE_URL` local) |
| Storage bucket + políticas só `service_role` | Por fazer |
| Seed local opcional | Por fazer |

---

## Fase 2 — Next.js + Auth + CRUD no painel

| Item | Estado |
|------|--------|
| Next.js 16 + Tailwind + tokens (shadcn-style: Button, Card, Input, Badge…) | Feito |
| Auth.js + Google OAuth + middleware `/dashboard` | Feito |
| `ensureProfile` + Drizzle quando `DATABASE_URL` existe | Feito |
| Shell do dashboard (sidebar, páginas placeholder) | Feito |
| CRUD de **estratégias** (criar / editar / apagar / activar + lista) | **Feito** (`/dashboard/strategies`) |
| Lista de **candidaturas** com URL + estado + join a `openings` | **Feito** (leitura; dados vêm do worker mais tarde) |
| Yarn + script `yarn auth:secret` | Feito |
| `.env.example` limpo (sem segredos) | Feito |
| Banner quando `DATABASE_URL` ausente | Feito |

---

## Fase 3 — IA no CV + worker

| Item | Estado |
|------|--------|
| Upload CV → Storage + metadados em `cvs` | Por fazer |
| Assistente “CV → estratégia” (LLM barato + revisão humana) | Por fazer |
| Worker Docker / processo que consome `jobs` | Por fazer |
| Integração agente (`main.sh` / Claude + MCP Indeed + GitHub) gravando hunts/applications | Por fazer |

---

## Fase 4 — Live, relatórios, Docker

| Item | Estado |
|------|--------|
| SSE (ou polling) para eventos da hunt | Por fazer |
| Relatórios por período (queries + UI) | Por fazer |
| `Dockerfile` / compose para web + worker | Por fazer |

---

## Fase 5 — Hardening e automação

| Item | Estado |
|------|--------|
| Alertas (webhook / e-mail barato) | Por fazer |
| Agendamento (cron na VPS ou job scheduler) | Por fazer |
| Rate limits, backups, LGPD export/delete | Por fazer (detalhe em [plataforma-visao.md §12](plataforma-visao.md)) |

---

## CLI legado (repo raiz)

| Item | Estado |
|------|--------|
| `main.sh` + `system-prompt.md` + `user-prompt.md` | Feito (já existia) |
| `yarn` / dependências na raiz | Feito |
| Variáveis em `main.sh` + script `yarn hunt` | Por fazer |

---

## Resumo numa frase

**Estratégias e listagem de candidaturas no painel estão feitas (com `DATABASE_URL`). Falta: aplicar migrações na tua instância se ainda não o fizeste, worker, Storage, IA no CV, SSE/relatórios e Docker.**

---

## Segurança

Se alguma credencial chegou a estar em `.env.example` ou em commits antigos, **roda** na Google Cloud e no Supabase: novos segredos OAuth, password da BD e rotação de chaves de API.
