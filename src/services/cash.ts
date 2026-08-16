import 'server-only';

import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { withUser } from '@/db/context';
import {
  cashAccounts,
  cashTransactions,
  paymentClaims,
  paymentTerms,
  progressEntries,
  projects,
  schedulePeriods,
} from '@/db/schema';
import { simulateCapitalNeed } from '@/lib/calc/capital';
import { toDecimal, toMoneyString, toPercentString } from '@/lib/calc/decimal';
import {
  type EarnedValueStrings,
  type PerformanceVerdict,
  earnedValue,
  performanceVerdict,
  toStrings as toEarnedValueStrings,
} from '@/lib/calc/earned-value';
import { completionByItem } from '@/lib/calc/progress';
import {
  type CashCategory,
  type CashDirection,
  type ClaimBreakdown,
  type CostVariance,
  type DeficitWarning,
  type PeriodCashflow,
  cashflowByPeriod,
  claimBreakdown,
  costVariance,
  deficitWarnings,
  peakFunding,
  projectedMargin,
} from '@/lib/calc/cashflow';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { getProjectEstimate } from './ahsp';
import { writeAuditLog } from './audit';
import { getProgressComparison } from './progress';
import { getScheduleOverview } from './schedule';
import { type SessionUser } from './session';

export type TermType = 'DOWN_PAYMENT' | 'PROGRESS' | 'MILESTONE' | 'RETENTION';
export type TermStatus = 'PLANNED' | 'CLAIMED' | 'INVOICED' | 'PAID';
export type ClaimStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID';

/**
 * Which cash rows count as realised project cost.
 *
 * Everything that left the project, tax included — a tax paid is money the
 * project no longer has, and excluding it would flatter every margin.
 */
const OUTFLOW_IS_COST = true;

// --- accounts ---------------------------------------------------------------

export type CashAccountRow = {
  id: string;
  name: string;
  type: 'CASH' | 'BANK';
  openingBalance: string;
  /** Opening balance plus every posted movement on this account. */
  currentBalance: string;
};

export async function listCashAccounts(
  userId: string,
  projectId: string,
): Promise<CashAccountRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const accounts = await db
    .select({
      id: cashAccounts.id,
      name: cashAccounts.name,
      type: cashAccounts.type,
      openingBalance: cashAccounts.openingBalance,
    })
    .from(cashAccounts)
    .where(eq(cashAccounts.projectId, projectId))
    .orderBy(asc(cashAccounts.name));

  if (accounts.length === 0) return [];

  const movements = await db
    .select({
      accountId: cashTransactions.accountId,
      direction: cashTransactions.direction,
      total: sql<string>`sum(${cashTransactions.amount})::text`,
    })
    .from(cashTransactions)
    .where(and(eq(cashTransactions.projectId, projectId), eq(cashTransactions.isVoid, false)))
    .groupBy(cashTransactions.accountId, cashTransactions.direction);

  return accounts.map((account) => {
    const balance = movements
      .filter((row) => row.accountId === account.id)
      .reduce(
        (acc, row) =>
          row.direction === 'IN' ? acc.plus(toDecimal(row.total)) : acc.minus(toDecimal(row.total)),
        toDecimal(account.openingBalance),
      );

    return { ...account, currentBalance: balance.toString() };
  });
}

export async function saveCashAccount(
  user: SessionUser,
  projectId: string,
  accountId: string | null,
  input: { name: string; type: 'CASH' | 'BANK'; openingBalance: string },
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const trimmed = input.name.trim();
  if (trimmed === '') throw validation('Nama akun kas wajib diisi.');

  const [duplicate] = await db
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.projectId, projectId), eq(cashAccounts.name, trimmed)))
    .limit(1);

  if (duplicate && duplicate.id !== accountId) {
    throw conflict(`Akun kas bernama "${trimmed}" sudah ada di proyek ini.`);
  }

  return withUser(user.id, async (tx) => {
    const values = {
      name: trimmed,
      type: input.type,
      openingBalance: toMoneyString(input.openingBalance),
      updatedBy: user.id,
    };

    let id = accountId;

    if (id === null) {
      const [created] = await tx
        .insert(cashAccounts)
        .values({ projectId, ...values, createdBy: user.id })
        .returning({ id: cashAccounts.id });
      if (!created) throw conflict('Akun kas gagal dibuat.');
      id = created.id;
    } else {
      await tx
        .update(cashAccounts)
        .set(values)
        .where(and(eq(cashAccounts.id, id), eq(cashAccounts.projectId, projectId)));
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'cash_accounts',
      recordId: id,
      action: accountId === null ? 'INSERT' : 'UPDATE',
      after: values,
      actorId: user.id,
    });

    return { id };
  });
}

