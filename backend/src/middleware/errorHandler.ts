import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Centralized error shape so the frontend can rely on a single contract:
// { error: string, code: string } for every 4xx/5xx, never a bare stack
// trace or an inconsistent ad-hoc shape from one route to the next.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Invalid request",
      code: "VALIDATION_ERROR",
      details: err.flatten(),
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  logger.error({ err, path: req.path }, "Unhandled error");
  return res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
  });
}
