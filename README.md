# hunter

An AI-powered job hunting agent. It searches job platforms for openings that match your profile, evaluates them against your resume, and exports the results as a scored CSV.

## How it works

`main.sh` runs the AI agent using:

- **`system-prompt.md`** — instructs the AI to act as a senior job hunter, how to search, filter, score, and export results

- **`user-prompt.md`** — your personal criteria in natural language (keywords, filters, resume link, target platforms, ... e.g. written in your own way)

The agent searches supported platforms, optionally fetches your resume to improve match scoring, and writes the results to `exports/hunts/`.

## Supported Platforms

- [Indeed](https://indeed.com)
- [backend-br/vagas](https://github.com/backend-br/vagas/issues)
- [frontendbr/vagas](https://github.com/frontendbr/vagas/issues)


## Output

Results are saved to `exports/hunts/`. Format and columns are defined in `system-prompt.md`.


## Web app (Next.js 16)

```sh
yarn install
yarn dev
```

**AUTH_SECRET:** na raiz do repo, corre `yarn auth:secret` e cola o valor em `apps/web/.env.local` como `AUTH_SECRET="..."`.

Configuração: copia `.env.example` para `apps/web/.env.local` e preenche `AUTH_*`, `DATABASE_URL`. Detalhes em [apps/web/README.md](apps/web/README.md).

## Setup (CLI legado)

### 1. Install dependencies

```sh
yarn install
```

Log in:

```sh
claude auth login
```

### 2. Connect MCP servers

`.mcp.json` lists the configured MCP servers. Authorize each on first run — the agent will prompt you to connect via browser.

### 3. Configure your search

Copy the example prompt and fill in your own filters:

```sh
cp user-prompt.example.md user-prompt.md
```

Edit `user-prompt.md` with whatever criteria you want.

### 4. Run

```sh
bash main.sh
```

Results appear in `exports/hunts/`.

## Configuration

| File | Purpose |
|---|---|
| `system-prompt.md` | Agent behavior and output format |
| `user-prompt.md` | Your personal search criteria (gitignored) |
| `user-prompt.example.md` | Template for `user-prompt.md` |
| `.mcp.json` | MCP servers config |
| `.claude/settings.json` | Agent permissions |

## Privacy

`user-prompt.md` and `exports/` files are gitignored — your search criteria and results stay local.

## Platform roadmap

Product vision (Next.js 16, **Drizzle ORM**, **shadcn/ui**, Docker, **Supabase Postgres + Storage only**, **Auth.js + Google OAuth** (no Supabase Auth), **IA a partir do CV para estratégia**, pipeline de **candidaturas com link original**, lacunas de escopo, orçamento baixo, migração fácil), feature ideas, and improvements to this repo are documented in **[docs/plataforma-visao.md](docs/plataforma-visao.md)** (Portuguese).

Auxiliary technical docs (database, architecture, design system, workers, external APIs): **[docs/README.md](docs/README.md)**.

**Plano e o que já foi feito (PT):** **[docs/plano-estado.md](docs/plano-estado.md)**.
