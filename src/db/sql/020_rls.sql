-- ===========================================================================
-- 020_rls.sql — Row Level Security, the *second* layer of authorisation.
--
-- Charter section 3: the authority is `assertProjectAccess` in services/. RLS
-- exists so that a service function which forgets the guard still cannot read
-- or write another project's rows.
--
-- How the identity reaches the database
-- -------------------------------------
-- The application opens every request-scoped transaction with
--     SELECT set_config('app.current_user_id', '<uuid>', true)
-- (see `withUser()` in src/db/context.ts). Policies read that GUC. With no GUC
-- set every policy evaluates false and the row set is empty — it fails closed.
--
-- Migrations and the seed script legitimately run without a user; they set
-- `app.bypass_rls = 'on'` for their own transaction only.
--
-- Why some tables are ENABLE but not FORCE
-- ----------------------------------------
-- The policy helpers must themselves read `users`, `project_members` and
-- `projects` to answer "who is this and what may they see". If those four
-- backbone tables carried FORCE ROW LEVEL SECURITY, the policy on `projects`
-- would invoke a helper that selects from `projects`, whose policy invokes the
-- helper again — Postgres aborts with "infinite recursion detected in policy".
--
-- So the backbone is ENABLE-only: the owning role (the application's
-- connection, and on Supabase the `postgres` role) bypasses their policies,
-- which is exactly what lets the helpers terminate. Those four tables are
-- guarded by the service layer, and their policies still bind any non-owner
-- role such as PostgREST's `authenticated`.
--
-- Every table that actually holds project data carries FORCE, so a missing
-- service-layer guard cannot leak it.
--
-- Idempotent: safe to re-run.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Context helpers.
--
-- SECURITY DEFINER plus a pinned search_path. Each one reads only backbone
-- tables, which is what keeps them non-recursive.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pc_is_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION pc_current_user_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  raw text;
BEGIN
  raw := current_setting('app.current_user_id', true);
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pc_current_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.org_id FROM public.users u
  WHERE u.id = pc_current_user_id() AND u.is_active;
$$;

CREATE OR REPLACE FUNCTION pc_is_global_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = pc_current_user_id() AND u.is_active AND u.global_role = 'ADMIN'
  );
$$;

