-- ===========================================================================
-- views.sql — the read model (charter section 4.10).
--
-- Relationship to lib/calc (charter rule 3):
--   `lib/calc/` is the *authority* on every formula. These views exist so that
--   dashboards and reports can aggregate thousands of rows in the database
--   instead of streaming them into Node. They are a performance mirror, never
--   a second opinion. Each view ships with a test that asserts it agrees with
--   the corresponding pure function on real data; if the two disagree, the
--   view is wrong.
--
-- Applied by `npm run db:views`, after migrations. Idempotent.
--
-- security_invoker = true so row-level security is evaluated as the querying
-- user. Without it a view would run with its owner's rights and hand back rows
-- the caller must not see.
--
-- Effective date: the views resolve prices as of CURRENT_DATE, because a view
-- takes no parameters. `resolvePrice(…, onDate)` remains the way to price an
-- estimate as of some other day; these are for "what is it worth now".
--
-- Delivery schedule — a view is written in the phase that owns its inputs:
--
--   Phase 3 (this file)
--     v_work_item_cost                     RAB, RAP, contract value, margin
--     v_work_item_weight                   weight per progress_weight_basis
--     v_project_cost_summary               totals per project
--     v_material_requirement               total RAP requirement per resource
--
--   Phase 4 (purchasing & warehouse)
--     v_inventory_balance, v_inventory_moving_cost, v_resource_actual_price
--   Phase 5 (schedule & baseline)
--     v_material_requirement_period
--   Phase 6 (progress)
--     v_progress_cumulative, v_scurve, v_material_theoretical_consumption
--   Phase 7 (cash)
--     v_cashflow_running, v_cash_forecast
--
-- Materialisation policy: all start as plain views. Only v_scurve and
-- v_inventory_moving_cost may become MATERIALIZED, and only once measured to
-- be slow, with REFRESH driven by the mutations that feed them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- v_work_item_cost — one row per work item.
--
-- The two LATERAL sub-selects reproduce `resolvePrice` exactly: a project
-- override outranks the organisation default, and among rows of the same scope
-- the newest one already in force wins. Ordering by id last keeps the choice
-- deterministic when two rows share an effective date.
--
-- A resource with no price contributes zero rather than making the whole row
-- null; `missing_price_count` is what tells the reader the total is partial.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_material_requirement CASCADE;
DROP VIEW IF EXISTS v_project_cost_summary CASCADE;
DROP VIEW IF EXISTS v_work_item_weight CASCADE;
DROP VIEW IF EXISTS v_work_item_cost CASCADE;