// --- payment terms ----------------------------------------------------------

export type PaymentTermRow = {
  id: string;
  seq: number;
  name: string;
  termType: TermType;
  percent: string | null;
  amount: string | null;
  triggerProgressPct: string | null;
  plannedDate: string | null;
  verificationDays: number;
  paymentLagDays: number;
  dpRecoupmentPercent: string;
  status: TermStatus;
  note: string | null;
  /** Value this term is worth, resolved from percent or amount. */
  valueAmount: string;
  /** True once certified progress has reached the trigger. */
  isUnlocked: boolean;
  claimedAmount: string;
};

export async function listPaymentTerms(
  userId: string,
  projectId: string,
): Promise<PaymentTermRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [project] = await db
    .select({ contractValue: projects.contractValue })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw notFound('Proyek tidak ditemukan.');

  const [terms, claims, comparison] = await Promise.all([
    db
      .select()
      .from(paymentTerms)
      .where(eq(paymentTerms.projectId, projectId))
      .orderBy(asc(paymentTerms.seq)),
    db
      .select({
        paymentTermId: paymentClaims.paymentTermId,
        netAmount: paymentClaims.netAmount,
      })
      .from(paymentClaims)
      .where(eq(paymentClaims.projectId, projectId)),
    getProgressComparison(userId, projectId).catch(() => null),
  ]);

  const certified = toDecimal(comparison?.current.actualCumulative ?? 0);
  const contract = toDecimal(project.contractValue);

  return terms.map((term) => {
    const value =
      term.amount !== null ? toDecimal(term.amount) : contract.times(toDecimal(term.percent ?? 0));

    const claimed = claims
      .filter((claim) => claim.paymentTermId === term.id)
      .reduce((acc, claim) => acc.plus(toDecimal(claim.netAmount)), toDecimal(0));

    return {
      id: term.id,
      seq: term.seq,
      name: term.name,
      termType: term.termType,
      percent: term.percent,
      amount: term.amount,
      triggerProgressPct: term.triggerProgressPct,
      plannedDate: term.plannedDate,
      verificationDays: term.verificationDays,
      paymentLagDays: term.paymentLagDays,
      dpRecoupmentPercent: term.dpRecoupmentPercent,
      status: term.status,
      note: term.note,
      valueAmount: value.toString(),
      isUnlocked:
        term.triggerProgressPct === null ||
        certified.greaterThanOrEqualTo(toDecimal(term.triggerProgressPct)),
      claimedAmount: claimed.toString(),
    };
  });
}

export type PaymentTermInput = {
  seq: number;
  name: string;
  termType: TermType;
  percent: string | null;
  amount: string | null;
  triggerProgressPct: string | null;
  plannedDate: string | null;
  verificationDays: number;
  paymentLagDays: number;
  dpRecoupmentPercent: string;
  note: string | null;
};

export async function savePaymentTerm(
  user: SessionUser,
  projectId: string,
  termId: string | null,
  input: PaymentTermInput,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  if (input.percent === null && input.amount === null) {
    throw validation(
      'Termin harus menyebut persentase atau nominal.',
      'Isi salah satu; persentase dihitung terhadap nilai kontrak.',
    );
  }

  const [duplicate] = await db
    .select({ id: paymentTerms.id })
    .from(paymentTerms)
    .where(and(eq(paymentTerms.projectId, projectId), eq(paymentTerms.seq, input.seq)))
    .limit(1);

  if (duplicate && duplicate.id !== termId) {
    throw conflict(`Urutan termin ${input.seq} sudah dipakai.`);
  }

  return withUser(user.id, async (tx) => {
    const values = {
      seq: input.seq,
      name: input.name.trim(),
      termType: input.termType,
      percent: input.percent === null ? null : toPercentString(input.percent),
      amount: input.amount === null ? null : toMoneyString(input.amount),
      triggerProgressPct:
        input.triggerProgressPct === null ? null : toPercentString(input.triggerProgressPct),
      plannedDate: input.plannedDate,
      verificationDays: input.verificationDays,
      paymentLagDays: input.paymentLagDays,
      dpRecoupmentPercent: toPercentString(input.dpRecoupmentPercent),
      note: input.note,
      updatedBy: user.id,
    };

    let id = termId;

    if (id === null) {
      const [created] = await tx
        .insert(paymentTerms)
        .values({ projectId, ...values, createdBy: user.id })
        .returning({ id: paymentTerms.id });
      if (!created) throw conflict('Termin gagal dibuat.');
      id = created.id;
    } else {
      await tx
        .update(paymentTerms)
        .set(values)
        .where(and(eq(paymentTerms.id, id), eq(paymentTerms.projectId, projectId)));
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'payment_terms',
      recordId: id,
      action: termId === null ? 'INSERT' : 'UPDATE',
      after: values,
      actorId: user.id,
    });

    return { id };
  });
}

