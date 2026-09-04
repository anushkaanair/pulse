import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { AppError } from "../middleware/errorHandler.js";
import type { MarketDataProvider } from "../market/provider.js";

const Faults = z.object({
  outage: z.boolean().optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  outOfOrderPct: z.number().min(0).max(100).optional(),
  duplicatePct: z.number().min(0).max(100).optional(),
  correctionPct: z.number().min(0).max(100).optional(),
});

// Demo + torture-test control surface for the unreliable dependency.
// Off by default in any environment where SIM_ADMIN isn't set.
export function simRouter(provider: MarketDataProvider) {
  const r = Router();
  const guard = () => {
    if (!config.simAdmin) throw new AppError(404, "NOT_FOUND", "Not found");
  };
  r.get("/api/_sim/faults", (_req, res, next) => {
    try {
      guard();
      res.json({ active: provider.getFaults() });
    } catch (err) {
      next(err);
    }
  });
  r.post("/api/_sim/faults", (req, res, next) => {
    try {
      guard();
      res.json({ active: provider.setFaults(Faults.parse(req.body)) });
    } catch (err) {
      next(err);
    }
  });
  return r;
}
