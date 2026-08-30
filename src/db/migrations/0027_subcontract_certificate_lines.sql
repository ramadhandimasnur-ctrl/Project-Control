-- What a certificate actually certifies, item by item.
--
-- The header carries one value; the line carries the measurement behind it —
-- how much of which item, at which rate. Without it a certificate is a number
-- somebody agreed to, with nothing underneath to check it against.
CREATE TABLE IF NOT EXISTS subcontract_certificate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id uuid NOT NULL REFERENCES subcontract_certificates(id) ON DELETE CASCADE,
  subcontract_item_id uuid REFERENCES subcontract_items(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES work_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  qty numeric(18, 4) NOT NULL DEFAULT 0,
  -- Frozen when the certificate is raised. A rate renegotiated in June must not
  -- rewrite what was certified in March.
  unit_rate numeric(18, 2) NOT NULL DEFAULT 0,
  amount numeric(18, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT subcontract_certificate_lines_nonneg
    CHECK (qty >= 0 AND unit_rate >= 0 AND amount >= 0)
);

CREATE INDEX IF NOT EXISTS subcontract_certificate_lines_cert_idx
  ON subcontract_certificate_lines (certificate_id);

-- Ties a booked cost back to the certificate that produced it, so approving the
-- same certificate twice replaces its cost rather than adding a second copy.
ALTER TABLE actual_costs
  ADD COLUMN IF NOT EXISTS subcontract_certificate_id uuid
  REFERENCES subcontract_certificates(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS actual_costs_certificate_idx
  ON actual_costs (subcontract_certificate_id);
