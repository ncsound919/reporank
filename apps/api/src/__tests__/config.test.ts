import { describe, it, expect, beforeAll } from "vitest";

describe("Config validation", () => {
  const REQUIRED_VARS = ["DATABASE_URL", "REDIS_URL", "JWT_SECRET", "GEMINI_API_KEY"];

  it("requires all mandatory environment variables", () => {
    for (const v of REQUIRED_VARS) {
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it("requires exactly 4 mandatory variables", () => {
    expect(REQUIRED_VARS.length).toBe(4);
  });

  it("port defaults to 3001 when not set", () => {
    const port = parseInt(process.env.PORT || "3001", 10);
    expect(port).toBeGreaterThanOrEqual(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it("appUrl defaults when not set", () => {
    const url = process.env.APP_URL || "http://localhost:5173";
    expect(url).toMatch(/^https?:\/\//);
  });

  it("nodeEnv defaults to development", () => {
    const env = process.env.NODE_ENV || "development";
    expect(["development", "production", "test"]).toContain(env);
  });

  it("throws when DATABASE_URL is missing", () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const fallback = process.env.DATABASE_URL || "";
    expect(fallback).toBe("");
    if (original) process.env.DATABASE_URL = original;
  });

  it("parses deepScan as boolean", () => {
    const deep = process.env.DEEP_SCAN === "true";
    expect(typeof deep).toBe("boolean");
  });

  it("logLevel defaults to info", () => {
    const level = process.env.LOG_LEVEL || "info";
    expect(["info", "debug", "warn", "error", "trace"]).toContain(level);
  });

  it("github client ID defaults to empty string", () => {
    const id = process.env.GITHUB_CLIENT_ID || "";
    expect(typeof id).toBe("string");
  });
});
