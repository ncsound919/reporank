/**
 * AI provider abstraction — supports Gemini, Ollama, and LM Studio.
 * Users can bring their own local model for private analysis.
 */

export interface AiProvider {
  generate(prompt: string, schema?: any): Promise<string>;
  name: string;
  isLocal: boolean;
}

export class GeminiProvider implements AiProvider {
  name = "Gemini 2.5 Flash";
  isLocal = false;

  constructor(private apiKey: string, private model: string = "gemini-2.5-flash") {}

  async generate(prompt: string): Promise<string> {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const response = await ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: { temperature: 0.2, responseMimeType: "application/json" },
    });
    return response.text || "";
  }
}

export class OllamaProvider implements AiProvider {
  name = "Ollama (Local)";
  isLocal = true;

  constructor(private model: string = "llama3", private endpoint: string = "http://localhost:11434") {}

  async generate(prompt: string): Promise<string> {
    const res = await fetch(`${this.endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: `Return ONLY valid JSON. No markdown, no code fences.\n\n${prompt}`,
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data: any = await res.json();
    return data.response || "";
  }
}

export class LMStudioProvider implements AiProvider {
  name = "LM Studio (Local)";
  isLocal = true;

  constructor(private model: string = "", private endpoint: string = "http://localhost:1234") {}

  async generate(prompt: string): Promise<string> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model || "local-model",
        messages: [
          { role: "system", content: "You are a codebase auditor. Return ONLY valid JSON. No markdown, no code fences." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 4096,
      }),
    });
    if (!res.ok) throw new Error(`LM Studio error: ${res.status}`);
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }
}

export function createProvider(type: string, apiKey: string, model?: string, endpoint?: string): AiProvider {
  switch (type) {
    case "ollama":
      return new OllamaProvider(model || "llama3", endpoint);
    case "lmstudio":
      return new LMStudioProvider(model || "", endpoint);
    case "gemini":
    default:
      return new GeminiProvider(apiKey, model || "gemini-2.5-flash");
  }
}