-- A global ADMIN reaches every project inside their own organisation; everyone
-- else needs an explicit `project_members` row.
CREATE OR REPLACE FUNCTION pc_can_access_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_project_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.project_members m
        WHERE m.project_id = p_project_id AND m.user_id = pc_current_user_id()
      )
      OR (
        pc_is_global_admin()
        AND EXISTS (
          SELECT 1 FROM public.projects pr
          WHERE pr.id = p_project_id AND pr.org_id = pc_current_org_id()
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION pc_can_access_org(p_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_org_id IS NOT NULL AND p_org_id = pc_current_org_id();
$$;

/*
 * Owning organisation of a project.
 *
 * SECURITY DEFINER matters here: a subquery written inline in a policy is
 * itself subject to the policies of the tables it reads. Looking up
 * `projects` inline would be filtered by the `projects` read policy, so a
 * project the user cannot yet see — the one they are creating — would appear
 * not to exist, and the enrolling INSERT would be refused.
 */
CREATE OR REPLACE FUNCTION pc_project_org_id(p_project_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.org_id FROM public.projects p WHERE p.id = p_project_id;
$$;

-- --------------------------------------------------------------------------
-- Apply one policy per table.
--
-- Predicates are written out per table rather than inferred, so a table added
-- later without an entry is caught by the assertion at the end of this file
-- instead of silently ending up unprotected.
--
-- `force` = false marks the four backbone tables described in the header.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
  spec text;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- Backbone: ENABLE only, so the policy helpers can terminate.
      ('organizations',             'id = pc_current_org_id()',                     false),
      ('users',                     'org_id = pc_current_org_id()',                 false),
      ('projects',                  'pc_can_access_project(id)',                    false),
      ('project_members',           'pc_can_access_project(project_id)',            false),

      -- Organisation-scoped master data
      ('units',                     'pc_can_access_org(org_id)',                    true),
      ('resource_categories',       'pc_can_access_org(org_id)',                    true),
      ('resources',                 'pc_can_access_org(org_id)',                    true),
      ('suppliers',                 'pc_can_access_org(org_id)',                    true),
      ('ahsp_templates',            'pc_can_access_org(org_id)',                    true),
      ('ahsp_template_resources',
        'EXISTS (SELECT 1 FROM public.ahsp_templates t WHERE t.id = template_id AND pc_can_access_org(t.org_id))', true),

      -- Price book: organisation defaults (project_id IS NULL) plus project overrides
      ('resource_prices',
        '(project_id IS NULL AND EXISTS (SELECT 1 FROM public.resources r WHERE r.id = resource_id AND pc_can_access_org(r.org_id)))
         OR (project_id IS NOT NULL AND pc_can_access_project(project_id))', true),

      -- Project-scoped, direct
      ('work_groups',               'pc_can_access_project(project_id)',            true),
      ('work_items',                'pc_can_access_project(project_id)',            true),
      ('schedule_periods',          'pc_can_access_project(project_id)',            true),
      ('project_holidays',          'pc_can_access_project(project_id)',            true),
      ('schedule_baselines',        'pc_can_access_project(project_id)',            true),
      ('progress_entries',          'pc_can_access_project(project_id)',            true),
      ('warehouses',                'pc_can_access_project(project_id)',            true),
      ('purchases',                 'pc_can_access_project(project_id)',            true),
      ('material_transactions',     'pc_can_access_project(project_id)',            true),
      ('subcontracts',              'pc_can_access_project(project_id)',            true),
      ('cash_accounts',             'pc_can_access_project(project_id)',            true),
      ('payment_terms',             'pc_can_access_project(project_id)',            true),
      ('payment_claims',            'pc_can_access_project(project_id)',            true),
      ('cash_transactions',         'pc_can_access_project(project_id)',            true),
      ('report_snapshots',          'pc_can_access_project(project_id)',            true),
      ('issues',                    'pc_can_access_project(project_id)',            true),
      ('audit_logs',                'project_id IS NULL OR pc_can_access_project(project_id)', true),

      -- Project-scoped, reached through a parent row
      ('volume_takeoffs',
        'EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = work_item_id AND pc_can_access_project(w.project_id))', true),
      ('work_item_resources',
        'EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = work_item_id AND pc_can_access_project(w.project_id))', true),
      ('work_item_milestones',
        'EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = work_item_id AND pc_can_access_project(w.project_id))', true),
      ('work_item_schedules',
        'EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = work_item_id AND pc_can_access_project(w.project_id))', true),
      ('planned_distributions',
        'EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = work_item_id AND pc_can_access_project(w.project_id))', true),
      ('work_item_checklists',
        'EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = work_item_id AND pc_can_access_project(w.project_id))', true),
      ('baseline_distributions',
        'EXISTS (SELECT 1 FROM public.schedule_baselines b WHERE b.id = baseline_id AND pc_can_access_project(b.project_id))', true),
      -- Reached directly now that a photograph need not hang off a progress
      -- entry. The old predicate went through progress_entries, and with that
      -- column nullable it would have let every entry-less row through.
      ('progress_documents',          'pc_can_access_project(project_id)',            true),
      ('purchase_items',
        'EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id AND pc_can_access_project(p.project_id))', true),
      ('subcontract_items',
        'EXISTS (SELECT 1 FROM public.subcontracts s WHERE s.id = subcontract_id AND pc_can_access_project(s.project_id))', true),
      ('subcontract_advances',
        'EXISTS (SELECT 1 FROM public.subcontracts s WHERE s.id = subcontract_id AND pc_can_access_project(s.project_id))', true),
      ('subcontract_certificates',
        'EXISTS (SELECT 1 FROM public.subcontracts s WHERE s.id = subcontract_id AND pc_can_access_project(s.project_id))', true)
    ) AS v(table_name, predicate, force_rls)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.table_name);

    IF rec.force_rls THEN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rec.table_name);
    ELSE
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', rec.table_name);
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS pc_access ON public.%I', rec.table_name);

    spec := format('(%s) OR pc_is_bypass()', rec.predicate);
    EXECUTE format(
      'CREATE POLICY pc_access ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
      rec.table_name, spec, spec);
  END LOOP;
END;
$$;

-- --------------------------------------------------------------------------
-- Bootstrap exception for the two tables a new project is born into.
--
-- The generic policy uses one expression for both USING and WITH CHECK, which
-- cannot work here: creating a project inserts the `projects` row *before* the
-- `project_members` row exists, so a membership-based WITH CHECK would reject
-- the very first insert and no project could ever be created.
--
-- Reads stay membership-based. Writes are confined to the user's own
-- organisation, which is the boundary RLS exists to defend; deciding *which*
-- member may write is the service layer's job (assertProjectAccess).
-- --------------------------------------------------------------------------
-- Reading stays strictly membership-based, so a colleague who was never added
-- to a project still cannot see it. Only the write check is relaxed, and only
-- as far as the user's own organisation.
--
-- This is also why `createProject` generates the project id itself instead of
-- using INSERT … RETURNING: RETURNING is evaluated against the USING clause,
-- which the creator cannot yet satisfy.
DROP POLICY IF EXISTS pc_access ON public.projects;
CREATE POLICY pc_access ON public.projects
  FOR ALL
  USING (pc_can_access_project(id) OR pc_is_bypass())
  WITH CHECK (pc_can_access_org(org_id) OR pc_is_bypass());

DROP POLICY IF EXISTS pc_access ON public.project_members;
CREATE POLICY pc_access ON public.project_members
  FOR ALL
  USING (pc_can_access_project(project_id) OR pc_is_bypass())
  WITH CHECK (pc_can_access_org(pc_project_org_id(project_id)) OR pc_is_bypass());

-- --------------------------------------------------------------------------
-- Fail the deployment if any base table ended up without a policy.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  unprotected text;
BEGIN
  SELECT string_agg(t.tablename, ', ' ORDER BY t.tablename) INTO unprotected
  FROM pg_tables t
  WHERE t.schemaname = 'public'
    AND t.tablename <> '__drizzle_migrations'
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.tablename
    );

  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'Tabel berikut belum memiliki policy RLS: %', unprotected;
  END IF;
END;
$$;
