import { describe, it, expect, vi } from "vitest";
import { GeminiProvider, OllamaProvider, LMStudioProvider, createProvider } from "../providers/index";

describe("createProvider", () => {
  it("creates GeminiProvider by default", () => {
    const p = createProvider("gemini", "fake-key");
    expect(p.name).toContain("Gemini");
    expect(p.isLocal).toBe(false);
  });

  it("creates OllamaProvider", () => {
    const p = createProvider("ollama", "", "llama3", "http://localhost:11434");
    expect(p.name).toContain("Ollama");
    expect(p.isLocal).toBe(true);
  });

  it("creates LMStudioProvider", () => {
    const p = createProvider("lmstudio", "", "", "http://localhost:1234");
    expect(p.name).toContain("LM Studio");
    expect(p.isLocal).toBe(true);
  });
});

describe("GeminiProvider", () => {
  it("generates content via GoogleGenAI", async () => {
    vi.mock("@google/genai", () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: '{"score": 85}' }),
        },
      })),
    }));

    const { GoogleGenAI } = await import("@google/genai");
    const provider = new GeminiProvider("fake-key", "gemini-2.5-flash");
    const result = await provider.generate("test prompt");
    expect(typeof result).toBe("string");
  });
});

describe("OllamaProvider", () => {
  it("returns response from local API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ response: '{"score": 72}' }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new OllamaProvider("llama3", "http://localhost:11434");
    const result = await provider.generate("test prompt");
    expect(result).toBe('{"score": 72}');
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:11434/api/generate", expect.any(Object));
    vi.unstubAllGlobals();
  });

  it("throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new OllamaProvider("llama3", "http://localhost:11434");
    await expect(provider.generate("test")).rejects.toThrow("Ollama error: 503");
    vi.unstubAllGlobals();
  });
});

describe("LMStudioProvider", () => {
  it("returns response from local API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"score": 65}' } }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new LMStudioProvider("", "http://localhost:1234");
    const result = await provider.generate("test prompt");
    expect(result).toBe('{"score": 65}');
    vi.unstubAllGlobals();
  });

  it("throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new LMStudioProvider("", "http://localhost:1234");
    await expect(provider.generate("test")).rejects.toThrow("LM Studio error: 500");
    vi.unstubAllGlobals();
  });
});