export async function deletePaymentTerm(
  user: SessionUser,
  projectId: string,
  termId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const [claim] = await db
    .select({ id: paymentClaims.id })
    .from(paymentClaims)
    .where(eq(paymentClaims.paymentTermId, termId))
    .limit(1);

  if (claim) {
    throw conflict(
      'Termin ini sudah pernah ditagihkan.',
      'Riwayat tagihan harus tetap dapat ditelusuri ke terminnya.',
    );
  }

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'payment_terms',
      recordId: termId,
      action: 'DELETE',
      actorId: user.id,
    });
    await tx
      .delete(paymentTerms)
      .where(and(eq(paymentTerms.id, termId), eq(paymentTerms.projectId, projectId)));
  });
}

// --- claims -----------------------------------------------------------------

export type ClaimRow = {
  id: string;
  claimNo: string;
  claimDate: string;
  termName: string;
  certifiedProgressPct: string;
  grossAmount: string;
  dpRecoupment: string;
  retentionWithheld: string;
  vatAmount: string;
  whtAmount: string;
  netAmount: string;
  status: ClaimStatus;
  paidAt: string | null;
};

export async function listClaims(userId: string, projectId: string): Promise<ClaimRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await db
    .select({
      id: paymentClaims.id,
      claimNo: paymentClaims.claimNo,
      claimDate: paymentClaims.claimDate,
      termName: paymentTerms.name,
      certifiedProgressPct: paymentClaims.certifiedProgressPct,
      grossAmount: paymentClaims.grossAmount,
      dpRecoupment: paymentClaims.dpRecoupment,
      retentionWithheld: paymentClaims.retentionWithheld,
      vatAmount: paymentClaims.vatAmount,
      whtAmount: paymentClaims.whtAmount,
      netAmount: paymentClaims.netAmount,
      status: paymentClaims.status,
      paidAt: paymentClaims.paidAt,
    })
    .from(paymentClaims)
    .innerJoin(paymentTerms, eq(paymentTerms.id, paymentClaims.paymentTermId))
    .where(eq(paymentClaims.projectId, projectId))
    .orderBy(asc(paymentClaims.claimDate));

  return rows;
}

/**
 * Works out what a claim on this term is worth, without writing anything.
 *
 * Feeds the preview dialog so the figures are on screen before anyone commits
 * to them (charter section 6.5).
 */
export async function previewClaim(
  userId: string,
  projectId: string,
  termId: string,
  certifiedProgressPct: string,
): Promise<ClaimBreakdown & { previouslyCertifiedPct: string; dpOutstanding: string }> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const context = await claimContext(projectId, termId);
  const breakdown = claimBreakdown({
    contractValue: context.contractValue,
    certifiedProgressPct,
    previouslyCertifiedPct: context.previouslyCertifiedPct,
    retentionPercent: context.retentionPercent,
    vatPercent: context.vatPercent,
    whtPercent: context.whtPercent,
    dpRecoupmentPercent: context.dpRecoupmentPercent,
    dpOutstanding: context.dpOutstanding,
  });

  return {
    ...breakdown,
    previouslyCertifiedPct: context.previouslyCertifiedPct,
    dpOutstanding: context.dpOutstanding,
  };
}

