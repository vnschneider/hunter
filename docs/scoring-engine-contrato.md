# Scoring Engine - Fase C: Contrato de API

**Status:** ✅ Implementado em `apps/web/scripts/worker/core/scoring-engine.mjs`

## Visão Geral

O Scoring Engine é um motor de pontuação desacoplado que:

- Pontu a vagas contra perfil do utilizador
- Implementa cache persistente (7 dias default)
- Batch processing com concorrência configurável
- Integração com Groq LLM com fallback heurístico
- Telemetria forte (cache hit rate, API calls, latência)

## Estrutura do Módulo

```javascript
import { createScoringEngine } from "./worker/core/scoring-engine.mjs";

const engine = createScoringEngine(config, logger);
```

### Parâmetros de Inicialização

- **`config`** (Object, opcional):
  - `cacheTtlMs`: Tempo de vida do cache em ms (default: 7 dias)
  - `groqBatchSize`: Tamanho do batch para processar (default: 3)
  - `groqConcurrency`: Batches em paralelo (default: 2)
- **`logger`** (Object, opcional): Objeto com método `.log(level, message, extra)`

### Variáveis de Ambiente

```bash
GROQ_API_KEY          # API key do Groq (se ausente, usa fallback heurístico)
GROQ_MODEL            # Modelo Groq a usar (default: llama-3.1-8b-instant)
```

## API Pública

### `engine.scoreOne(opening, profile, profileId)`

Pontua uma vaga individual contra o perfil.

**Parâmetros:**

```typescript
interface Opening {
  source: string; // Provider (linkedin, nerdin, etc)
  sourceId: string; // ID único no provider
  sourceUrl: string; // URL canônica
  title: string;
  companyName: string;
  description: string;
  remoteType?: string; // "remote" | "hybrid" | "on-site"
  seniority?: string; // "junior" | "mid" | "senior"
  // ... outros campos
}

interface Profile {
  keywords?: string[]; // Palavras-chave de busca
  skills?: string[]; // Stack técnico
  jobTitles?: string[]; // Títulos alvo
  seniorityLevel?: string; // "junior" | "mid" | "senior"
  workArrangement?: string; // "remote" | "hybrid" | "on-site"
  targetCountries?: string[]; // ["BR", "PT", ...]
}

profileId: string; // ID único do perfil (para cache key)
```

**Retorna:**

```typescript
{
  ...opening,
  matchScore: 0-100,        // Score calculado
  scoreSource: "cache" | "groq" | "heuristic"
}
```

**Exemplo:**

```javascript
const scored = await engine.scoreOne(
  {
    source: "linkedin",
    sourceId: "123456",
    sourceUrl: "https://...",
    title: "Senior TypeScript Engineer",
    companyName: "TechCorp",
    description: "We're looking for...",
    remoteType: "hybrid",
    seniority: "senior",
  },
  {
    keywords: ["TypeScript", "React", "Node.js"],
    skills: ["TypeScript", "React", "PostgreSQL"],
    jobTitles: ["Senior Engineer", "Tech Lead"],
    seniorityLevel: "senior",
    workArrangement: "hybrid",
    targetCountries: ["BR"],
  },
  "user-123-profile-v1",
);

console.log(`Score: ${scored.matchScore} (source: ${scored.scoreSource})`);
```

### `engine.scoreMany(openings, profile, profileId, concurrency?, onProgress?)`

Pontua múltiplas vagas em batches com concorrência controlada.

**Parâmetros:**

```typescript
openings: Opening[]         // Array de vagas para pontuar
profile: Profile           // Perfil do utilizador
profileId: string          // ID único para cache
concurrency?: number       // Número de batches em paralelo (default: 2)
onProgress?: (progress) => Promise<void>  // Callback de progresso
```

**Callback onProgress:**

```typescript
{
  processed: number; // Vagas processadas até agora
  total: number; // Total de vagas
  batchesCompleted: number; // Número de batches concluídos
  totalBatches: number; // Total de batches
}
```

**Retorna:**

```typescript
Opening[] // Array com matchScore adicionado a cada vaga
```

**Exemplo com progresso:**

```javascript
const scored = await engine.scoreMany(
  openings, // 50 vagas
  profile,
  "user-123",
  2, // 2 batches em paralelo
  async (progress) => {
    console.log(
      `${progress.processed}/${progress.total} vagas pontuadas ` +
        `(batch ${progress.batchesCompleted}/${progress.totalBatches})`,
    );
  },
);

console.log(`Total com score: ${scored.length}`);
```

### `engine.getStats()`

Retorna telemetria de cache e API calls.

**Retorna:**

```typescript
{
  totalScores: number; // Vagas pontuadas no lifetime
  cacheHits: number; // Resultados vindo de cache
  cacheMisses: number; // Vagas que tiveram que ser pontuadas
  groqCalls: number; // Quantas vezes Groq foi chamado
  groqErrors: number; // Falhas ao chamar Groq
  heuristicFallbacks: number; // Fallbacks heurísticos usados
  totalLatencyMs: number; // Tempo total gasto em ms
  cacheHitRate: "75.5%"; // Taxa de acerto do cache
  cacheSize: 1250; // Entradas em cache agora
  avgLatencyMs: "125"; // Latência média por score
}
```

