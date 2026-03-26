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

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private apiKey: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || "";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    if (!this.isConfigured()) {
      throw new Error("Gemini API key not configured");
    }

    const configuredModel = process.env.GEMINI_MODEL?.trim();
    const modelCandidates = request.model
      ? [request.model]
      : [
          configuredModel || "gemini-2.5-flash",
          "gemini-2.5-flash-lite",
          "gemini-flash-latest",
        ];
    const messages = request.messages;
    const systemPrompt = request.system;

    // Construir payload conforme Gemini API
    const contents = messages.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    // Gemini não tem role 'system' natively, prefixar no primeiro user message
    if (systemPrompt && contents.length > 0 && contents[0].role === "user") {
      contents[0].parts[0].text = `${systemPrompt}\n\n${contents[0].parts[0].text}`;
    }

    const requestBody = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens || 2048,
        temperature: request.temperature ?? 0.7,
        topP: request.topP ?? 0.95,
      },
    };

    let data: any = null;
    let modelUsed = "";
    let lastError = "";

    for (const model of modelCandidates) {
      const url = `${this.baseUrl}/${model}:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        data = await response.json();
        modelUsed = model;
        break;
      }

      const errorText = await response.text();
      lastError = `${response.statusText} - ${errorText}`;
      const isModelNotFound =
        response.status === 404 || errorText.includes("NOT_FOUND");
      if (!isModelNotFound) {
        throw new Error(`Gemini API error: ${lastError}`);
      }
    }

    if (!data) {
      throw new Error(
        `Gemini API error: nenhum modelo disponível. Último erro: ${lastError}`,
      );
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const tokensUsed = data.usageMetadata
      ? {
          input: data.usageMetadata.promptTokenCount || 0,
          output: data.usageMetadata.candidatesTokenCount || 0,
          total: data.usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    return {
      content,
      modelUsed,
      stopReason: data.candidates?.[0]?.finishReason,
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
      temperature: 0.3, // Mais determinístico para parsing
      maxTokens: 1024,
    });

    try {
      const parsed = JSON.parse(response.content);
      return {
        criteriaJson: parsed.criteriaJson || {},
        promptText: parsed.promptText || "",
        summary: parsed.summary,
        confidence: parsed.confidence,
        providerUsed: "gemini",
        modelUsed: response.modelUsed,
      };
    } catch (err) {
      throw new Error(`Failed to parse Gemini CV analysis: ${err}`);
    }
  }
}
