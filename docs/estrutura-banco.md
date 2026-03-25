# Estrutura do banco de dados (Postgres / Drizzle)

Convenções: **Postgres 15+**; ORM **Drizzle**; identificador de utilizador da app = `user_id` (texto, ID estável do **Auth.js**, não `auth.users` do Supabase). Timestamps em **UTC** (`timestamptz`). IDs de entidades: **`uuid` v4 ou v7** (recomendado v7 para ordenação temporal).

---

## 1. Enumerados (enum no Postgres ou `text` + check)

| Nome lógico | Valores sugeridos | Uso |
|-------------|-------------------|-----|
| `hunt_status` | `pending`, `running`, `completed`, `failed`, `cancelled` | `hunts.status` |
| `job_status` | `queued`, `processing`, `done`, `dead` | `jobs.status` |
| `job_type` | `run_hunt`, `generate_strategy`, … | `jobs.type` |
| `application_status` | `suggested`, `shortlisted`, `queued`, `applying`, `applied`, `failed`, `skipped` | `applications.status` |
| `service_state` | `running`, `paused` | `service_config` ou tabela singleton por utilizador / global |

Em Drizzle: `pgEnum` ou colunas `text` com validação Zod na aplicação.

---

## 2. Tabelas principais

### 2.1 `profiles`

Extensão do utilizador autenticado (Auth.js).

| Coluna | Tipo | Notas |
|--------|------|--------|
| `user_id` | `text` PK | = `session.user.id` |
| `email` | `text` nullable | cache opcional para UI |
| `display_name` | `text` nullable | |
| `avatar_url` | `text` nullable | |
| `google_sub` | `text` nullable unique | subject Google, para suporte/debug |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | trigger ou app |

**Índices:** PK em `user_id`.

---

### 2.2 `cvs`

Metadados do CV; ficheiro no Storage.

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | `uuid` PK | |
| `user_id` | `text` FK → `profiles.user_id` | ON DELETE CASCADE |
| `storage_path` | `text` not null | ex.: `{user_id}/{cv_id}.pdf` |
| `file_name` | `text` | nome original |
| `mime_type` | `text` | `application/pdf`, etc. |
| `size_bytes` | `bigint` | |
| `sha256` | `text` | dedupe / cache de estratégia |
| `extracted_text` | `text` nullable | opcional; LGPD — política de retenção |
| `created_at` | `timestamptz` | |

**Índices:** `(user_id, created_at desc)`; opcional `(user_id, sha256)`.

---

### 2.3 `strategies`

Critérios de caça (equivalente estruturado ao `user-prompt`).

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | `uuid` PK | |
| `user_id` | `text` FK | |
| `cv_id` | `uuid` FK nullable → `cvs.id` | |
| `name` | `text` | ex.: “Remoto BR — Pleno” |
| `criteria_json` | `jsonb` not null | keywords, filtros, plataformas |
| `prompt_text` | `text` not null | texto final para o agente (derivado + edições) |
| `is_active` | `boolean` default false | só uma activa por utilizador (constraint app ou partial unique) |
| `version` | `int` default 1 | |
| `created_at` / `updated_at` | `timestamptz` | |

**Índices:** `(user_id, is_active)` onde `is_active = true` (partial index).

---

### 2.4 `hunts`

Uma execução de caça.

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | `uuid` PK | |
| `user_id` | `text` FK | |
| `strategy_id` | `uuid` FK → `strategies.id` | |
| `strategy_snapshot_json` | `jsonb` not null | imutável: critérios no momento do start |
| `status` | `hunt_status` | |
| `started_at` | `timestamptz` | |
| `finished_at` | `timestamptz` nullable | |
| `error_message` | `text` nullable | |
| `export_storage_path` | `text` nullable | CSV final no Storage, se guardares cópia |
| `created_at` | `timestamptz` | |

**Índices:** `(user_id, started_at desc)`; `(status)` para worker.

---

### 2.5 `openings`

