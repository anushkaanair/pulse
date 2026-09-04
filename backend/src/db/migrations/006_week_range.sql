-- 52-week trading band per symbol (Groww shows this as a low–high position
-- bar). Real values tracked by the ingestor, not faked at read time.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS week_high numeric(14,4);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS week_low  numeric(14,4);
