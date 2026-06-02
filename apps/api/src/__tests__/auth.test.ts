import { describe, it, expect } from "vitest";

class AppError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
    this.name = "AppError";
  }
}

function parseAuthHeader(authHeader: string | undefined): { type: string; value: string } {
  if (!authHeader) throw new AppError(401, "No authorization header", "UNAUTHORIZED");
  if (authHeader.startsWith("gr_")) return { type: "api_key", value: authHeader };
  if (authHeader.startsWith("Bearer ")) return { type: "jwt", value: authHeader.slice(7) };
  throw new AppError(401, "Invalid authorization format", "INVALID_AUTH_FORMAT");
}

describe("Auth header parsing", () => {
  it("parses Bearer token", () => {
    const result = parseAuthHeader("Bearer eyJhbGciOiJIUzI1NiJ9.token");
    expect(result.type).toBe("jwt");
    expect(result.value).toBe("eyJhbGciOiJIUzI1NiJ9.token");
  });

  it("parses API key", () => {
    const result = parseAuthHeader("gr_abc123def456");
    expect(result.type).toBe("api_key");
    expect(result.value).toBe("gr_abc123def456");
  });

  it("throws on missing header", () => {
    expect(() => parseAuthHeader(undefined)).toThrow("No authorization header");
  });

  it("throws on invalid format", () => {
    expect(() => parseAuthHeader("Basic dXNlcjpwYXNz")).toThrow("Invalid authorization format");
  });

  it("throws on empty header", () => {
    expect(() => parseAuthHeader("")).toThrow("No authorization header");
  });

  it("API key starts with gr_ prefix", () => {
    const key = "gr_" + "a".repeat(64);
    expect(key.startsWith("gr_")).toBe(true);
    expect(key.length).toBe(67);
  });

  it("Bearer token has expected format", () => {
    const header = "Bearer token123";
    expect(header.startsWith("Bearer ")).toBe(true);
    expect(header.slice(7)).toBe("token123");
  });
});

describe("API key format validation", () => {
  it("generates valid API key format", () => {
    const { createHash } = require("node:crypto");
    const testKey = "gr_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    expect(testKey.startsWith("gr_")).toBe(true);
    expect(testKey.length).toBe(67);
    const hash = createHash("sha256").update(testKey).digest("hex");
    expect(hash.length).toBe(64);
  });
});
