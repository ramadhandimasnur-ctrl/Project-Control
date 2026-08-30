-- Where on site the work was measured.
--
-- "Lantai 2, as A–B" is what makes an opname entry checkable a month later.
-- Without it, two entries against the same work item in the same period are
-- indistinguishable, and the argument about whether one of them was already
-- counted has no evidence either way.
ALTER TABLE progress_entries ADD COLUMN IF NOT EXISTS location text;
