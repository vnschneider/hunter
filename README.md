# hunter

Plataforma de hunting com arquitetura web + worker e pipeline MCP local para busca/ranqueamento de vagas.

## Stack

- Next.js 16 (app web)
- Worker Node.js (fila em Postgres)
- MCP local (`apps/web/scripts/mcp`) com conectores de vagas
- Postgres (jobs, hunts, openings, applications, events)

## Setup rápido

1. Instale dependências:

```sh
yarn install
```

1. Copie variáveis de ambiente:

```sh
cp .env.example .env
```

1. Gere o segredo de auth e preencha o `.env`:

```sh
yarn auth:secret
```

1. Suba schema no banco:

```sh
yarn db:generate
yarn db:push
```

## Execução local

Web:

```sh
yarn dev
```

Worker:

```sh
yarn worker
```

Servidor MCP isolado (debug):

```sh
yarn mcp:server
```

## Docker (somente worker por padrão)

`docker compose up -d` sobe `postgres` + `worker`.

Para subir também o web:

```sh
docker compose --profile web up -d
```

Painel web no Docker: `http://localhost:5000`.

## Documentação

- Visão geral e arquitetura: [docs/arquitetura.md](docs/arquitetura.md)
- Evolução Worker/MCP v2: [docs/arquitetura-worker-mcp-v2.md](docs/arquitetura-worker-mcp-v2.md)
- Pipeline MCP: [docs/mcp-hunter.md](docs/mcp-hunter.md)
- Worker e operação: [docs/workers.md](docs/workers.md)
- Plano e estado: [docs/plano-estado.md](docs/plano-estado.md)

Índice completo: [docs/README.md](docs/README.md).

## Observação de segurança

Credenciais que já circularam em ambiente local devem ser rotacionadas antes de qualquer deploy.
