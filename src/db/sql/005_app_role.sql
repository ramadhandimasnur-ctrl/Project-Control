-- ===========================================================================
-- 005_app_role.sql — the role that row-level security actually binds to.
--
-- Why this exists
-- ---------------
-- Supabase's `postgres` role carries the BYPASSRLS attribute. A role with that
-- attribute ignores every policy, FORCE ROW LEVEL SECURITY included. So an
-- application connecting as `postgres` gets no protection from RLS at all —
-- the policies are configured correctly and simply never consulted.
--
-- `app_runtime` is a NOLOGIN role with no special attributes, holding only the
-- data privileges the application needs. `withUser()` issues
--     SET LOCAL ROLE app_runtime
-- inside every request-scoped transaction, so the policies bind for the length
-- of that transaction and revert on commit. No second connection string and no
-- extra password: the application still connects as `postgres`, it just stops
-- *acting* as `postgres` once it starts touching project data.
--
-- Migrations and the seed keep the owner's privileges, which is why they can
-- still create tables and why `withBypass()` continues to work.
--
-- Idempotent: safe to re-run.
-- ===========================================================================

DO $$
DECLARE
  bypasses boolean;
  is_super boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- The defaults are already NOSUPERUSER / NOBYPASSRLS; naming them
    -- explicitly on ALTER requires privileges the Supabase `postgres` role
    -- does not have, so they are only stated here.
    CREATE ROLE app_runtime NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    RETURN;
  END IF;

  SELECT rolbypassrls, rolsuper INTO bypasses, is_super
  FROM pg_roles WHERE rolname = 'app_runtime';

  -- Only attempt repair if the role has actually drifted. Altering these
  -- attributes needs SUPERUSER, which we may not have; the assertion at the
  -- end of this file is what stops a deploy that ends up unsafe.
  IF bypasses OR is_super THEN
    BEGIN
      EXECUTE 'ALTER ROLE app_runtime NOBYPASSRLS';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'Tidak dapat mencabut BYPASSRLS dari app_runtime; perlu hak superuser.';
    END;
  END IF;
END;
$$;

-- The connecting role must be a member of app_runtime to SET ROLE to it.
DO $$
BEGIN
  EXECUTE format('GRANT app_runtime TO %I', current_user);
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN
  NULL;
END;
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_runtime;

-- Tables added by later migrations inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_runtime;

-- Fail loudly rather than leave the application unprotected.
DO $$
DECLARE
  bypasses boolean;
BEGIN
  SELECT rolbypassrls INTO bypasses FROM pg_roles WHERE rolname = 'app_runtime';

  IF bypasses IS NULL THEN
    RAISE EXCEPTION 'Peran app_runtime gagal dibuat. Row Level Security tidak akan berlaku bagi aplikasi.';
  END IF;

  IF bypasses THEN
    RAISE EXCEPTION 'Peran app_runtime memiliki BYPASSRLS; policy tidak akan pernah dievaluasi.';
  END IF;
END;
$$;
