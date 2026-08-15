-- ===========================================================================
-- views.sql — the read model (charter section 4.10).
--
-- Relationship to lib/calc (charter rule 3):
--   `lib/calc/` is the *authority* on every formula. These views exist so that
--   dashboards and reports can aggregate thousands of rows in the database
--   instead of streaming them into Node. They are a performance mirror, never
--   a second opinion. Each view is introduced together with a unit test that
--   asserts it agrees with the corresponding pure function on the seed data;
--   if the two ever disagree, the view is wrong.
--
-- Applied by `npm run db:views`, after migrations. Idempotent.
--
-- Delivery schedule — a view is written in the phase that owns its inputs,
-- because a formula written before its inputs exist cannot be verified:
--
--   Phase 3 (AHSP / RAB / RAP)
--     v_work_item_cost                     RAB, RAP, contract value, margin per work item
--     v_project_cost_summary               totals per project
--     v_work_item_weight                   weight per progress_weight_basis
--     v_material_requirement               total RAP requirement per resource
--
--   Phase 4 (purchasing & warehouse)
--     v_inventory_balance                  stock per (project, warehouse, resource)
--     v_inventory_moving_cost              weighted moving average cost
--     v_resource_actual_price              avg/last/min/max purchase price + variance vs RAP
--
--   Phase 5 (schedule & baseline)
--     v_material_requirement_period        requirement spread over baseline periods
--
--   Phase 6 (progress)
--     v_progress_cumulative                cumulative pct per work item per period (APPROVED only)
--     v_scurve                             planned vs actual cumulative per period
--     v_material_theoretical_consumption   progress x coefficient
--
--   Phase 7 (cash)
--     v_cashflow_running                   running balance
--     v_cash_forecast                      projected cash in/out
--
-- Materialisation policy: all of the above start as plain views. Only
-- v_scurve and v_inventory_moving_cost may become MATERIALIZED, and only once
-- measured to be slow, with REFRESH driven by the mutations that feed them.
--
-- ---------------------------------------------------------------------------
-- Phase 1 delivers no view: every one of them depends on the estimate, the
-- baseline or the ledgers, none of which carry data yet. The file is applied
-- on every deploy so that later phases only add statements below.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  RAISE NOTICE 'views.sql applied (belum ada view pada Fase 1 — lihat jadwal di header).';
END;
$$;
