import { describe, it, expect, vi } from "vitest";
import { asyncHandler } from "../middleware/asyncHandler";

describe("asyncHandler", () => {
  it("forwards resolved promises to next() if no response", async () => {
    const handler = asyncHandler(async (_req, res) => {
      res.json({ ok: true });
    });
    const req: any = {};
    const res: any = { json: vi.fn() };
    const next = vi.fn();
    handler(req, res, next);
    await new Promise(r => setTimeout(r, 0));
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("catches rejected promises and forwards to error middleware", async () => {
    const error = new Error("DB connection failed");
    const handler = asyncHandler(async () => {
      throw error;
    });
    const req: any = {};
    const res: any = {};
    const next = vi.fn();
    handler(req, res, next);
    await new Promise(r => setTimeout(r, 0));
    expect(next).toHaveBeenCalledWith(error);
  });

  it("does not call next() when handler succeeds and writes response", async () => {
    const handler = asyncHandler(async (_req, res) => {
      res.status(201).json({ created: true });
    });
    const req: any = {};
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    handler(req, res, next);
    await new Promise(r => setTimeout(r, 0));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ created: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("handles synchronous throws", async () => {
    const error = new Error("Sync throw");
    const handler = asyncHandler(async () => {
      throw error;
    });
    const req: any = {};
    const res: any = {};
    const next = vi.fn();
    handler(req, res, next);
    await new Promise(r => setTimeout(r, 0));
    expect(next).toHaveBeenCalledWith(error);
  });
});