async function claimContext(projectId: string, termId: string) {
  const [project] = await db
    .select({
      contractValue: projects.contractValue,
      retentionPercent: projects.retentionPercent,
      vatPercent: projects.vatPercent,
      whtPercent: projects.whtPercent,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw notFound('Proyek tidak ditemukan.');

  const [term] = await db
    .select({
      id: paymentTerms.id,
      dpRecoupmentPercent: paymentTerms.dpRecoupmentPercent,
    })
    .from(paymentTerms)
    .where(and(eq(paymentTerms.id, termId), eq(paymentTerms.projectId, projectId)))
    .limit(1);

  if (!term) throw notFound('Termin tidak ditemukan pada proyek ini.');

  const existing = await db
    .select({
      certifiedProgressPct: paymentClaims.certifiedProgressPct,
      dpRecoupment: paymentClaims.dpRecoupment,
    })
    .from(paymentClaims)
    .where(eq(paymentClaims.projectId, projectId));

  // The highest certification so far, not the sum: certification is cumulative
  // by nature and adding the figures would double-count the same work.
  const previouslyCertifiedPct = existing.reduce(
    (acc, claim) => {
      const value = toDecimal(claim.certifiedProgressPct);
      return value.greaterThan(acc) ? value : acc;
    },
    toDecimal(0),
  );

  const advances = await db
    .select({ amount: paymentClaims.grossAmount })
    .from(paymentClaims)
    .innerJoin(paymentTerms, eq(paymentTerms.id, paymentClaims.paymentTermId))
    .where(
      and(eq(paymentClaims.projectId, projectId), eq(paymentTerms.termType, 'DOWN_PAYMENT')),
    );

  const advanced = advances.reduce((acc, row) => acc.plus(toDecimal(row.amount)), toDecimal(0));
  const recouped = existing.reduce(
    (acc, claim) => acc.plus(toDecimal(claim.dpRecoupment)),
    toDecimal(0),
  );

  const outstanding = advanced.minus(recouped);

  return {
    contractValue: project.contractValue,
    retentionPercent: project.retentionPercent,
    vatPercent: project.vatPercent,
    whtPercent: project.whtPercent,
    dpRecoupmentPercent: term.dpRecoupmentPercent,
    previouslyCertifiedPct: previouslyCertifiedPct.toString(),
    dpOutstanding: (outstanding.isNegative() ? toDecimal(0) : outstanding).toString(),
  };
}

export async function createClaim(
  user: SessionUser,
  projectId: string,
  input: {
    paymentTermId: string;
    claimNo: string;
    claimDate: string;
    periodId: string | null;
    certifiedProgressPct: string;
  },
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const claimNo = input.claimNo.trim();
  if (claimNo === '') throw validation('Nomor tagihan wajib diisi.');

  const [duplicate] = await db
    .select({ id: paymentClaims.id })
    .from(paymentClaims)
    .where(and(eq(paymentClaims.projectId, projectId), eq(paymentClaims.claimNo, claimNo)))
    .limit(1);

  if (duplicate) throw conflict(`Nomor tagihan "${claimNo}" sudah dipakai.`);

  const context = await claimContext(projectId, input.paymentTermId);
  const breakdown = claimBreakdown({
    contractValue: context.contractValue,
    certifiedProgressPct: input.certifiedProgressPct,
    previouslyCertifiedPct: context.previouslyCertifiedPct,
    retentionPercent: context.retentionPercent,
    vatPercent: context.vatPercent,
    whtPercent: context.whtPercent,
    dpRecoupmentPercent: context.dpRecoupmentPercent,
    dpOutstanding: context.dpOutstanding,
  });

  if (breakdown.grossAmount.isZero()) {
    throw validation(
      'Tidak ada progres baru untuk ditagihkan.',
      `Progres tersertifikasi terakhir sudah ${(Number(context.previouslyCertifiedPct) * 100).toFixed(2)}%.`,
    );
  }

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(paymentClaims)
      .values({
        projectId,
        paymentTermId: input.paymentTermId,
        periodId: input.periodId,
        claimNo,
        claimDate: input.claimDate,
        certifiedProgressPct: toPercentString(input.certifiedProgressPct),
        grossAmount: toMoneyString(breakdown.grossAmount),
        dpRecoupment: toMoneyString(breakdown.dpRecoupment),
        retentionWithheld: toMoneyString(breakdown.retentionWithheld),
        vatAmount: toMoneyString(breakdown.vatAmount),
        whtAmount: toMoneyString(breakdown.whtAmount),
        netAmount: toMoneyString(breakdown.netAmount),
        status: 'DRAFT',
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: paymentClaims.id });

    if (!created) throw conflict('Tagihan gagal dibuat.');

    await tx
      .update(paymentTerms)
      .set({ status: 'CLAIMED', updatedBy: user.id })
      .where(eq(paymentTerms.id, input.paymentTermId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'payment_claims',
      recordId: created.id,
      action: 'INSERT',
      after: { claimNo, net: breakdown.netAmount.toString() },
      actorId: user.id,
    });

    return { id: created.id };
  });
}

