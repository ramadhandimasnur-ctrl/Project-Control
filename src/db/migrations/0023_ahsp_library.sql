-- Published unit-rate analyses, held as reference rather than as templates.
CREATE TABLE IF NOT EXISTS ahsp_library_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  unit_code text NOT NULL,
  source_name text,
  source_year integer,
  source_document text,
  source_sheet text,
  source_row integer,
  source_url text,
  import_batch text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ahsp_library_entries_org_code_unique
  ON ahsp_library_entries (org_id, code);
CREATE INDEX IF NOT EXISTS ahsp_library_entries_org_idx
  ON ahsp_library_entries (org_id);

CREATE TABLE IF NOT EXISTS ahsp_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES ahsp_library_entries(id) ON DELETE CASCADE,
  role ahsp_role NOT NULL,
  resource_code text NOT NULL,
  resource_name text NOT NULL,
  unit_code text NOT NULL,
  coef numeric(18, 6) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT ahsp_library_items_coef_nonneg CHECK (coef >= 0)
);

CREATE INDEX IF NOT EXISTS ahsp_library_items_entry_idx ON ahsp_library_items (entry_id);
CREATE INDEX IF NOT EXISTS ahsp_library_items_code_idx  ON ahsp_library_items (resource_code);