Vaga normalizada (pode ser partilhada entre hunts do mesmo user ou global ao projecto — escolha de produto).

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | `uuid` PK | |
| `platform` | `text` not null | `indeed`, `github_backend_br`, … |
| `external_id` | `text` nullable | ID na plataforma, se existir |
| `normalized_url` | `text` not null | URL canónica (sem utm) |
| `title` | `text` | snapshot último conhecido |
| `raw_payload` | `jsonb` nullable | opcional; pode omitir por LGPD/custo |
| `first_seen_at` | `timestamptz` | |

**Unique:** `(platform, external_id)` onde ambos non-null; ou `(normalized_url)` se external_id fraco.

---

### 2.6 `applications`

Pipeline por utilizador + vaga + hunt.

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | `uuid` PK | |
| `user_id` | `text` FK | |
| `hunt_id` | `uuid` FK → `hunts.id` | |
| `opening_id` | `uuid` FK → `openings.id` | |
| `opening_url` | `text` not null | **sempre** mostrar na UI (pode = `openings.normalized_url`) |
| `source_url` | `text` nullable | URL antes de redirect |
| `status` | `application_status` | |
| `match_score` | `smallint` nullable | 0–100 |
| `notes` | `text` nullable | |
| `applied_at` | `timestamptz` nullable | |
| `created_at` / `updated_at` | `timestamptz` | |

**Índices:** `(user_id, status)`; `(hunt_id)`; `(user_id, opening_id)` unique para evitar dup na mesma vaga/re-hunt (regra de negócio).

---

### 2.7 `hunt_events`

Feed append-only para live / auditoria.

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | `bigserial` ou `uuid` PK | |
| `hunt_id` | `uuid` FK | |
| `user_id` | `text` | denormalizado para filtro rápido |
| `event_type` | `text` | `log`, `opening_found`, `tool_call`, … |
| `payload` | `jsonb` | |
| `created_at` | `timestamptz` default `now()` | |

**Índices:** `(hunt_id, created_at asc)` para SSE.

---

### 2.8 `jobs`

Fila para o worker.

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | `uuid` PK | |
| `type` | `job_type` | |
| `user_id` | `text` not null | |
| `payload` | `jsonb` not null | ex.: `{ "huntId": "..." }` |
| `status` | `job_status` | |
| `attempts` | `int` default 0 | |
| `max_attempts` | `int` default 3 | |
| `run_after` | `timestamptz` | backoff |
| `idempotency_key` | `text` nullable unique | evita duplicar enqueue |
| `last_error` | `text` nullable | |
| `created_at` / `updated_at` | `timestamptz` | |

**Índices:** partial onde `status = 'queued' AND run_after <= now()` para dequeue; worker usa `FOR UPDATE SKIP LOCKED`.

---

### 2.9 Opcionais

| Tabela | Função |
|--------|--------|
| `usage_daily` | contadores IA/API por dia / `user_id` |
| `service_config` | singleton: `paused` global ou por `user_id` |

---

## 3. Storage (Supabase) — não é tabela, mas contrato

| Bucket | Path | Conteúdo |
|--------|------|----------|
| `cvs` (privado) | `{user_id}/{cv_id}.{ext}` | PDFs/DOCX |
| `exports` (privado) | `{user_id}/hunts/{hunt_id}.csv` | opcional |

Políticas: acesso só via servidor com **service role** ou URLs assinadas de curta duração após validar sessão.

---

## 4. Migrações Drizzle

- Schema em `src/db/schema/*.ts` (ou monorepo `packages/db`).
- `drizzle-kit generate` após alterações; revisar SQL gerado.
- Seeds: utilizador de teste + estratégia fake **sem** dados reais de produção.

---

## 5. RLS

Sem Supabase Auth no browser, **RLS com `auth.uid()` não aplica** ao painel. Opções:

1. **Recomendado:** só **connection string + servidor**; todas as queries com `where user_id = $session`.
2. **Avançado:** RLS + `set_config('app.user_id', …, true)` por request (Postgres role dedicado).

Documentar a opção escolhida no repositório.