/**
 * Marks a claim paid and writes the money into the ledger, in one transaction.
 *
 * Same rule as posting a purchase: the document and the cash row are one event.
 * A claim recorded as paid with no matching receipt is a hole nobody finds
 * until a reconciliation months later.
 */
export async function payClaim(
  user: SessionUser,
  projectId: string,
  claimId: string,
  input: { accountId: string; paidAt: string },
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const [claim] = await db
    .select({
      id: paymentClaims.id,
      claimNo: paymentClaims.claimNo,
      netAmount: paymentClaims.netAmount,
      status: paymentClaims.status,
      paymentTermId: paymentClaims.paymentTermId,
    })
    .from(paymentClaims)
    .where(and(eq(paymentClaims.id, claimId), eq(paymentClaims.projectId, projectId)))
    .limit(1);

  if (!claim) throw notFound('Tagihan tidak ditemukan.');
  if (claim.status === 'PAID') throw conflict('Tagihan ini sudah tercatat lunas.');

  const [term] = await db
    .select({ termType: paymentTerms.termType })
    .from(paymentTerms)
    .where(eq(paymentTerms.id, claim.paymentTermId))
    .limit(1);

  const [account] = await db
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, input.accountId), eq(cashAccounts.projectId, projectId)))
    .limit(1);

  if (!account) throw validation('Akun kas tidak dikenal pada proyek ini.');

  const category: CashCategory =
    term?.termType === 'DOWN_PAYMENT'
      ? 'DOWN_PAYMENT'
      : term?.termType === 'RETENTION'
        ? 'RETENTION_RELEASE'
        : 'TERMIN';

  await withUser(user.id, async (tx) => {
    await tx
      .update(paymentClaims)
      .set({ status: 'PAID', paidAt: input.paidAt, updatedBy: user.id })
      .where(eq(paymentClaims.id, claimId));

    await tx
      .update(paymentTerms)
      .set({ status: 'PAID', updatedBy: user.id })
      .where(eq(paymentTerms.id, claim.paymentTermId));

    await tx.insert(cashTransactions).values({
      projectId,
      accountId: input.accountId,
      txnDate: input.paidAt,
      direction: 'IN',
      category,
      amount: claim.netAmount,
      sourceType: 'PAYMENT_CLAIM',
      sourceId: claimId,
      description: `Pembayaran tagihan ${claim.claimNo}`,
      createdBy: user.id,
      updatedBy: user.id,
    });

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'payment_claims',
      recordId: claimId,
      action: 'UPDATE',
      after: { status: 'PAID', amount: claim.netAmount },
      actorId: user.id,
    });
  });
}

// --- ledger -----------------------------------------------------------------

export async function recordCashTransaction(
  user: SessionUser,
  projectId: string,
  input: {
    accountId: string;
    txnDate: string;
    direction: CashDirection;
    category: CashCategory;
    amount: string;
    description: string | null;
  },
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  if (toDecimal(input.amount).lessThanOrEqualTo(0)) {
    throw validation('Nilai transaksi harus lebih besar dari nol.');
  }

  const [account] = await db
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, input.accountId), eq(cashAccounts.projectId, projectId)))
    .limit(1);

  if (!account) throw validation('Akun kas tidak dikenal pada proyek ini.');

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(cashTransactions)
      .values({
        projectId,
        accountId: input.accountId,
        txnDate: input.txnDate,
        direction: input.direction,
        category: input.category,
        amount: toMoneyString(input.amount),
        sourceType: 'MANUAL',
        description: input.description,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: cashTransactions.id });

    if (!created) throw conflict('Transaksi kas gagal dicatat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'cash_transactions',
      recordId: created.id,
      action: 'INSERT',
      after: input,
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function voidCashTransaction(
  user: SessionUser,
  projectId: string,
  transactionId: string,
  reason: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const trimmed = reason.trim();
  if (trimmed === '') throw validation('Alasan pembatalan wajib diisi.');

  const [row] = await db
    .select({ id: cashTransactions.id, sourceType: cashTransactions.sourceType })
    .from(cashTransactions)
    .where(
      and(eq(cashTransactions.id, transactionId), eq(cashTransactions.projectId, projectId)),
    )
    .limit(1);

  if (!row) throw notFound('Transaksi kas tidak ditemukan.');

  if (row.sourceType !== 'MANUAL') {
    throw conflict(
      'Transaksi ini berasal dari dokumen lain.',
      'Batalkan dokumen sumbernya — pembelian atau tagihan — agar keduanya tetap sejalan.',
    );
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(cashTransactions)
      .set({ isVoid: true, voidReason: trimmed, updatedBy: user.id })
      .where(eq(cashTransactions.id, transactionId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'cash_transactions',
      recordId: transactionId,
      action: 'UPDATE',
      after: { isVoid: true, reason: trimmed },
      actorId: user.id,
    });
  });
}

