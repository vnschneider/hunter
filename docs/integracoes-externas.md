# Integrações e consumo de dados externos

Inventário de **serviços fora** do repo, **dados** que entram/saem, **autenticação**, **quotas** e **boas práticas**. Alinhado a orçamento baixo.

---

## 1. Mapa resumo

| Sistema                     | Direcção                     | Auth                               | Uso no Hunter                                 |
| --------------------------- | ---------------------------- | ---------------------------------- | --------------------------------------------- |
| **Google OAuth**            | Entrada                      | OAuth 2.0 / OpenID                 | Login no painel (Auth.js)                     |
| **Postgres (Supabase)**     | App ↔ BD                     | `DATABASE_URL` (servidor + worker) | Dados persistentes                            |
| **Storage (Supabase)**      | App ↔ bucket                 | `service_role` servidor            | CVs, exports CSV opcionais                    |
| **Hunter MCP local**        | Worker → conectores externos | Variáveis de ambiente por conector | Pesquisa, dedupe e score de vagas             |
| **GitHub API**              | Worker/agente → GitHub       | `GITHUB_TOKEN` (PAT)               | Issues `backend-br/vagas`, `frontendbr/vagas` |
| **LLM “barato”** (opcional) | Next API → API               | Chave por fornecedor               | CV → estratégia (Gemini, Groq, Ollama local)  |

---

## 2. Google OAuth (Auth.js)

- **Consola Google Cloud:** criar projeto → OAuth consent screen → credenciais “OAuth client ID” (Web).
- **Redirect URIs:** `https://teu-dominio/api/auth/callback/google` (e localhost em dev).
- **Scopes mínimos:** `openid`, `email`, `profile`.
- **Segredos:** `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` (NextAuth v5) / `NEXTAUTH_*` conforme versão.
- **Dados recebidos:** `sub`, `email`, `name`, `picture` — persistir só o necessário em `profiles`.

**Custo:** gratuito para volumes típicos de app interna.

---

## 3. Supabase — Postgres

- **Connection string:** pooler recomendado em serverless (Vercel) se houver muitas ligações curtas.
- **Migrar fora:** qualquer Postgres compatível — trocar `DATABASE_URL` (ver [arquitetura.md](arquitetura.md)).

**Custo:** tier Free com limites de DB size e conexões — monitorizar.

---

## 4. Supabase — Storage

- **SDK:** apenas **servidor** (`@supabase/supabase-js` com `service_role` **ou** API REST assinada).
- **Bucket `cvs`:** privado; paths `{user_id}/{cv_id}.ext`.
- **Upload máximo:** definir no código (ex. 10 MB) + política de tipo MIME.

**Custo:** armazenamento + egress no plano Free.

**Migração:** S3, R2, MinIO — mesmo conceito de bucket + keys.

---

## 5. Hunter MCP (server local)

- Servidor em `apps/web/scripts/mcp/hunter-mcp-server.mjs`, invocado pelo worker via stdio.
- Conectores atuais: GitHub, Greenhouse e Lever.
- Configuração por env (`GITHUB_TOKEN`, `GREENHOUSE_BOARD_TOKENS`, `LEVER_SITES`).
- **Riscos:** rate limits de API externas e disponibilidade de provedores.

**Custo:** depende apenas das APIs externas e do provedor de score (Groq opcional).

---

## 6. GitHub — REST API

- **Endpoints úteis:** `GET /repos/{owner}/{repo}/issues` com filtros (labels, state), paginação.
- **Token:** PAT com scope **mínimo** (leitura pública pode nem precisar de token para rate limit maior — ver [docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
- **Rate limit:** sem auth ~60/h; com auth ~5000/h (contas normais). Implementar **cache** e **ETag**.

**Custo:** 0 €.

---

## 7. LLMs para “CV → estratégia” (opcional)

| Opção             | Autenticação             | Nota                         |
| ----------------- | ------------------------ | ---------------------------- |
| **Ollama**        | Nenhuma (local)          | Sem custo cloud; GPU/RAM     |
| **Google Gemini** | API key Google AI Studio | Free tier com limites        |
| **Groq**          | API key                  | Latência baixa; limites free |
| **OpenAI**        | API key                  | Pago / free trial            |

Fluxo: texto extraído do PDF → **um** request com schema JSON (Zod) → guardar `strategies`.

---

## 8. Outros dados externos (futuro)

- **Gupy / páginas de emprego:** scraping ou redirect manual — **ToS** e **CAPTCHA**; MVP pode só guardar **URL** e abrir no utilizador.
- **E-mail transaccional (Resend, etc.):** API key; alertas “hunt concluída”.

---

## 9. Checklist de segredos (nunca no cliente)

| Segredo                     | Onde                                       |
| --------------------------- | ------------------------------------------ |
| `DATABASE_URL`              | Next server, worker                        |
| `SUPABASE_SERVICE_ROLE_KEY` | Next server, worker (se Storage no worker) |
| `GITHUB_TOKEN`              | Worker                                     |
| Chaves LLM secundárias      | Next server (route de estratégia)          |
| OAuth client secret         | Next server apenas                         |

Rotacionar em vazamento; usar gestão de env no deploy (Vercel, Docker secrets).

---

## 10. Referências

- [GitHub REST](https://docs.github.com/en/rest)
- [Supabase Storage](https://supabase.com/docs/guides/storage)
- [Auth.js Providers](https://authjs.dev/getting-started/providers/google)
