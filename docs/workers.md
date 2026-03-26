# Workers — fila, execução e operação

Processo **longo** que corre **fora** do ciclo pedido/resposta do Next.js. Complementa [arquitetura.md](arquitetura.md).

---

## 1. Papel do worker

- Retirar trabalhos da tabela **`jobs`** (Postgres).
- Carregar contexto da **`hunts`** + snapshot da estratégia.
- Invocar o pipeline **MCP local** para busca, deduplicação e score.
- Persistir **`hunt_events`**, **`openings`**, **`applications`**, actualizar **`hunts.status`**.
- Respeitar **timeouts**, **retries** e **limites de custo** (tokens / tempo).

O worker **não** substitui a API web: não expõe rotas públicas ao utilizador (exceto healthcheck interno).

---

## 2. Modelo de fila (Postgres)

Sem Redis no MVP:

```sql
-- Pseudocódigo: claim de um job
BEGIN;
SELECT * FROM jobs
WHERE status = 'queued' AND run_after <= now()
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
-- marca processing, incrementa attempts
COMMIT;
```

**Backoff:** em falha, `run_after = now() + interval '2^attempts minutes'` (com teto).

**Idempotência:** `idempotency_key` único por “utilizador + acção + janela temporal” para evitar hunts duplicadas por double-click.

---

## 3. Ciclo de vida de um job `run_hunt`

| Etapa | Acção                                                                 |
| ----- | --------------------------------------------------------------------- |
| 1     | Claim job → `status = processing`                                     |
| 2     | Carregar `hunts`, `strategy_snapshot_json`, paths de CV se necessário |
| 3     | Montar filtros de busca a partir do `strategy_snapshot_json`          |
| 4     | Executar pipeline MCP local (`search_openings` -> `rank_openings`)    |
| 5     | Stream ou batch de logs → inserir `hunt_events`                       |
| 6     | Normalizar vagas → `openings` + `applications`                        |
| 7     | `hunts.status = completed` ou `failed` + `error_message`              |
| 8     | Job `done` ou `dead` (excedeu `max_attempts`)                         |

---

## 4. Invocação do agente

### Execução recomendada (actual)

- `HUNT_EXECUTOR=mcp` usa o servidor local em `apps/web/scripts/mcp/hunter-mcp-server.mjs`.
- Pipeline no worker: `search_openings` -> `dedupe_openings` -> `score_opening_with_groq` -> `rank_openings`.

**MCP local:**

- Configuração via variáveis de ambiente do worker; **não** commitar secrets.

---

## 5. Variáveis de ambiente (worker)

| Variável                    | Obrigatório                   | Descrição                                       |
| --------------------------- | ----------------------------- | ----------------------------------------------- |
| `DATABASE_URL`              | sim                           | Postgres com permissões de escrita              |
| `SUPABASE_SERVICE_ROLE_KEY` | se usar Storage API no worker | upload de CSV export                            |
| `GROQ_API_KEY`              | opcional                      | scoring com LLM (fallback heurístico sem chave) |
| `HUNT_MAX_RUNTIME_MS`       | recomendado                   | cancelamento cooperativo                        |
| `HUNT_MAX_LLM_CALLS`        | recomendado                   | orçamento por hunt                              |
| `NODE_ENV`                  | sim                           | `production`                                    |

Documentar no `.env.example` do pacote worker.

---

## 6. Health e observabilidade

- **`GET /health`** (opcional, bind localhost): `200` se processo vivo; opcionalmente `SELECT 1` na BD.
- **Logs estruturados JSON:** campos mínimos `timestamp`, `level`, `job_id`, `hunt_id`, `user_id`, `message`, `error.stack`.
- **Correlation:** todo log de uma execução partilha `hunt_id`.

---

## 7. Docker

```dockerfile
# Esboço conceitual
FROM node:22-alpine
# instalar deps do monorepo
WORKDIR /app
COPY worker/ ./
CMD ["node", "dist/index.js"]
```

- **Um processo por contentor**; escalar = mais réplicas com **mesma fila** (`SKIP LOCKED` distribui).
- **Restart policy:** `unless-stopped`; jobs interrompidos voltam a `queued` com `run_after` (lógica app).

---

## 8. Interacção com GitHub Issues (backend-br / frontendbr)

- Worker ou agente chama **GitHub REST API** com token **fine-grained** ou classic com scope mínimo (`public_repo` só leitura).
- Respeitar **rate limit** (conditional requests, `ETag`); cache de issues já vistas em `openings` ou tabela auxiliar.

---

## 9. Falhas comuns

| Problema             | Mitigação                                                    |
| -------------------- | ------------------------------------------------------------ |
| MCP Indeed desligado | Retry + estado `failed` visível na UI                        |
| Timeout longo        | `HUNT_MAX_RUNTIME_MS` + hunt `failed` com mensagem clara     |
| Duplicar vagas       | `normalized_url` + unique parcial                            |
| Worker morre a meio  | Job volta a `queued` se heartbeat expirar (opcional, fase 2) |

---

## 10. Segurança

- Worker com **mesma** política de acesso à BD que o servidor — **nunca** logar CV completo nem tokens.
- Ficheiros temporários de prompt apagados após a hunt.

Ver [integracoes-externas.md](integracoes-externas.md) para quotas e ToS.
