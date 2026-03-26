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

export class GroqProvider implements LLMProvider {
  name = "groq";
  private apiKey: string;
  private baseUrl = "https://api.groq.com/openai/v1";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GROQ_API_KEY || "";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!this.isConfigured()) {
      throw new Error("Groq API key not configured");
    }

    const configuredModel = process.env.GROQ_MODEL?.trim();
    const modelCandidates = request.model
      ? [request.model]
      : [
          configuredModel || "llama-3.1-8b-instant",
          "llama-3.3-70b-versatile",
          "openai/gpt-oss-20b",
          "openai/gpt-oss-120b",
        ];
    const messages: Array<{ role: string; content: string }> = [];

    // System message
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }

    // User/assistant messages
    messages.push(...request.messages);

    let data: any = null;
    let modelUsed = "";
    let lastError = "";

    for (const model of modelCandidates) {
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

      if (response.ok) {
        data = await response.json();
        modelUsed = model;
        break;
      }

      const errorText = await response.text();
      lastError = `${response.statusText} - ${errorText}`;
      const canRetryWithOtherModel =
        response.status === 404 ||
        errorText.includes("model_decommissioned") ||
        errorText.includes("decommissioned") ||
        errorText.includes("not supported") ||
        errorText.includes("not found");

      if (!canRetryWithOtherModel) {
        throw new Error(`Groq API error: ${lastError}`);
      }
    }

    if (!data) {
      throw new Error(
        `Groq API error: nenhum modelo disponível. Último erro: ${lastError}`,
      );
    }

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
      modelUsed,
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
        providerUsed: "groq",
        modelUsed: response.modelUsed,
      };
    } catch (err) {
      throw new Error(`Failed to parse Groq CV analysis: ${err}`);
    }
  }
}
