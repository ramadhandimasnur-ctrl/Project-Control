-- The correlation table: which workbook row became which row here.
--
-- The workbook identifies everything by its own keys — PRJ-0048, MDR-00001,
-- PER-003393 — and this application by uuid. Without a record of the pairing,
-- a second import would either duplicate everything or have to guess at
-- matches by name, and a workbook with two suppliers called "Toko Jaya" would
-- quietly become one.
--
-- It is also what lets an import be run again. Re-importing a corrected
-- workbook is the normal way to work, not an exception: the same row finds the
-- same target and updates it.
CREATE TABLE IF NOT EXISTS import_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Which workbook, so two different files cannot collide on PRJ-0001.
  source text NOT NULL,
  source_table text NOT NULL,
  source_id text NOT NULL,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  first_imported_at timestamptz NOT NULL DEFAULT now(),
  last_imported_at timestamptz NOT NULL DEFAULT now(),
  last_batch text
);

CREATE UNIQUE INDEX IF NOT EXISTS import_refs_source_unique
  ON import_refs (org_id, source, source_table, source_id);

-- Reverse lookups: "what did this project come from" is asked as often as
-- "where did PRJ-0048 go".
CREATE INDEX IF NOT EXISTS import_refs_target_idx
  ON import_refs (target_table, target_id);
