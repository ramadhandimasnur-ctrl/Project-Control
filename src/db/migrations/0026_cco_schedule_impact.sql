-- A change order that adds work usually adds time, and the time extension is
-- what a delay claim rests on. Recorded on the revision rather than derived,
-- because it is negotiated, not calculated.
ALTER TABLE contract_revisions ADD COLUMN IF NOT EXISTS schedule_impact_days integer NOT NULL DEFAULT 0;

-- The dates on either side of the approval, captured at the moment it happens.
-- Recomputing them later would report today's schedule rather than the one the
-- addendum was signed against.
ALTER TABLE contract_revisions ADD COLUMN IF NOT EXISTS finish_date_before date;
ALTER TABLE contract_revisions ADD COLUMN IF NOT EXISTS finish_date_after  date;
