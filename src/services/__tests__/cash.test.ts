import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as CashModule from '../cash';
import type { SessionUser } from '../session';
import { guardDatabase, probeSchema } from './_support/schema-probe';

/**
 * Phase 7's definition of done: a claim bills only what is newly certified, the
 * advance is recouped but never over-recouped, and marking a claim paid moves
 * real money in the same transaction.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const probe = await probeSchema('Keuangan', async (db) => {
  const rows = await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('payment_terms', 'payment_claims', 'cash_transactions', 'cash_accounts')
  `;
  return rows[0]?.n === 4;
});

// A configured database that cannot be reached is a failure, not a skip:
// a suite that verified nothing must not look as though it had.
guardDatabase('Keuangan', probe);
const ready = probe.ready;

describe.skipIf(!ready)('Keuangan proyek', () => {
  let sql: postgres.Sql;
  let cash: typeof CashModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const accountId = randomUUID();
  const dpTermId = randomUUID();
  const progressTermId = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `keu-${userId}@uji.test`,
    fullName: 'Manajer Keuangan Uji',
    globalRole: 'ADMIN',
  };

  /** Contract 1.000.000.000 with 5% retention, 11% VAT, 2% withholding. */
  const buildFixture = async (): Promise<void> => {
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';

      INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Keuangan (uji)');
      INSERT INTO users (id, org_id, email, full_name, global_role)
        VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN');

      INSERT INTO projects (id, org_id, code, name, start_date, end_date, period_type,
                            contract_value, retention_percent, vat_percent, wht_percent)
        VALUES ('${projectId}', '${orgId}', 'KEU-1', 'Proyek Keuangan',
                '2026-01-01', '2026-03-31', 'MONTH', 1000000000, 0.05, 0.11, 0.02);
      INSERT INTO project_members (project_id, user_id, role)
        VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER');

      INSERT INTO units (id, org_id, code, name, dimension, factor_to_base)
        VALUES ('${unitId}', '${orgId}', 'ls', 'Lumpsum', 'LUMPSUM', 1);

      INSERT INTO cash_accounts (id, project_id, name, type, opening_balance)
        VALUES ('${accountId}', '${projectId}', 'Kas Proyek', 'BANK', 0);

      INSERT INTO payment_terms (id, project_id, seq, name, term_type, percent, dp_recoupment_percent)
        VALUES ('${dpTermId}', '${projectId}', 1, 'Uang Muka', 'DOWN_PAYMENT', 0.20, 0),
               ('${progressTermId}', '${projectId}', 2, 'Termin I', 'PROGRESS', 0.30, 0.25);
      COMMIT;
    `).simple();
  };

  const cashRows = async () => {
    const rows = await sql<{ direction: string; category: string; amount: string }[]>`
      SELECT direction, category, amount::text FROM cash_transactions
      WHERE project_id = ${projectId} AND is_void = false
    `;
    return rows;
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    cash = await import('../cash');
  });

  beforeEach(() => buildFixture());

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';
      COMMIT;
    `).simple();
    await sql.end();
  });

  describe('termin', () => {
    it('menghitung nilai termin dari persentase kontrak', async () => {
      const terms = await cash.listPaymentTerms(userId, projectId);
      expect(Number(terms.find((t) => t.seq === 1)?.valueAmount)).toBe(200000000);
      expect(Number(terms.find((t) => t.seq === 2)?.valueAmount)).toBe(300000000);
    });

    it('menolak termin tanpa persentase maupun nominal', async () => {
      await expect(
        cash.savePaymentTerm(user, projectId, null, {
          seq: 9,
          name: 'Kosong',
          termType: 'PROGRESS',
          percent: null,
          amount: null,
          triggerProgressPct: null,
          plannedDate: null,
          verificationDays: 0,
          paymentLagDays: 0,
          dpRecoupmentPercent: '0',
          note: null,
        }),
      ).rejects.toThrow(/persentase atau nominal/);
    });

    it('menolak urutan termin yang bertabrakan', async () => {
      await expect(
        cash.savePaymentTerm(user, projectId, null, {
          seq: 1,
          name: 'Bentrok',
          termType: 'PROGRESS',
          percent: '0.1',
          amount: null,
          triggerProgressPct: null,
          plannedDate: null,
          verificationDays: 0,
          paymentLagDays: 0,
          dpRecoupmentPercent: '0',
          note: null,
        }),
      ).rejects.toThrow(/sudah dipakai/);
    });
  });

  describe('tagihan', () => {
    it('menghitung potongan sesuai urutan praktik', async () => {
      const preview = await cash.previewClaim(userId, projectId, progressTermId, '0.1');

      expect(Number(preview.grossAmount)).toBe(100000000);
      expect(Number(preview.retentionWithheld)).toBe(5000000);
      expect(Number(preview.vatAmount)).toBe(11000000);
      expect(Number(preview.whtAmount)).toBe(2000000);
      expect(Number(preview.netAmount)).toBe(104000000);
    });

    // Billing the cumulative figure every period bills the same work twice.
    it('hanya menagih selisih sejak sertifikasi terakhir', async () => {
      await cash.createClaim(user, projectId, {
        paymentTermId: progressTermId,
        claimNo: 'INV-001',
        claimDate: '2026-02-01',
        periodId: null,
        certifiedProgressPct: '0.2',
      });

      const preview = await cash.previewClaim(userId, projectId, progressTermId, '0.35');
      expect(Number(preview.previouslyCertifiedPct)).toBe(0.2);
      expect(Number(preview.grossAmount)).toBe(150000000);
    });

    it('menolak tagihan tanpa progres baru', async () => {
      await cash.createClaim(user, projectId, {
        paymentTermId: progressTermId,
        claimNo: 'INV-001',
        claimDate: '2026-02-01',
        periodId: null,
        certifiedProgressPct: '0.3',
      });

      await expect(
        cash.createClaim(user, projectId, {
          paymentTermId: progressTermId,
          claimNo: 'INV-002',
          claimDate: '2026-02-15',
          periodId: null,
          certifiedProgressPct: '0.3',
        }),
      ).rejects.toThrow(/tidak ada progres baru/i);
    });

    it('menolak nomor tagihan yang sudah dipakai', async () => {
      await cash.createClaim(user, projectId, {
        paymentTermId: progressTermId,
        claimNo: 'INV-001',
        claimDate: '2026-02-01',
        periodId: null,
        certifiedProgressPct: '0.2',
      });

      await expect(
        cash.createClaim(user, projectId, {
          paymentTermId: progressTermId,
          claimNo: 'INV-001',
          claimDate: '2026-03-01',
          periodId: null,
          certifiedProgressPct: '0.4',
        }),
      ).rejects.toThrow(/sudah dipakai/);
    });
  });

  describe('pengembalian uang muka', () => {
    const claimAdvance = () =>
      cash.createClaim(user, projectId, {
        paymentTermId: dpTermId,
        claimNo: 'DP-001',
        claimDate: '2026-01-05',
        periodId: null,
        certifiedProgressPct: '0.2',
      });

    it('memotong uang muka dari tagihan berikutnya', async () => {
      await claimAdvance();

      // 20% sudah tersertifikasi lewat uang muka; menagih sampai 40%.
      const preview = await cash.previewClaim(userId, projectId, progressTermId, '0.4');
      expect(Number(preview.grossAmount)).toBe(200000000);
      // 25% dari bruto, dan masih ada sisa uang muka.
      expect(Number(preview.dpRecoupment)).toBe(50000000);
    });

    // Recouping more than was advanced would turn the owner into a creditor.
    it('tidak pernah mengembalikan lebih dari sisa uang muka', async () => {
      await claimAdvance();

      await cash.createClaim(user, projectId, {
        paymentTermId: progressTermId,
        claimNo: 'INV-001',
        claimDate: '2026-02-01',
        periodId: null,
        certifiedProgressPct: '1',
      });

      const [row] = await sql<{ dp: string }[]>`
        SELECT dp_recoupment::text AS dp FROM payment_claims WHERE claim_no = 'INV-001'
      `;
      // 25% dari bruto 800jt = 200jt, tetapi uang muka hanya 200jt.
      expect(Number(row?.dp)).toBe(200000000);

      const context = await cash.previewClaim(userId, projectId, progressTermId, '1');
      expect(Number(context.dpOutstanding)).toBe(0);
    });
  });

  describe('pembayaran dan buku kas', () => {
    it('menulis kas masuk dalam transaksi yang sama', async () => {
      const claim = await cash.createClaim(user, projectId, {
        paymentTermId: progressTermId,
        claimNo: 'INV-001',
        claimDate: '2026-02-01',
        periodId: null,
        certifiedProgressPct: '0.1',
      });

      expect(await cashRows()).toHaveLength(0);

      await cash.payClaim(user, projectId, claim.id, {
        accountId,
        paidAt: '2026-02-20',
      });

      const rows = await cashRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ direction: 'IN', category: 'TERMIN' });
      expect(Number(rows[0]?.amount)).toBe(104000000);
    });

    it('mencatat uang muka pada kategorinya sendiri', async () => {
      const claim = await cash.createClaim(user, projectId, {
        paymentTermId: dpTermId,
        claimNo: 'DP-001',
        claimDate: '2026-01-05',
        periodId: null,
        certifiedProgressPct: '0.2',
      });
      await cash.payClaim(user, projectId, claim.id, { accountId, paidAt: '2026-01-10' });

      expect((await cashRows())[0]?.category).toBe('DOWN_PAYMENT');
    });

    it('menolak pembayaran ganda', async () => {
      const claim = await cash.createClaim(user, projectId, {
        paymentTermId: progressTermId,
        claimNo: 'INV-001',
        claimDate: '2026-02-01',
        periodId: null,
        certifiedProgressPct: '0.1',
      });
      await cash.payClaim(user, projectId, claim.id, { accountId, paidAt: '2026-02-20' });

      await expect(
        cash.payClaim(user, projectId, claim.id, { accountId, paidAt: '2026-02-21' }),
      ).rejects.toThrow(/sudah tercatat lunas/);
    });

    it('mencatat pengeluaran manual dan memperbarui saldo akun', async () => {
      await cash.recordCashTransaction(user, projectId, {
        accountId,
        txnDate: '2026-01-15',
        direction: 'OUT',
        category: 'MATERIAL',
        amount: '25000000',
        description: 'Beli semen',
      });

      const accounts = await cash.listCashAccounts(userId, projectId);
      expect(Number(accounts[0]?.currentBalance)).toBe(-25000000);
    });

    it('menolak nilai transaksi nol atau negatif', async () => {
      await expect(
        cash.recordCashTransaction(user, projectId, {
          accountId,
          txnDate: '2026-01-15',
          direction: 'OUT',
          category: 'MATERIAL',
          amount: '0',
          description: null,
        }),
      ).rejects.toThrow(/lebih besar dari nol/);
    });

    // Voiding one side without the other is how ledgers drift apart.
    it('menolak pembatalan transaksi yang berasal dari dokumen lain', async () => {
      const claim = await cash.createClaim(user, projectId, {
        paymentTermId: progressTermId,
        claimNo: 'INV-001',
        claimDate: '2026-02-01',
        periodId: null,
        certifiedProgressPct: '0.1',
      });
      await cash.payClaim(user, projectId, claim.id, { accountId, paidAt: '2026-02-20' });

      const [row] = await sql<{ id: string }[]>`
        SELECT id FROM cash_transactions WHERE project_id = ${projectId} LIMIT 1
      `;

      await expect(
        cash.voidCashTransaction(user, projectId, row!.id, 'salah'),
      ).rejects.toThrow(/dokumen lain/);
    });

    it('membatalkan transaksi manual dan mengeluarkannya dari saldo', async () => {
      const txn = await cash.recordCashTransaction(user, projectId, {
        accountId,
        txnDate: '2026-01-15',
        direction: 'OUT',
        category: 'MATERIAL',
        amount: '25000000',
        description: null,
      });

      await cash.voidCashTransaction(user, projectId, txn.id, 'Salah input');

      const accounts = await cash.listCashAccounts(userId, projectId);
      expect(Number(accounts[0]?.currentBalance)).toBe(0);
    });
  });

  describe('arus kas per periode', () => {
    it('melaporkan tidak ada periode ketika kalender belum dibangun', async () => {
      const view = await cash.getCashflow(userId, projectId);
      expect(view.hasPeriods).toBe(false);
      expect(view.flow).toEqual([]);
    });

    it('mengelompokkan transaksi ke periode yang memuat tanggalnya', async () => {
      const schedule = await import('../schedule');
      await schedule.regeneratePeriods(user, projectId);

      await cash.recordCashTransaction(user, projectId, {
        accountId,
        txnDate: '2026-01-15',
        direction: 'OUT',
        category: 'MATERIAL',
        amount: '30000000',
        description: null,
      });
      await cash.recordCashTransaction(user, projectId, {
        accountId,
        txnDate: '2026-02-10',
        direction: 'IN',
        category: 'TERMIN',
        amount: '50000000',
        description: null,
      });

      const view = await cash.getCashflow(userId, projectId);

      expect(Number(view.flow[0]?.outflow)).toBe(30000000);
      expect(Number(view.flow[0]?.closing)).toBe(-30000000);
      expect(view.flow[0]?.isDeficit).toBe(true);

      // Saldo dibawa: −30jt + 50jt = 20jt.
      expect(Number(view.flow[1]?.closing)).toBe(20000000);
      expect(view.flow[1]?.isDeficit).toBe(false);

      expect(view.deficits).toHaveLength(1);
      expect(Number(view.peak?.shortfall)).toBe(30000000);
    });
  });
});
