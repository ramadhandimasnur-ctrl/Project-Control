-- A quantity typed in place of a coefficient, on any AHSP line.
--
-- Nullable on purpose: NULL means "derive the quantity from the coefficient",
-- which is what every existing row does and must keep doing. A default would
-- have made every line look as though somebody had typed a figure into it.
ALTER TABLE work_item_resources ADD COLUMN IF NOT EXISTS qty numeric(18, 4);

-- Folded into the existing non-negativity check rather than added beside it,
-- so there is one constraint describing what a valid line looks like.
ALTER TABLE work_item_resources DROP CONSTRAINT IF EXISTS work_item_resources_nonneg;
ALTER TABLE work_item_resources ADD CONSTRAINT work_item_resources_nonneg
  CHECK (coef >= 0 AND waste_factor >= 0 AND (qty IS NULL OR qty >= 0));
