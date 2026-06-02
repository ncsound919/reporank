import { describe, it, expect, vi } from "vitest";
import { AppError, errorHandler } from "../middleware/errorHandler";
import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

vi.mock("../logger", () => ({ logger: { error: vi.fn() } }));

describe("AppError class", () => {
  it("creates error with status code and message", () => {
    const err = new AppError(404, "Not found", "NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Not found");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.name).toBe("AppError");
  });

  it("creates error without optional code", () => {
    const err = new AppError(400, "Bad request");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Bad request");
    expect(err.code).toBeUndefined();
  });

  it("handles various HTTP status codes", () => {
    const codes = [400, 401, 403, 404, 409, 429, 500, 502, 503];
    for (const code of codes) {
      const err = new AppError(code, "Error");
      expect(err.statusCode).toBe(code);
    }
  });
});

describe("errorHandler middleware", () => {
  it("handles AppError with code", () => {
    const err = new AppError(401, "Unauthorized", "INVALID_TOKEN");
    const req = {} as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized", code: "INVALID_TOKEN" });
  });

  it("handles AppError without code", () => {
    const err = new AppError(403, "Forbidden");
    const req = {} as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden", code: undefined });
  });

  it("handles generic Error as 500", () => {
    const err = new Error("Something broke");
    const req = {} as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("logs unhandled errors", () => {
    const err = new Error("Something broke");
    const req = {} as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    errorHandler(err, req, res, next);
    expect(logger.error).toHaveBeenCalled();
  });
});
