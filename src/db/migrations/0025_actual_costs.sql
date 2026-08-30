-- Money spent, booked against the work item that consumed it.
--
-- Material is deliberately not stored here: issuing it from the warehouse
-- already records quantity, unit cost and the item, and a second copy of the
-- same fact would eventually disagree with the first. See the view
-- v_work_item_actual_cost, which unions the two and labels each source.
CREATE TABLE IF NOT EXISTS actual_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  resource_id uuid REFERENCES resources(id) ON DELETE SET NULL,
  category ahsp_role NOT NULL,
  cost_date date NOT NULL,
  qty numeric(18, 4),
  unit_cost numeric(18, 2),
  amount numeric(18, 2) NOT NULL,
  source_ref text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT actual_costs_amount_nonneg CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS actual_costs_project_idx   ON actual_costs (project_id, cost_date);
CREATE INDEX IF NOT EXISTS actual_costs_work_item_idx ON actual_costs (work_item_id);