// --- cashflow ---------------------------------------------------------------

export type CashflowView = {
  periods: { id: string; seq: number; label: string; startDate: string; endDate: string }[];
  flow: {
    periodId: string;
    seq: number;
    label: string;
    inflow: string;
    outflow: string;
    net: string;
    opening: string;
    closing: string;
    byCategory: Record<string, string>;
    isDeficit: boolean;
  }[];
  deficits: { periodId: string; seq: number; label: string; shortfall: string }[];
  peak: { label: string; shortfall: string } | null;
  openingBalance: string;
  totals: { inflow: string; outflow: string; net: string };
  hasPeriods: boolean;
};

/**
 * Cash by period.
 *
 * Transactions are bucketed by the period whose date range contains them, which
 * is done in SQL so a project with thousands of rows does not ship them all to
 * the server to be sorted into buckets.
 */
export const getCashflow = cache(async function getCashflow(
  userId: string,
  projectId: string,
): Promise<CashflowView> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const periods = await db
    .select({
      id: schedulePeriods.id,
      seq: schedulePeriods.seq,
      label: schedulePeriods.label,
      startDate: schedulePeriods.startDate,
      endDate: schedulePeriods.endDate,
    })
    .from(schedulePeriods)
    .where(eq(schedulePeriods.projectId, projectId))
    .orderBy(asc(schedulePeriods.seq));

  const accounts = await db
    .select({ openingBalance: cashAccounts.openingBalance })
    .from(cashAccounts)
    .where(eq(cashAccounts.projectId, projectId));

  const openingBalance = accounts.reduce(
    (acc, account) => acc.plus(toDecimal(account.openingBalance)),
    toDecimal(0),
  );

  if (periods.length === 0) {
    return {
      periods: [],
      flow: [],
      deficits: [],
      peak: null,
      openingBalance: openingBalance.toString(),
      totals: { inflow: '0', outflow: '0', net: '0' },
      hasPeriods: false,
    };
  }

  const rows = await db
    .select({
      periodId: schedulePeriods.id,
      direction: cashTransactions.direction,
      category: cashTransactions.category,
      amount: cashTransactions.amount,
    })
    .from(cashTransactions)
    .innerJoin(
      schedulePeriods,
      and(
        eq(schedulePeriods.projectId, projectId),
        lte(schedulePeriods.startDate, cashTransactions.txnDate),
        lte(cashTransactions.txnDate, schedulePeriods.endDate),
      ),
    )
    .where(and(eq(cashTransactions.projectId, projectId), eq(cashTransactions.isVoid, false)));

  const flow: PeriodCashflow[] = cashflowByPeriod(
    periods,
    rows.map((row) => ({
      periodId: row.periodId,
      direction: row.direction,
      category: row.category,
      amount: row.amount,
    })),
    openingBalance,
  );

  const deficits: DeficitWarning[] = deficitWarnings(flow);
  const worst = peakFunding(flow);

  const totals = flow.reduce(
    (acc, period) => ({
      inflow: acc.inflow.plus(period.inflow),
      outflow: acc.outflow.plus(period.outflow),
    }),
    { inflow: toDecimal(0), outflow: toDecimal(0) },
  );

  return {
    periods,
    flow: flow.map((period) => ({
      periodId: period.periodId,
      seq: period.seq,
      label: period.label,
      inflow: period.inflow.toString(),
      outflow: period.outflow.toString(),
      net: period.net.toString(),
      opening: period.opening.toString(),
      closing: period.closing.toString(),
      byCategory: Object.fromEntries(
        Object.entries(period.byCategory).map(([key, value]) => [key, value.toString()]),
      ),
      isDeficit: period.isDeficit,
    })),
    deficits: deficits.map((warning) => ({
      periodId: warning.periodId,
      seq: warning.seq,
      label: warning.label,
      shortfall: warning.shortfall.toString(),
    })),
    peak: worst ? { label: worst.label, shortfall: worst.shortfall.toString() } : null,
    openingBalance: openingBalance.toString(),
    totals: {
      inflow: totals.inflow.toString(),
      outflow: totals.outflow.toString(),
      net: totals.inflow.minus(totals.outflow).toString(),
    },
    hasPeriods: true,
  };
});