CREATE VIEW v_work_item_cost WITH (security_invoker = true) AS
WITH priced_line AS (
  SELECT
    wir.work_item_id,
    wi.project_id,
    wir.role,
    wir.coef_rab * (1 + wir.waste_factor) AS eff_coef_rab,
    wir.coef_rap * (1 + wir.waste_factor) AS eff_coef_rap,
    rab.price AS price_rab,
    rap.price AS price_rap
  FROM work_item_resources wir
  JOIN work_items wi ON wi.id = wir.work_item_id
  LEFT JOIN LATERAL (
    SELECT rp.price
    FROM resource_prices rp
    WHERE rp.resource_id = wir.resource_id
      AND rp.price_type = 'RAB'
      AND rp.effective_from <= CURRENT_DATE
      AND (rp.project_id IS NULL OR rp.project_id = wi.project_id)
    ORDER BY (rp.project_id IS NOT NULL) DESC, rp.effective_from DESC, rp.id DESC
    LIMIT 1
  ) rab ON true
  LEFT JOIN LATERAL (
    SELECT rp.price
    FROM resource_prices rp
    WHERE rp.resource_id = wir.resource_id
      AND rp.price_type = 'RAP'
      AND rp.effective_from <= CURRENT_DATE
      AND (rp.project_id IS NULL OR rp.project_id = wi.project_id)
    ORDER BY (rp.project_id IS NOT NULL) DESC, rp.effective_from DESC, rp.id DESC
    LIMIT 1
  ) rap ON true
),
rolled_up AS (
  SELECT
    work_item_id,
    sum(eff_coef_rab * coalesce(price_rab, 0)) AS unit_cost_rab,
    sum(eff_coef_rap * coalesce(price_rap, 0)) AS unit_cost_rap,
    count(*) FILTER (WHERE price_rab IS NULL OR price_rap IS NULL) AS missing_price_count,
    count(*) AS line_count
  FROM priced_line
  GROUP BY work_item_id
)
SELECT
  wi.id                                   AS work_item_id,
  wi.project_id,
  wi.code,
  wi.name,
  wi.volume,
  wi.include_in_progress_weight,
  wi.is_active,
  coalesce(r.line_count, 0)               AS line_count,
  coalesce(r.missing_price_count, 0)      AS missing_price_count,
  coalesce(r.unit_cost_rab, 0)            AS unit_cost_rab,
  coalesce(r.unit_cost_rap, 0)            AS unit_cost_rap,
  wi.volume * coalesce(r.unit_cost_rab, 0) AS total_rab,
  wi.volume * coalesce(r.unit_cost_rap, 0) AS total_rap,
  -- Design decision 1: the contract unit price is the authority. Only its
  -- absence falls back to RAB plus markup — a price of zero is a decision,
  -- not a gap, so COALESCE is applied to the price and never to the product.
  CASE
    WHEN wi.contract_unit_price IS NOT NULL THEN wi.volume * wi.contract_unit_price
    ELSE wi.volume * coalesce(r.unit_cost_rab, 0) * (1 + p.default_markup)
  END                                     AS contract_value,
  CASE
    WHEN wi.contract_unit_price IS NOT NULL THEN wi.volume * wi.contract_unit_price
    ELSE wi.volume * coalesce(r.unit_cost_rab, 0) * (1 + p.default_markup)
  END - wi.volume * coalesce(r.unit_cost_rap, 0) AS margin
FROM work_items wi
JOIN projects p ON p.id = wi.project_id
LEFT JOIN rolled_up r ON r.work_item_id = wi.id;

COMMENT ON VIEW v_work_item_cost IS
  'RAB, RAP, nilai kontrak, dan margin per pekerjaan. Cermin SQL dari lib/calc/estimate.ts.';

-- ---------------------------------------------------------------------------
-- v_work_item_weight — share of the project each work item carries.
--
-- The basis follows projects.progress_weight_basis. Items excluded from
-- progress weight get zero and are left out of the denominator, so the
-- remaining weights still sum to exactly 1.
--
-- Only active work items participate: a deactivated item must not quietly
-- hold a share of the progress.
-- ---------------------------------------------------------------------------
CREATE VIEW v_work_item_weight WITH (security_invoker = true) AS
WITH basis AS (
  SELECT
    c.work_item_id,
    c.project_id,
    c.include_in_progress_weight,
    CASE p.progress_weight_basis
      WHEN 'CONTRACT' THEN c.contract_value
      WHEN 'RAB'      THEN c.total_rab
      WHEN 'RAP'      THEN c.total_rap
    END AS basis_value
  FROM v_work_item_cost c
  JOIN projects p ON p.id = c.project_id
  WHERE c.is_active
),
denominator AS (
  SELECT project_id, sum(basis_value) AS total
  FROM basis
  WHERE include_in_progress_weight
  GROUP BY project_id
)
SELECT
  b.work_item_id,
  b.project_id,
  b.basis_value,
  CASE
    WHEN NOT b.include_in_progress_weight THEN 0
    -- No divide by zero: a project with no priced work yet has no weights,
    -- not an error.
    WHEN d.total IS NULL OR d.total = 0 THEN 0
    ELSE b.basis_value / d.total
  END AS weight
FROM basis b
LEFT JOIN denominator d ON d.project_id = b.project_id;

