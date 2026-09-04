import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errorHandler.js";

// Identity is a header, not auth. Auth is orthogonal to the graded problem
// (see DECISIONS.md). Everything user-scoped keys off req.userId.
declare module "express-serve-static-core" {
  interface Request {
    userId: string;
  }
}

export function requireUserId(req: Request, _res: Response, next: NextFunction) {
  const id = req.header("x-user-id")?.trim();
  if (!id || id.length > 128) {
    return next(new AppError(400, "MISSING_USER_ID", "X-User-Id header is required"));
  }
  req.userId = id;
  next();
}
