import { LLMProvider, LLMProviderName } from "./types";
import { GeminiProvider } from "./providers/gemini";
import { OpenAIProvider } from "./providers/openai";
import { GroqProvider } from "./providers/groq";

export { GeminiProvider, OpenAIProvider, GroqProvider };
export type { LLMProvider, LLMProviderName };
export type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMCVAnalysisRequest,
  LLMCVAnalysisResponse,
} from "./types";

class LLMFactory {
  private providers: Map<LLMProviderName, LLMProvider> = new Map();

  constructor() {
    this.providers.set("gemini", new GeminiProvider());
    this.providers.set("openai", new OpenAIProvider());
    this.providers.set("groq", new GroqProvider());
  }

  /**
   * Obter provider baseado em variável de ambiente
   * Fallback para Gemini se nenhum estiver configurado
   */
  getProvider(): LLMProvider {
    const providerName = (process.env.LLM_PROVIDER ||
      "gemini") as LLMProviderName;
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Unknown LLM provider: ${providerName}`);
    }

    // Verificar se está configurado
    if (!provider.isConfigured()) {
      console.warn(
        `LLM provider '${providerName}' not configured, trying Gemini fallback...`,
      );
      const gemini = this.providers.get("gemini");
      if (gemini?.isConfigured()) {
        return gemini;
      }
      throw new Error(
        `No LLM provider configured. Set LLM_PROVIDER and corresponding API key.`,
      );
    }

    return provider;
  }

  /**
   * Obter provider específico
   */
  getProviderByName(name: LLMProviderName): LLMProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Unknown LLM provider: ${name}`);
    }
    return provider;
  }

  /**
   * Listar providers disponíveis (configurados)
   */
  listAvailable(): Array<{ name: LLMProviderName; configured: boolean }> {
    return Array.from(this.providers.entries()).map(([name, provider]) => ({
      name,
      configured: provider.isConfigured(),
    }));
  }
}

// Singleton
let factory: LLMFactory | null = null;

export function getLLMFactory(): LLMFactory {
  if (!factory) {
    factory = new LLMFactory();
  }
  return factory;
}

export function getLLMProvider(): LLMProvider {
  return getLLMFactory().getProvider();
}