COMMENT ON VIEW v_work_item_weight IS
  'Bobot progres per pekerjaan sesuai progress_weight_basis. Cermin SQL dari lib/calc/weight.ts.';

-- ---------------------------------------------------------------------------
-- v_project_cost_summary — one row per project.
--
-- `contract_value_declared` is what Settings says; `contract_value_derived` is
-- what the work items add up to. Both are reported, and the difference with
-- them, because design decision 1 forbids silently reconciling the two.
-- ---------------------------------------------------------------------------
CREATE VIEW v_project_cost_summary WITH (security_invoker = true) AS
SELECT
  p.id                                          AS project_id,
  p.code,
  p.name,
  count(c.work_item_id)                         AS work_item_count,
  coalesce(sum(c.total_rab), 0)                 AS total_rab,
  coalesce(sum(c.total_rap), 0)                 AS total_rap,
  coalesce(sum(c.contract_value), 0)            AS contract_value_derived,
  p.contract_value                              AS contract_value_declared,
  coalesce(sum(c.contract_value), 0) - p.contract_value AS contract_value_difference,
  coalesce(sum(c.contract_value), 0) - coalesce(sum(c.total_rap), 0) AS margin,
  coalesce(sum(c.missing_price_count), 0)       AS missing_price_count
FROM projects p
LEFT JOIN v_work_item_cost c ON c.project_id = p.id AND c.is_active
GROUP BY p.id, p.code, p.name, p.contract_value;

COMMENT ON VIEW v_project_cost_summary IS
  'Total RAB/RAP/kontrak/margin per proyek, beserta selisih rekonsiliasi nilai kontrak.';

-- ---------------------------------------------------------------------------
-- v_material_requirement — how much of each resource the plan needs.
--
-- Quantity at RAP coefficients, since that is what execution will actually
-- consume. The value alongside it uses the same resolved RAP price the
-- estimate used, so requirement and budget cannot drift apart.
-- ---------------------------------------------------------------------------
CREATE VIEW v_material_requirement WITH (security_invoker = true) AS
SELECT
  wi.project_id,
  wir.resource_id,
  r.code                                        AS resource_code,
  r.name                                        AS resource_name,
  r.type                                        AS resource_type,
  u.code                                        AS unit_code,
  count(DISTINCT wi.id)                         AS work_item_count,
  sum(wi.volume * wir.coef_rap * (1 + wir.waste_factor)) AS qty_required,
  max(rap.price)                                AS price_rap,
  sum(wi.volume * wir.coef_rap * (1 + wir.waste_factor)) * max(rap.price) AS value_rap
FROM work_item_resources wir
JOIN work_items wi ON wi.id = wir.work_item_id AND wi.is_active
JOIN resources r ON r.id = wir.resource_id
JOIN units u ON u.id = r.unit_id
LEFT JOIN LATERAL (
  SELECT rp.price
  FROM resource_prices rp
  WHERE rp.resource_id = wir.resource_id
    AND rp.price_type = 'RAP'
    AND rp.effective_from <= CURRENT_DATE
    AND (rp.project_id IS NULL OR rp.project_id = wi.project_id)
  ORDER BY (rp.project_id IS NOT NULL) DESC, rp.effective_from DESC, rp.id DESC
  LIMIT 1
) rap ON true
GROUP BY wi.project_id, wir.resource_id, r.code, r.name, r.type, u.code;

COMMENT ON VIEW v_material_requirement IS
  'Kebutuhan total per sumber daya pada koefisien RAP. Cermin SQL dari lib/calc/material.ts.';

-- ---------------------------------------------------------------------------
-- The application connects as app_runtime inside request transactions, so it
-- needs read access to everything defined above.
-- ---------------------------------------------------------------------------
GRANT SELECT ON v_work_item_cost, v_work_item_weight, v_project_cost_summary,
                v_material_requirement TO app_runtime;
