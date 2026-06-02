/**
 * Async route handler wrapper. Express 4 doesn't automatically forward
 * rejected promises from async handlers to error middleware — unhandled
 * rejections crash the process. This wrapper catches them.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler<T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}
