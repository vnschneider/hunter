# Provider Gateway - Fase B: Contrato de API

**Status:** ✅ Implementado e integrado em `apps/web/scripts/worker/core/provider-gateway.mjs`

## Visão Geral

O Provider Gateway formaliza a orquestração de múltiplos provedores de vagas com contratos estáveis, cache por fingerprint com TTL, telemetria por provider, e enforcement de timeout.

## Estrutura do Módulo

```javascript
import { createProviderGateway } from "./worker/core/provider-gateway.mjs";

const gateway = createProviderGateway(providersRegistry, logger);
```

### Parâmetros de Inicialização

- **`providersRegistry`** (Object): Mapa `{ providerName => asyncHandler }` onde cada handler recebe `criteria` e retorna `{ openings: [], elapsedMs? }`
- **`logger`** (Object, opcional): Objeto com método `.log(level, message, extra)` para instrumentação

### API Pública

#### `gateway.search(criteria, deadline?, providersToUse?)`

Orquestra busca em múltiplos providers com cache e timeout enforcement.

**Parâmetros:**

```typescript
interface SearchCriteria {
  keywords: string;          // Palavras-chave de busca
  location: string;          // Localização (ex: "BR", "São Paulo")
  filters?: {                // Opcional: filtros adicionais
    sources?: string[];      // Quais providers usar
    minConfidence?: number;  // Score mínimo
    seniority?: string;      // Nível de senioridade (junior/mid/senior)
    remoteType?: string;     // Tipo de remoto (remote/hybrid/on-site)
    publicationDays?: number; // Últimos N dias
  };
}

deadline?:        number;   // Timestamp em ms (hard deadline for search)
providersToUse?:  string[]; // Quais providers invocar (default: all)
```

**Retorna:**

```typescript
{
  openings: [
    {
      source: string;           // Nome do provider (linkedin, nerdin, etc)
      sourceId: string;         // ID único no provider
      title: string;
      companyName: string;
      description: string;
      locationText?: string;
      countryCode?: string;
      remoteType?: string;      // "remote" | "hybrid" | "on-site" | "unspecified"
      employmentType?: string;  // "full-time" | "part-time" | "contract" | "internship"
      seniority?: string;       // "junior" | "mid" | "senior"
      skills?: string[];
      salaryMin?: number;
      salaryMax?: number;
      salaryCurrency?: string;
      postedAt?: string;        // ISO 8601
      validThrough?: string;    // ISO 8601
      applyUrl: string;         // URL principal de candidatura
      sourceUrl: string;        // URL canônica da vaga
      language?: string;        // Código ISO 639-1 (pt, en, es)
      metadata?: object;        // Dados provider-específicos
      dedupeFingerprint?: string; // Gerado internamente
    }
  ],
  meta: {
    providers: [
      {
        provider: string;       // Nome do provider
        count: number;          // Vagas retornadas
        elapsedMs: number;      // Tempo de execução
        ok: boolean;            // Sucesso?
        error?: string;         // Mensagem de erro se falhou
      }
    ],
    totalElapsedMs: number;     // Tempo total gasto
    cacheHits: number;          // Quantas hits de cache (0 ou 1)
    cached: boolean;            // Veio do cache?
  }
}
```

**Exemplo de Uso:**

```javascript
const { openings, meta } = await gateway.search(
  {
    keywords: "TypeScript React",
    location: "São Paulo",
    filters: {
      sources: ["linkedin", "nerdin"],
      seniority: "senior",
      remoteType: "hybrid",
    },
  },
  Date.now() + 30000, // Deadline em 30s
);

console.log(`Encontradas ${openings.length} vagas em ${meta.totalElapsedMs}ms`);
meta.providers.forEach((p) => {
  console.log(
    `  ${p.provider}: ${p.count} vagas (${p.elapsedMs}ms) ${p.ok ? "✓" : "✗"}`,
  );
});
```

#### `gateway.clearCache()`

Limpa todo o cache de resultados.

```javascript
gateway.clearCache();
```

#### `gateway.getCacheStats()`

Retorna informações sobre cache.

**Retorna:**

```typescript
{
  size: number;           // Quantidade de entradas em cache
  entries: [
    {
      fingerprint: string;  // Chave do cache
      age: number;          // Idade em ms
      ttlMs: number;        // TTL original
      resultCount: number;  // Vagas nesta entrada
    }
  ]
}
```

