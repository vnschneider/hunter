# Integrações e consumo de dados externos

Inventário de **serviços fora** do repo, **dados** que entram/saem, **autenticação**, **quotas** e **boas práticas**. Alinhado a orçamento baixo.

---

## 1. Mapa resumo

| Sistema | Direcção | Auth | Uso no Hunter |
|---------|----------|------|----------------|
| **Google OAuth** | Entrada | OAuth 2.0 / OpenID | Login no painel (Auth.js) |
| **Postgres (Supabase)** | App ↔ BD | `DATABASE_URL` (servidor + worker) | Dados persistentes |
| **Storage (Supabase)** | App ↔ bucket | `service_role` servidor | CVs, exports CSV opcionais |
| **Indeed MCP** | Worker → Indeed | Config MCP / sessão conforme doc Indeed | Pesquisa de vagas no agente |
| **GitHub API** | Worker/agente → GitHub | `GITHUB_TOKEN` (PAT) | Issues `backend-br/vagas`, `frontendbr/vagas` |
| **Anthropic / Claude** | Worker → API ou CLI | API key ou login CLI | Agente de caça |
| **LLM “barato”** (opcional) | Next API → API | Chave por fornecedor | CV → estratégia (Gemini, Groq, Ollama local) |

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

## 5. Indeed — MCP

- Configuração típica remota: URL tipo `https://mcp.indeed.com/...` (ver `.mcp.json` actual e documentação Indeed).
- **O agente** (Claude com MCP) consome as ferramentas expostas — não o browser directamente.
- **Riscos:** ToS, disponibilidade, necessidade de sessão/browser em alguns fluxos — validar em ambiente **não interactivo**.

**Custo:** conforme Indeed / produto MCP; rever termos.

---

## 6. GitHub — REST API

- **Endpoints úteis:** `GET /repos/{owner}/{repo}/issues` com filtros (labels, state), paginação.
- **Token:** PAT com scope **mínimo** (leitura pública pode nem precisar de token para rate limit maior — ver [docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
- **Rate limit:** sem auth ~60/h; com auth ~5000/h (contas normais). Implementar **cache** e **ETag**.

**Custo:** 0 €.

---

## 7. Anthropic / Claude (agente)

- **Modo CLI (`claude`):** autenticação `claude auth login` em build/deploy (frágil em CI) ou variável de ambiente se suportado.
- **Modo API:** `ANTHROPIC_API_KEY` — facturado por token.

**Boas práticas:**

- Limitar `max_tokens` e número de *turns* por hunt no worker.
- Não enviar CV completo se o system prompt só precisar de resumo — reduzir PII em logs.

**Custo:** principal variável do produto — ver [plataforma-visao.md](plataforma-visao.md) secção orçamento.

---

## 8. LLMs para “CV → estratégia” (opcional)

| Opção | Autenticação | Nota |
|-------|----------------|------|
| **Ollama** | Nenhuma (local) | Sem custo cloud; GPU/RAM |
| **Google Gemini** | API key Google AI Studio | Free tier com limites |
| **Groq** | API key | Latência baixa; limites free |
| **OpenAI** | API key | Pago / free trial |

Fluxo: texto extraído do PDF → **um** request com schema JSON (Zod) → guardar `strategies`.

---

## 9. Outros dados externos (futuro)

- **Gupy / páginas de emprego:** scraping ou redirect manual — **ToS** e **CAPTCHA**; MVP pode só guardar **URL** e abrir no utilizador.
- **E-mail transaccional (Resend, etc.):** API key; alertas “hunt concluída”.

---

## 10. Checklist de segredos (nunca no cliente)

| Segredo | Onde |
|---------|------|
| `DATABASE_URL` | Next server, worker |
| `SUPABASE_SERVICE_ROLE_KEY` | Next server, worker (se Storage no worker) |
| `GITHUB_TOKEN` | Worker |
| `ANTHROPIC_API_KEY` | Worker |
| Chaves LLM secundárias | Next server (route de estratégia) |
| OAuth client secret | Next server apenas |

Rotacionar em vazamento; usar gestão de env no deploy (Vercel, Docker secrets).

---

## 11. Referências

- [GitHub REST](https://docs.github.com/en/rest)
- [Supabase Storage](https://supabase.com/docs/guides/storage)
- [Auth.js Providers](https://authjs.dev/getting-started/providers/google)
