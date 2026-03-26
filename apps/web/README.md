# Hunter — Web (Next.js 16)

## Requisitos

- Node 20+ (ver `.nvmrc` na raiz do repo)
- [Yarn](https://yarnpkg.com/) (Classic v1.x ou Berry)
- Conta Google Cloud / OAuth (Client ID Web)
- Projeto Supabase com Postgres (para perfis e resto do schema)

## Configuração

1. Na **raiz do monorepo**:

   ```bash
   yarn auth:secret
   ```

   Copia o output para o arquivo `.env` da raiz:

   ```env
   AUTH_SECRET="cole-o-valor-aqui"
   AUTH_GOOGLE_ID=""
   AUTH_GOOGLE_SECRET=""
   DATABASE_URL=""
   ```

2. Se ainda não existir, cria `.env` na raiz com base em `.env.example`.

3. Instala dependências na raiz: `yarn install`

4. Migrações Drizzle (com `DATABASE_URL` definido):

   ```bash
   yarn db:generate
   yarn db:push
   ```

5. Dev:

   ```bash
   yarn dev
   ```

Abre [http://localhost:3000](http://localhost:3000).

## Estrutura

- `src/app` — rotas App Router (landing, `/dashboard`, API Auth)
- `src/auth.ts` — Auth.js + Google
- `src/lib/db.ts` — cliente Drizzle (postgres.js)
- `src/components` — shell do painel + UI base (estilo shadcn)

O pacote `@hunter/db` vive em `packages/db`.
