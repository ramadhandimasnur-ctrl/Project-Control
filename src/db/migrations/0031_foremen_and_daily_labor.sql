-- Mandor as a master record, and the day-rate work they run.
--
-- The same person takes piecework one month and supplies a day-rate crew the
-- next, so the name belonged in one place rather than retyped on every
-- contract. Excel has had this shape for two versions; the web app carried
-- only a free-text party name on the contract.
CREATE TABLE IF NOT EXISTS foremen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  address text,
  bank_account text,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS foremen_org_code_unique ON foremen (org_id, code);

-- Nullable: contracts written before the master existed keep their typed name,
-- and a one-off party never worked with again does not need a master record.
ALTER TABLE subcontracts ADD COLUMN IF NOT EXISTS foreman_id uuid
  REFERENCES foremen(id) ON DELETE SET NULL;

-- Day-rate labour: paid per person per day whatever the output.
--
-- Distinct from a piecework contract in the one way that matters — the risk
-- sits with whoever is paying, not with the foreman — so it cannot be measured
-- against a contract quantity and needs its own record.
CREATE TABLE IF NOT EXISTS daily_labor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_id uuid REFERENCES schedule_periods(id) ON DELETE SET NULL,
  foreman_id uuid REFERENCES foremen(id) ON DELETE SET NULL,
  work_date date NOT NULL,
  worker_count integer NOT NULL,
  -- Half days are ordinary on site; 0,5625 is four and a half hours of eight.
  day_fraction numeric(9, 4) NOT NULL DEFAULT 1,
  daily_rate numeric(18, 2) NOT NULL,
  person_days numeric(18, 4) NOT NULL,
  gross_amount numeric(18, 2) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  paid_at date,
  payment_method text,
  ref_no text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT daily_labor_positive
    CHECK (worker_count > 0 AND day_fraction > 0 AND daily_rate >= 0),
  CONSTRAINT daily_labor_status_known
    CHECK (status IN ('DRAFT', 'APPROVED', 'PAID'))
);

CREATE INDEX IF NOT EXISTS daily_labor_project_idx ON daily_labor (project_id, work_date);
CREATE INDEX IF NOT EXISTS daily_labor_foreman_idx ON daily_labor (foreman_id);

-- Which work items the day was spent on, in person-days.
--
-- Without this a day's labour is a project-level lump and the cost screens
-- cannot say which item it belongs to — which is the whole reason they exist.
CREATE TABLE IF NOT EXISTS daily_labor_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_labor_id uuid NOT NULL REFERENCES daily_labor(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  person_days numeric(18, 4) NOT NULL,
  qty_output numeric(18, 4),
  allocated_cost numeric(18, 2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT daily_labor_lines_positive CHECK (person_days > 0 AND allocated_cost >= 0)
);

CREATE INDEX IF NOT EXISTS daily_labor_lines_parent_idx ON daily_labor_lines (daily_labor_id);

-- Ties a booked cost back to the day that produced it, so approving the same
-- day twice replaces its cost rather than adding a second copy.
ALTER TABLE actual_costs ADD COLUMN IF NOT EXISTS daily_labor_id uuid
  REFERENCES daily_labor(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS actual_costs_daily_labor_idx ON actual_costs (daily_labor_id);
