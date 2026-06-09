import { Hono } from "hono";
import { llmComplete } from "../../llm";

export const llmCompleteRoute = new Hono().post("/complete", async (c) => {
  try {
    const body = await c.req.json();
    const result = await llmComplete({
      prompt: body.prompt,
      temperature: body.temperature,
      responseFormat: body.response_format || "json",
      provider: body.provider,
      model: body.model,
    });
    return c.json({ status: "success", content: result.content, usage: result.usage, provider: result.provider, model: result.model, latencyMs: result.latencyMs });
  } catch (err: any) {
    return c.json({ status: "error", error: err.message }, 500);
  }
});
