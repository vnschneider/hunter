# LLM Abstraction Layer

Camada abstrata para integração de múltiplos provedores de LLM com suporte para análise de CV e estratégia de caça.

## Arquitetura

```
┌─────────────────────────────────────────────────┐
│                   UI / Server Actions             │
│  (analyzeCV, CV Analysis Form, etc)              │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│           LLM Factory (index.ts)                 │
│  • getLLMProvider() — retorna provider ativo     │
│  • getLLMFactory() — acesso ao singleton         │
└──────────────────┬──────────────────────────────┘
                   │
      ┌────────────┼────────────┐
      │            │            │
   ┌──▼───┐    ┌───▼──┐    ┌───▼───┐
   │Gemini│    │OpenAI│    │ Groq  │
   │Provider  │Provider  │Provider  │
   └──────┘    └──────┘    └───────┘
      │            │            │
      └────────────┼────────────┘
                   │
      ┌────────────▼────────────────┐
      │  Interface: LLMProvider      │
      │  • complete()               │
      │  • analyzeCV()              │
      │  • isConfigured()           │
      └─────────────────────────────┘
```

## Estrutura de Arquivos

```
apps/web/src/lib/llm/
├── types.ts                 # Tipos e interfaces abstratas
├── prompts.ts              # Prompts reutilizáveis (ex: CV analysis)
├── index.ts                # Factory e exports públicos
└── providers/
    ├── gemini.ts           # Implementação Google Gemini
    ├── openai.ts           # Implementação OpenAI
    └── groq.ts             # Implementação Groq
```

## Como Usar

### 1. Configurar Provider

```bash
# .env.local
LLM_PROVIDER="gemini"
GEMINI_API_KEY="your-api-key"
```

### 2. Server Action ou Route Handler

```typescript
import { getLLMProvider } from "@/lib/llm";

export async function analyzeCV(formData: FormData) {
  const provider = getLLMProvider(); // Retorna o provider ativo

  const result = await provider.analyzeCV({
    cvText: formData.get("cvText"),
    jobPreferences: formData.get("preferences"),
    language: "pt",
  });

  // Result: { criteriaJson, promptText, summary, confidence }
  return result;
}
```

### 3. Trocar Provider (Runtime)

```typescript
import { getLLMFactory, openai } from "@/lib/llm";

const factory = getLLMFactory();
const groqProvider = factory.getProviderByName("groq");

// Usar Groq diretamente
const response = await groqProvider.complete({
  messages: [...],
  system: "...",
});
```

### 4. Listar Providers Disponíveis

```typescript
import { getLLMFactory } from "@/lib/llm";

const factory = getLLMFactory();
const available = factory.listAvailable();

// Output:
// [
//   { name: "gemini", configured: true },
//   { name: "openai", configured: false },
//   { name: "groq", configured: false }
// ]
```

## Tipos Principais

### LLMProvider Interface

```typescript
interface LLMProvider {
  name: string;
  isConfigured(): boolean;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
  analyzeCV(request: LLMCVAnalysisRequest): Promise<LLMCVAnalysisResponse>;
}
```

### LLMCompletionRequest

```typescript
{
  model?: string;                    // Ex: "gpt-4", "mixtral-8x7b-32768"
  system?: string;                   // System prompt
  messages: LLMMessage[];            // Conversation history
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}
```

### LLMCVAnalysisResponse

```typescript
{
  criteriaJson: {
    keywords: string[];
    skills: string[];
    jobTitles: string[];
    seniorityLevel: "junior" | "mid" | "senior" | "lead";
    workArrangement: "remote" | "onsite" | "hybrid";
    targetCountries: string[];     // Ex: ["BR", "US", "PT"]
    minSalary: number;
    currency: "BRL" | "USD" | "EUR";
    excludedKeywords: string[];
    platforms: string[];
  };
  promptText: string;                // PT: critérios em linguagem natural
  summary?: string;                  // Resumo do perfil
  confidence?: number;               // 0-1: quanto confia na análise
}
```

## Configuração por Provider

### Google Gemini

**Free Tier:**

- 15 requisições/minuto
- 500 requisições/dia
- Modelo: `gemini-1.5-flash` (mais rápido)

```bash
GEMINI_API_KEY="..." # Obter em https://ai.google.dev/
```

### OpenAI

**Pago por uso (~$0.015/1K tokens entrada)**

- Modelo recomendado: `gpt-4-turbo`

```bash
OPENAI_API_KEY="sk-..." # Obter em https://platform.openai.com/api-keys
```

### Groq

**Free Tier:**

- Alta throughput
- Latência muito baixa
- Modelos: `mixtral-8x7b-32768`, `llama-2-70b-chat`

```bash
GROQ_API_KEY="..." # Obter em https://console.groq.com/
```

## Tratamento de Erros

Todos os providers lançam erros padronizados:

```typescript
try {
  const result = await provider.analyzeCV({...});
} catch (err) {
  if (err instanceof Error && err.message.includes("API key")) {
    // Provider não configurado
  } else if (err instanceof Error && err.message.includes("JSON")) {
    // Falha ao fazer parse do resultado
  }
}
```

## Fallback Automático

Se o provider configurado não está disponível, o sistema tenta fallback:

1. Provider configurado em `LLM_PROVIDER`
2. Fallback automático para Gemini se disponível
3. Erro se nenhum provider está configurado

```typescript
const provider = getLLMProvider();
// Se "openai" não tem API key, tenta Gemini
```

## Adicionar Novo Provider

1. Criar arquivo `apps/web/src/lib/llm/providers/novo.ts`
2. Implementar interface `LLMProvider`
3. Registrar em `factory.ts`:

```typescript
this.providers.set("novo", new NovoProvider());
```

4. Atualizar `LLMProviderName` type

## Performance

- Gemini: ~1-2s (latência baiana)
- OpenAI: ~1s (latência nyc)
- Groq: <0.5s (latência ultra-baixa)

**Recomendação para MVP:** Gemini (free, rápido o suficiente)

## Logging & Monitoring

Cada provider retorna `tokensUsed`:

```typescript
const response = await provider.complete({...});

console.log(`Tokens: ${response.tokensUsed?.total} (in: ${response.tokensUsed?.input}, out: ${response.tokensUsed?.output})`);
```

Usar para estimativa de custo e auditoría.