#### `gateway.buildSearchFingerprint(criteria)`

Gera fingerprint para manual cache operations (testes, debugging).

```javascript
const fp = gateway.buildSearchFingerprint({
  keywords: "TypeScript",
  location: "BR",
  filters: { seniority: "senior" },
});
// fp = "TypeScript|BR|seniority=\"senior\""
```

## Características Principais

### 1. Cache com TTL (5 minutos default)

- Deduplicação automática de requests idênticos
- Reduz carga em providers e latência
- Configurável via `DEFAULT_CACHE_TTL_MS` (padrão: 300s)

### 2. Timeout por Provider (25s default)

- Cada provider tem timeout individual
- Não bloqueia outros providers
- Fallback com resultado vazio + error tracking

### 3. Execução Paralela

- Todos os providers chamados com `Promise.all()`
- Resulta em latência = max(provider latencies)
- Vs sequencial seria sum(latencies)

### 4. Telemetria Forte

Cada resultado inclui:

- Timestamp de início/fim
- Contagem de vagas retornadas por provider
- Status ok/error
- Mensagem de erro (se aplicável)
- Tempo total + breakdown por provider

### 5. Contrato de Normalização

Todos os `openings` retornados seguem o mesmo schema, independente do provider:

- URLs canônicas (`sourceUrl`, `applyUrl`)
- Campos padrão com defaults (remoteType="unspecified", seniority=null, etc)
- Fingerprint de deduplicação consistente

## Integração no Stack

### Via MCP (Recomendado para cliente web)

```javascript
// No hunter-mcp-server.mjs
import { createProviderGateway } from "../worker/core/provider-gateway.mjs";
const gateway = createProviderGateway(providersRegistry, logger);

// Tool: search_openings
handler: async ({ filters }) => {
  const { openings, meta } = await gateway.search(
    { keywords: filters.keywords, location: filters.location, filters },
    Date.now() + 30000,
  );
  // ... retorna openings + meta
};
```

### Direto no Worker (Mais Eficiente)

```javascript
// apps/web/scripts/worker.mjs
import { createProviderGateway } from "./worker/core/provider-gateway.mjs";
const gateway = createProviderGateway(providersRegistry, logger);

async function runDirectGatewayHunt(criteriaJson, onProgress, runContext) {
  const { openings, meta } = await gateway.search(
    { keywords: ..., location: ..., filters: ... },
    runContext.deadlineAt,
  );
  // ... dedupe, score, rank, persist
}
```

## Performance e SLAs

| SLA                                                    | Métrica               | Target                                          |
| ------------------------------------------------------ | --------------------- | ----------------------------------------------- |
| Latência de Search                                     | Max(providers)        | 20-30s                                          |
| Latência Total (search + dedupe)                       | Deadline - score time | 3-8s (quando sem score)                         |
| Parallelismo                                           | Concurrent providers  | 5 (linkedin, nerdin, greenhouse, lever, github) |
| Cache Hit Ratio (assumindo mesmo user, mesmo criteria) | Repeat searches       | ~60-80% over 5 min window                       |
| Fallback Rate                                          | Timeout/Error         | <5% (healthy providers)                         |

## Roadmap Futuro

- **Fase C**: Mover scoring para engine separado com batch + cache
- **Fase D**: Classification + auto-apply com audit trails
- **Fase E**: Migração de Go para performance ainda melhor (concurrency + GC)

## Segurança e Compliance

- Respeita `robots.txt` e ToS de cada provider
- Throttling e backoff automático em timeout/rate-limit
- Sem armazenamento de credentials em cache
- Audit trail via `hunt_events` table

## Status de Providers

| Provider      | Status                         | Cobertura | Notas                                 |
| ------------- | ------------------------------ | --------- | ------------------------------------- |
| LinkedIn      | ✅ Guest API + Search scraping | Alto      | URL parametrizada, fallback guest API |
| Nerdin        | ✅ Public listing pagination   | Médio     | Brasil-focused, parseabilidade boa    |
| Greenhouse    | ✅ API pública                 | Médio     | Requer API key, rate limits generosos |
| Lever         | ✅ API pública                 | Médio     | Requer API key, documentação boa      |
| GitHub Issues | ✅ REST API                    | Baixo     | Backend-BR/vagas + Frontend-BR/vagas  |