**Exemplo:**

```javascript
const stats = engine.getStats();
console.log(
  `Cache hit rate: ${stats.cacheHitRate}. ` +
    `${stats.groqCalls} Groq calls, ${stats.groqErrors} errors. ` +
    `${stats.cacheSize} entries in cache.`,
);
```

### `engine.clearCache()`

Limpa todo o cache de scores.

```javascript
engine.clearCache();
```

### `engine.getCacheSize()`

Retorna número de entradas em cache.

```javascript
const size = engine.getCacheSize(); // 1250
```

## Características Principais

### 1. Cache com TTL (7 dias default)

- Por fingerprint: `{provider}|{sourceId}|{url}|profile={profileId}`
- Reduz chamadas a Groq significativamente
- Configurável via `cacheTtlMs`

### 2. Scoring com Groq LLM

**Quando disponível (GROQ_API_KEY):**

- Análise semântica completa
- Alinhamento entre skills, senioridade, type de trabalho
- Modelo: llama-3.1-8b-instant (rápido e eficiente)
- Prompt estruturado para consistência

**Quando falha ou não configurado:**

- Fallback heurístico com keyword overlap
- Cálculo: 40% match em título + 60% match em descrição
- Boosts por match de senioridade (+5) e tipo de trabalho (+5)
- Score 0-100

### 3. Batch Processing com Concorrência

```
3 vagas por batch × 2 concorrentes = 6 LLM calls em paralelo
```

- Reduz overhead de I/O
- Controlável via config
- Trade-off: latência vs throughput

### 4. Telemetria Completa

- Cache hit rate: quantas vagas vieram de cache
- Groq call details: calls + errors
- Fallback rate: % de heurísticos vs LLM
- Latência média por score

### 5. Integração com Worker

No `runMcpHuntPipeline` ou `runDirectGatewayHunt`:

```javascript
import { createScoringEngine } from "./worker/core/scoring-engine.mjs";

const scoreEngine = createScoringEngine(
  { groqConcurrency: 3, groqBatchSize: 5 },
  logger,
);

// Ao invés de loop sequencial:
const scored = await scoreEngine.scoreMany(
  openingsToScore,
  strategySnapshot,
  hunt.user_id, // profileId
  3, // concurrency
  async (progress) => {
    await emitHuntEvent(huntId, userId, "hunt_progress", {
      phase: "score_progress",
      message: `Pontuação: ${progress.processed}/${progress.total}`,
      ...progress,
    });
  },
);
```

## Performance e SLAs

| SLA                                        | Métrica                         | Target            | Notas                                   |
| ------------------------------------------ | ------------------------------- | ----------------- | --------------------------------------- |
| Latência por score (no cache)              | Sub-1ms                         | <5ms              | Lookup de hash + retorno                |
| Latência por score (Groq)                  | LLM inference                   | ~500-2000ms       | Dependente do modelo + latência Groq    |
| Cache hit rate                             | Repeat users                    | 70-85%            | Assumindo mesmo perfil, múltiplas hunts |
| Batch efficiency                           | 6 scores paralelo vs sequencial | 4-5x mais rápido  | 3 batches × 2 workers                   |
| Fallback accuracy                          | Heurístico vs LLM               | 80-90% correlação | Bom para MVP, LLM mais preciso          |
| Cache size (1000 profiles, 50 scores cada) | Memória                         | ~50MB             | Fingerprints + scores pequenos          |

## Roadmap Futuro

- **Fase D**: Classification engine (auto_apply_candidate? review_recommended? keep_for_later?)
- **Refinement**: Fine-tune Groq prompts por vertical (backend vs frontend vs data)
- **Persistence**: Opcional - armazenar scores em DB para análise histórica
- **Weighted Profiles**: Múltiplos pesos (e.g., "senior backend" vs "fullstack mid")

## Status de Integração

| Componente           | Status          | Detalhes                                      |
| -------------------- | --------------- | --------------------------------------------- |
| Cache                | ✅ Completo     | TTL 7 dias, fingerprint por abertura + perfil |
| Groq Integration     | ✅ Completo     | Fallback heurístico + retry                   |
| Batch Processing     | ✅ Completo     | Concorrência configurável                     |
| Telemetria           | ✅ Completo     | Stats detalhadas por categoria                |
| Worker Integration   | ⏳ Próximo      | Refatorar runMcpHuntPipeline para usar engine |
| Database Persistence | ❌ Não iniciado | Armazenar scores para análise                 |

## Segurança e Compliance

- Sem armazenamento de credenciais em cache
- Sem exposição de dados pessoais em logs
- Groq calls com timeout adequado (default 30s)
- Rate limiting herdado da Groq API
- Fallback heurístico garante sempre um score (nunca falha)
