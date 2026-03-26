# Documentação Hunter Platform

Índice dos documentos técnicos auxiliares. A visão de produto e o roadmap continuam em **[plataforma-visao.md](plataforma-visao.md)**.

| Documento                                          | Conteúdo                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| [estrutura-banco.md](estrutura-banco.md)           | Modelo relacional, tabelas, índices, enums, convenções Drizzle, Storage paths |
| [arquitetura.md](arquitetura.md)                   | Componentes do sistema, fluxos, deploy, limites de confiança entre serviços   |
| [design-system.md](design-system.md)               | Tokens de cor, tipografia, espaçamento, componentes shadcn, modo escuro       |
| [workers.md](workers.md)                           | Processo worker, fila em Postgres, execução do agente, variáveis, saúde       |
| [integracoes-externas.md](integracoes-externas.md) | Google OAuth, Supabase Storage, Indeed MCP, GitHub, LLMs, quotas e segredos   |
| [mcp-hunter.md](mcp-hunter.md)                     | MCP próprio: arquitetura, ferramentas, conectores, execução e roadmap         |

**Ordem sugerida de leitura para implementação:** arquitetura → banco → integrações → workers → design system (em paralelo ao front).

**Código:** aplicação web em [`apps/web`](../apps/web/README.md) (Next.js 16, Auth.js, Drizzle `@hunter/db`).

**Plano vs estado actual:** [plano-estado.md](plano-estado.md).