// --- financial summary ------------------------------------------------------

export type FinancialSummary = {
  contractValue: string;
  totalRab: string;
  totalRap: string;
  actualCost: string;
  completionPct: string;
  variance: {
    earned: string;
    costVariance: string;
    cpi: string | null;
    estimateAtCompletion: string | null;
    status: CostVariance['status'];
  };
  margin: { planned: string; projected: string; projectedPercent: string | null };
  byCategory: { category: string; amount: string }[];
  showCosts: boolean;
};

/**
 * RAB against RAP against what was actually spent.
 *
 * Realised cost is read from the cash ledger rather than from purchase orders:
 * an order is an intention and a payment is a fact, and the charter's rule is
 * that every figure traces to something posted.
 */
export async function getFinancialSummary(
  userId: string,
  projectId: string,
): Promise<FinancialSummary> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [estimate, comparison, project] = await Promise.all([
    getProjectEstimate(userId, projectId),
    getProgressComparison(userId, projectId).catch(() => null),
    db
      .select({ contractValue: projects.contractValue })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  if (!project) throw notFound('Proyek tidak ditemukan.');

  const outflow = await db
    .select({
      category: cashTransactions.category,
      total: sql<string>`sum(${cashTransactions.amount})::text`,
    })
    .from(cashTransactions)
    .where(
      and(
        eq(cashTransactions.projectId, projectId),
        eq(cashTransactions.isVoid, false),
        eq(cashTransactions.direction, 'OUT'),
      ),
    )
    .groupBy(cashTransactions.category);

  const actualCost = OUTFLOW_IS_COST
    ? outflow.reduce((acc, row) => acc.plus(toDecimal(row.total)), toDecimal(0))
    : toDecimal(0);

  const completion = toDecimal(comparison?.current.actualCumulative ?? 0);
  const variance = costVariance(
    estimate.totals.totalRab,
    estimate.totals.totalRap,
    actualCost,
    completion,
  );

  const plannedMargin = toDecimal(estimate.totals.totalRab).minus(
    toDecimal(estimate.totals.totalRap),
  );
  const projected = projectedMargin(
    estimate.totals.totalRab,
    variance.estimateAtCompletion === null ? null : variance.estimateAtCompletion,
  );

  return {
    contractValue: project.contractValue,
    totalRab: estimate.totals.totalRab,
    totalRap: estimate.totals.totalRap,
    actualCost: actualCost.toString(),
    completionPct: completion.toString(),
    variance: {
      earned: variance.earned.toString(),
      costVariance: variance.costVariance.toString(),
      cpi: variance.cpi === null ? null : variance.cpi.toString(),
      estimateAtCompletion:
        variance.estimateAtCompletion === null ? null : variance.estimateAtCompletion.toString(),
      status: variance.status,
    },
    margin: {
      planned: plannedMargin.toString(),
      projected: projected.amount.toString(),
      projectedPercent: projected.percent === null ? null : projected.percent.toString(),
    },
    byCategory: outflow.map((row) => ({ category: row.category, amount: row.total })),
    showCosts: estimate.showCosts,
  };
}

// --- capital planning -------------------------------------------------------

export type CapitalPlan = {
  earnedValue: EarnedValueStrings;
  /** Budget at completion, which is total RAP. */
  budgetAtCompletion: string;
  plannedCumulative: string;
  actualCumulative: string;
  costVerdict: PerformanceVerdict;
  scheduleVerdict: PerformanceVerdict;
  simulation: {
    targetWeight: string;
    currentWeight: string;
    gap: string;
    totalRab: string;
    totalRap: string;
    achievable: boolean;
    reachableWeight: string;
    rows: {
      workItemId: string;
      code: string;
      name: string;
      weight: string;
      completed: string;
      requiredFraction: string;
      weightGained: string;
      costRab: string;
      costRap: string;
      isPartial: boolean;
    }[];
  };
  showCosts: boolean;
};

/**
 * Earned value analysis, and what it would cost to reach a progress target.
 *
 * Both answer the same underlying question from different ends: where the
 * project stands against its budget, and what the next stretch of it requires
 * in cash.
 */
export async function getCapitalPlan(
  userId: string,
  projectId: string,
  targetWeight: string,
): Promise<CapitalPlan> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [estimate, overview, comparison, summary] = await Promise.all([
    getProjectEstimate(userId, projectId),
    getScheduleOverview(userId, projectId),
    getProgressComparison(userId, projectId).catch(() => null),
    getFinancialSummary(userId, projectId),
  ]);

  const approved = await db
    .select({
      workItemId: progressEntries.workItemId,
      periodId: progressEntries.periodId,
      pctThisPeriod: progressEntries.pctThisPeriod,
    })
    .from(progressEntries)
    .where(
      and(eq(progressEntries.projectId, projectId), eq(progressEntries.status, 'APPROVED')),
    );

  const completion = new Map(
    completionByItem(
      approved,
      estimate.items.map((item) => item.workItemId),
    ).map((row) => [row.workItemId, row.completion]),
  );

  /*
   * Plan order: the first period each item is scheduled to be worked in.
   *
   * Items with no plan sort last rather than first — an unscheduled item is
   * the least certain thing to promise, and putting it at the head of a cash
   * forecast would be the wrong kind of optimism.
   */
  const seqOf = new Map(overview.periods.map((period) => [period.id, period.seq]));
  const firstPeriod = new Map<string, number>();
  for (const cell of overview.effectivePlan) {
    const seq = seqOf.get(cell.periodId);
    if (seq === undefined) continue;
    const current = firstPeriod.get(cell.workItemId);
    if (current === undefined || seq < current) firstPeriod.set(cell.workItemId, seq);
  }

  const UNSCHEDULED = Number.MAX_SAFE_INTEGER;

  const simulation = simulateCapitalNeed(
    estimate.items.map((item) => ({
      workItemId: item.workItemId,
      code: item.code,
      name: item.name,
      weight: item.includeInProgressWeight ? item.weight : '0',
      totalRab: item.totalRab,
      totalRap: item.totalRap,
      completed: (completion.get(item.workItemId) ?? toDecimal(0)).toString(),
      order: firstPeriod.get(item.workItemId) ?? UNSCHEDULED,
    })),
    targetWeight,
  );

  const plannedCumulative = toDecimal(comparison?.current.plannedCumulative ?? 0);
  const actualCumulative = toDecimal(comparison?.current.actualCumulative ?? 0);

  const value = earnedValue({
    budgetAtCompletion: estimate.totals.totalRap,
    plannedCumulativePct: plannedCumulative,
    actualCumulativePct: actualCumulative,
    actualCost: summary.actualCost,
  });

  return {
    earnedValue: toEarnedValueStrings(value),
    budgetAtCompletion: estimate.totals.totalRap,
    plannedCumulative: plannedCumulative.toString(),
    actualCumulative: actualCumulative.toString(),
    costVerdict: performanceVerdict(value.cpi),
    scheduleVerdict: performanceVerdict(value.spi),
    simulation: {
      targetWeight: simulation.targetWeight.toString(),
      currentWeight: simulation.currentWeight.toString(),
      gap: simulation.gap.toString(),
      totalRab: simulation.totalRab.toString(),
      totalRap: simulation.totalRap.toString(),
      achievable: simulation.achievable,
      reachableWeight: simulation.reachableWeight.toString(),
      rows: simulation.rows.map((row) => ({
        workItemId: row.workItemId,
        code: row.code,
        name: row.name,
        weight: row.weight.toString(),
        completed: row.completed.toString(),
        requiredFraction: row.requiredFraction.toString(),
        weightGained: row.weightGained.toString(),
        costRab: row.costRab.toString(),
        costRap: row.costRap.toString(),
        isPartial: row.isPartial,
      })),
    },
    showCosts: estimate.showCosts,
  };
}

/** Everything the executive dashboard needs, in one pass. */
export async function getExecutiveSummary(userId: string, projectId: string) {
  const [schedule, progress, cash, financial] = await Promise.all([
    getScheduleOverview(userId, projectId),
    getProgressComparison(userId, projectId),
    getCashflow(userId, projectId),
    getFinancialSummary(userId, projectId),
  ]);

  /*
   * EVA is assembled here rather than fetched: every input is already loaded,
   * and the dashboard's indices must be the same numbers the capital page
   * shows. Both go through `earnedValue`, so they cannot drift apart.
   */
  const value = earnedValue({
    budgetAtCompletion: financial.totalRap,
    plannedCumulativePct: progress.current.plannedCumulative,
    actualCumulativePct: progress.current.actualCumulative,
    actualCost: financial.actualCost,
  });

  return {
    schedule,
    progress,
    cash,
    financial,
    earnedValue: {
      ...toEarnedValueStrings(value),
      costVerdict: performanceVerdict(value.cpi),
      scheduleVerdict: performanceVerdict(value.spi),
    },
  };
}
