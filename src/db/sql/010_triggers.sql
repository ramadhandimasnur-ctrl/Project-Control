-- ===========================================================================
-- 010_triggers.sql — integrity that must not depend on application code.
--
-- Charter rule 6: financial and inventory rows are append-only. A correction
-- is a reversing entry or a VOID, never an UPDATE. These triggers are the last
-- line of defence: they hold even if a service function is bypassed, a script
-- runs raw SQL, or someone opens a database console.
--
-- Idempotent: safe to re-run on every deploy.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- updated_at maintenance
--
-- The ORM sets updated_at on its own writes; this makes the guarantee hold for
-- every write, including raw SQL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pc_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND EXISTS (
        SELECT 1 FROM information_schema.tables x
        WHERE x.table_schema = 'public' AND x.table_name = c.table_name
          AND x.table_type = 'BASE TABLE'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION pc_set_updated_at()', t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- material_transactions: semi-immutable
--
-- qty, unit_cost, txn_date and resource_id are the four fields the moving
-- average replays over. If any of them could change after the fact, every
-- historical stock value and every wastage figure would silently shift.
--
-- Voiding is the sanctioned mutation, so the void columns stay writable.
-- Deletion is never allowed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pc_material_transactions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.qty IS DISTINCT FROM OLD.qty
     OR NEW.unit_cost   IS DISTINCT FROM OLD.unit_cost
     OR NEW.txn_date    IS DISTINCT FROM OLD.txn_date
     OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.txn_type    IS DISTINCT FROM OLD.txn_type
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.unit_id     IS DISTINCT FROM OLD.unit_id
  THEN
    RAISE EXCEPTION
      'Transaksi material tidak dapat diubah. Buat transaksi pembalik atau ADJUSTMENT untuk mengoreksi.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.is_void AND NOT NEW.is_void THEN
    RAISE EXCEPTION 'Transaksi material yang sudah dibatalkan tidak dapat diaktifkan kembali.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

/**
 * Blocks ordinary deletes on the ledgers.
 *
 * One escape hatch: `app.allow_hard_delete = 'on'`. Removing a whole project
 * cascades into these tables, and without the hatch the cascade would abort —
 * a project could never be deleted once it had a single transaction. The flag
 * is transaction-local and set only by the project-deletion service and the
 * maintenance scripts, so a stray UPDATE or DELETE is still refused.
 */
CREATE OR REPLACE FUNCTION pc_block_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'Baris pada tabel % tidak dapat dihapus. Gunakan pembatalan (VOID) agar jejak audit tetap utuh.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_material_transactions_immutable ON public.material_transactions;
CREATE TRIGGER trg_material_transactions_immutable
  BEFORE UPDATE ON public.material_transactions
  FOR EACH ROW EXECUTE FUNCTION pc_material_transactions_immutable();

DROP TRIGGER IF EXISTS trg_material_transactions_no_delete ON public.material_transactions;
CREATE TRIGGER trg_material_transactions_no_delete
  BEFORE DELETE ON public.material_transactions
  FOR EACH ROW EXECUTE FUNCTION pc_block_delete();

-- ---------------------------------------------------------------------------
-- cash_transactions: rows owned by a source document
--
-- A cash row created by posting a purchase, certifying a subcontract or paying
-- a claim belongs to that document. Editing it directly would break the
-- one-to-one tie the reconciliation relies on.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pc_cash_transactions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_type <> 'MANUAL' THEN
    IF NEW.amount      IS DISTINCT FROM OLD.amount
       OR NEW.txn_date  IS DISTINCT FROM OLD.txn_date
       OR NEW.direction IS DISTINCT FROM OLD.direction
       OR NEW.category  IS DISTINCT FROM OLD.category
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
    THEN
      RAISE EXCEPTION
        'Transaksi kas ini dibuat otomatis dari dokumen sumbernya dan tidak dapat diubah langsung. Koreksi dokumen sumber, atau batalkan transaksi ini.'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF OLD.is_void AND NOT NEW.is_void THEN
    RAISE EXCEPTION 'Transaksi kas yang sudah dibatalkan tidak dapat diaktifkan kembali.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_transactions_guard ON public.cash_transactions;
CREATE TRIGGER trg_cash_transactions_guard
  BEFORE UPDATE ON public.cash_transactions
  FOR EACH ROW EXECUTE FUNCTION pc_cash_transactions_guard();

DROP TRIGGER IF EXISTS trg_cash_transactions_no_delete ON public.cash_transactions;
CREATE TRIGGER trg_cash_transactions_no_delete
  BEFORE DELETE ON public.cash_transactions
  FOR EACH ROW EXECUTE FUNCTION pc_block_delete();

-- ---------------------------------------------------------------------------
-- purchases: a POSTED purchase is closed
--
-- Posting already wrote the inventory movement, moved the average cost and
-- recorded cash. Re-editing the header afterwards would desynchronise all
-- three. Only the payment fields and a transition to VOID remain open.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pc_purchases_posted_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'POSTED' THEN
    IF NEW.subtotal   IS DISTINCT FROM OLD.subtotal
       OR NEW.vat_amount   IS DISTINCT FROM OLD.vat_amount
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.purchase_date IS DISTINCT FROM OLD.purchase_date
       OR NEW.supplier_id  IS DISTINCT FROM OLD.supplier_id
       OR NEW.project_id   IS DISTINCT FROM OLD.project_id
    THEN
      RAISE EXCEPTION
        'Pembelian yang sudah di-POST tidak dapat diubah. Batalkan (VOID) pembelian ini lalu buat yang baru.'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF OLD.status = 'VOID' AND NEW.status <> 'VOID' THEN
    RAISE EXCEPTION 'Pembelian yang sudah dibatalkan tidak dapat diaktifkan kembali.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchases_posted_lock ON public.purchases;
CREATE TRIGGER trg_purchases_posted_lock
  BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION pc_purchases_posted_lock();

-- Line items of a posted purchase are equally closed.
CREATE OR REPLACE FUNCTION pc_purchase_items_posted_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
  parent_id uuid;
BEGIN
  -- Same exception as the ledger triggers: deleting a project cascades through
  -- here, and a posted purchase would otherwise pin the project forever.
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  parent_id := COALESCE(NEW.purchase_id, OLD.purchase_id);
  SELECT p.status INTO parent_status FROM public.purchases p WHERE p.id = parent_id;

  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION
      'Baris pembelian yang sudah di-POST tidak dapat diubah atau dihapus. Batalkan (VOID) pembeliannya terlebih dahulu.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_items_posted_lock ON public.purchase_items;
CREATE TRIGGER trg_purchase_items_posted_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION pc_purchase_items_posted_lock();

-- ---------------------------------------------------------------------------
-- baseline_distributions: frozen by definition
--
-- The planned S-curve is read from the active baseline. If a baseline could be
-- edited, "plan versus actual" would compare actuals against a moving target.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pc_baseline_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Baseline jadwal bersifat beku. Buat baseline baru bila rencana berubah.'
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_baseline_distributions_immutable ON public.baseline_distributions;
CREATE TRIGGER trg_baseline_distributions_immutable
  BEFORE UPDATE ON public.baseline_distributions
  FOR EACH ROW EXECUTE FUNCTION pc_baseline_immutable();

-- ---------------------------------------------------------------------------
-- warehouses.org_id fills itself from the project
--
-- A warehouse attached to a project always belongs to that project's
-- organisation; asking every caller to say so again is asking to be told
-- something already known, and it is the kind of thing that gets forgotten in
-- a fixture, a script, or a migration written at speed.
--
-- Only a central warehouse — one with no project — has to name its own
-- organisation, and there the column is genuinely carrying information.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pc_warehouse_org_from_project() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.project_id IS NOT NULL THEN
    SELECT p.org_id INTO NEW.org_id FROM public.projects p WHERE p.id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouse_org_from_project ON public.warehouses;
CREATE TRIGGER trg_warehouse_org_from_project
  BEFORE INSERT OR UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION pc_warehouse_org_from_project();
