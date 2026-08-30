-- Sequential document numbers, per project and per kind.
--
-- Purchase orders, certificates and claims are referred to by number in
-- conversation and on paper, so the numbers have to be predictable and unique.
-- Left to people they collide: two site staff both type PO-014 on the same
-- afternoon and neither notices until the supplier asks which one to invoice.
CREATE TABLE IF NOT EXISTS document_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  last_number integer NOT NULL DEFAULT 0,
  pad_length integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_counters_last_number_nonneg CHECK (last_number >= 0),
  CONSTRAINT document_counters_pad_range CHECK (pad_length BETWEEN 1 AND 10)
);

-- One counter per kind per project. The unique index is what makes the
-- increment safe: two concurrent callers cannot create two counters to race on.
CREATE UNIQUE INDEX IF NOT EXISTS document_counters_project_type_unique
  ON document_counters (project_id, doc_type);
