-- Warehouses that belong to the organisation rather than to one project.
--
-- Buying in bulk for several sites is ordinary, and until now every warehouse
-- had to belong to exactly one project — so a lorry-load of cement split three
-- ways had to be entered three times, at three guessed quantities.
--
-- Additive on purpose. Project warehouses keep their project and keep working
-- exactly as before; a central warehouse is one with no project. Loosening
-- material_transactions to match would have made every project-scoped query and
-- every row-level policy in the inventory area answer a question it was never
-- asked, so central stock gets its own two tables instead.
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS address text;

-- Existing warehouses inherit the organisation of the project they belong to.
UPDATE warehouses w
   SET org_id = p.org_id
  FROM projects p
 WHERE p.id = w.project_id AND w.org_id IS NULL;

ALTER TABLE warehouses ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE warehouses ALTER COLUMN project_id DROP NOT NULL;

-- Goods arriving at a central warehouse. Carries its own terms: a bulk order
-- is invoiced to the company, not to a site, and falls due whatever any one
-- project is doing.
CREATE TABLE IF NOT EXISTS warehouse_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  doc_no text,
  receipt_date date NOT NULL,
  qty numeric(18, 4) NOT NULL,
  unit_id uuid REFERENCES units(id) ON DELETE RESTRICT,
  unit_price numeric(18, 2) NOT NULL DEFAULT 0,
  vat_percent numeric(9, 6) NOT NULL DEFAULT 0,
  total_amount numeric(18, 2) NOT NULL DEFAULT 0,
  due_date date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT warehouse_receipts_qty_positive CHECK (qty > 0),
  CONSTRAINT warehouse_receipts_amounts_nonneg CHECK (unit_price >= 0 AND total_amount >= 0),
  CONSTRAINT warehouse_receipts_due_after_receipt CHECK (due_date IS NULL OR due_date >= receipt_date)
);

CREATE INDEX IF NOT EXISTS warehouse_receipts_warehouse_idx
  ON warehouse_receipts (warehouse_id, receipt_date);

-- Central stock handed to a project. Issuing it writes an ordinary IN movement
-- on the project's own warehouse, which is where project costing already looks.
CREATE TABLE IF NOT EXISTS warehouse_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  allocated_on date NOT NULL,
  qty numeric(18, 4) NOT NULL,
  unit_cost numeric(18, 2) NOT NULL DEFAULT 0,
  -- The movement this allocation produced on the receiving project, so the two
  -- can never drift and reversing one reverses the other.
  material_transaction_id uuid REFERENCES material_transactions(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT warehouse_allocations_qty_positive CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS warehouse_allocations_warehouse_idx
  ON warehouse_allocations (warehouse_id, allocated_on);
CREATE INDEX IF NOT EXISTS warehouse_allocations_project_idx
  ON warehouse_allocations (project_id);
