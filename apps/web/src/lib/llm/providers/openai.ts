import {
  LLMProvider,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMCVAnalysisRequest,
  LLMCVAnalysisResponse,
} from "../types";
import {
  CV_ANALYSIS_SYSTEM_PROMPT,
  CV_ANALYSIS_USER_PROMPT_TEMPLATE,
} from "../prompts";

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private apiKey: string;
  private baseUrl = "https://api.openai.com/v1";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!this.isConfigured()) {
      throw new Error("OpenAI API key not configured");
    }

    const model = request.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    const messages: Array<{ role: string; content: string }> = [];

    // System message
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }

    // User/assistant messages
    messages.push(...request.messages);

    const requestBody = {
      model,
      messages,
      max_tokens: request.maxTokens || 2048,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 0.95,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.statusText} - ${error}`);
    }

    const data: any = await response.json();

    const content = data.choices?.[0]?.message?.content || "";
    const tokensUsed = data.usage
      ? {
          input: data.usage.prompt_tokens,
          output: data.usage.completion_tokens,
          total: data.usage.total_tokens,
        }
      : undefined;

    return {
      content,
      modelUsed: model,
      stopReason: data.choices?.[0]?.finish_reason,
      tokensUsed,
    };
  }

  async analyzeCV(
    request: LLMCVAnalysisRequest,
  ): Promise<LLMCVAnalysisResponse> {
    const userPrompt = CV_ANALYSIS_USER_PROMPT_TEMPLATE(
      request.cvText,
      request.jobPreferences,
    );

    const response = await this.complete({
      system: CV_ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.3,
      maxTokens: 1024,
    });

    try {
      const parsed = JSON.parse(response.content);
      return {
        criteriaJson: parsed.criteriaJson || {},
        promptText: parsed.promptText || "",
        summary: parsed.summary,
        confidence: parsed.confidence,
        providerUsed: "openai",
        modelUsed: response.modelUsed,
      };
    } catch (err) {
      throw new Error(`Failed to parse OpenAI CV analysis: ${err}`);
    }
  }
}
