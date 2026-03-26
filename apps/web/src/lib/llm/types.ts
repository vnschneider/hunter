/**
 * Tipos abstratos para LLM
 * Interface agnóstica de provider
 */

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMCompletionRequest {
  model?: string;
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface LLMCompletionResponse {
  content: string;
  modelUsed?: string;
  stopReason?: string;
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
}

export interface LLMCVAnalysisRequest {
  cvText: string;
  jobPreferences?: string;
  language?: "pt" | "en";
}

export interface LLMCVAnalysisResponse {
  criteriaJson: Record<string, unknown>;
  promptText: string;
  summary?: string;
  confidence?: number;
  providerUsed?: LLMProviderName;
  modelUsed?: string;
}

export interface LLMProvider {
  name: string;
  isConfigured(): boolean;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
  analyzeCV(request: LLMCVAnalysisRequest): Promise<LLMCVAnalysisResponse>;
}

export type LLMProviderName = "gemini" | "openai" | "groq";
