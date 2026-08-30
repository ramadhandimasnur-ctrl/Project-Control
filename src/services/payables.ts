import { sql } from 'drizzle-orm';

import { withUser } from '@/db/context';
import { toDecimal, ZERO } from '@/lib/calc/decimal';
import { todayIso } from '@/lib/date';

import { assertProjectAccess } from './access';
import { canViewOrgCosts } from './org-access';

/**
 * What the project owes, gathered from the documents that owe it.
 *
 * The obligations already exist — a posted purchase, an approved certificate —
 * but they lived on separate screens, so the question a cash forecast starts
 * from could not be asked: what falls due next month, across all of it.
 *
 * Nothing is stored. Excel kept a payables table written alongside every
 * document, which is two records of one debt and a standing chance of them
 * disagreeing; the documents are the record, and this only reads them.
 */

export type PayableRow = {
  sourceId: string;
  sourceType: 'PURCHASE' | 'SUBCONTRACT';
  reference: string | null;
  counterparty: string | null;
  issuedOn: string;
  dueDate: string | null;
  amountDue: string;
  paidAt: string | null;
  /** Days until due. Negative is overdue; null when no date was agreed. */
  daysUntilDue: number | null;
  bucket: 'PAID' | 'OVERDUE' | 'DUE_SOON' | 'SCHEDULED' | 'UNDATED';
};

export type PayablesSummary = {
  rows: PayableRow[];
  totals: {
    outstanding: string;
    overdue: string;
    dueWithin30: string;
    paid: string;
  };
  showCosts: boolean;
};

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export async function getPayables(
  userId: string,
  projectId: string,
  options: { today?: string } = {},
): Promise<PayablesSummary> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);

  if (!showCosts) {
    return {
      rows: [],
      totals: { outstanding: '0.00', overdue: '0.00', dueWithin30: '0.00', paid: '0.00' },
      showCosts,
    };
  }

  const today = options.today ?? todayIso();

  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      source_id: string;
      source_type: 'PURCHASE' | 'SUBCONTRACT';
      reference: string | null;
      counterparty: string | null;
      issued_on: string;
      due_date: string | null;
      amount_due: string;
      paid_at: string | null;
    }>(sql`
      SELECT source_id, source_type, reference, counterparty,
             issued_on::text, due_date::text, amount_due::text, paid_at::text
      FROM v_payables
      WHERE project_id = ${projectId}
      ORDER BY paid_at NULLS FIRST, due_date NULLS LAST, issued_on
    `),
  );

  let outstanding = ZERO;
  let overdue = ZERO;
  let dueWithin30 = ZERO;
  let paid = ZERO;

  const mapped = rows.map((row): PayableRow => {
    const amount = toDecimal(row.amount_due);
    const settled = row.paid_at !== null;
    const daysUntilDue = row.due_date === null ? null : daysBetween(today, row.due_date);

    /*
     * Paid is checked before dated, deliberately. An invoice settled after its
     * due date is history, not a debt, and colouring it red for ever would
     * bury the ones that still need attention.
     */
    const bucket: PayableRow['bucket'] = settled
      ? 'PAID'
      : daysUntilDue === null
        ? 'UNDATED'
        : daysUntilDue < 0
          ? 'OVERDUE'
          : daysUntilDue <= 30
            ? 'DUE_SOON'
            : 'SCHEDULED';

    if (settled) paid = paid.plus(amount);
    else {
      outstanding = outstanding.plus(amount);
      if (bucket === 'OVERDUE') overdue = overdue.plus(amount);
      if (bucket === 'DUE_SOON') dueWithin30 = dueWithin30.plus(amount);
    }

    return {
      sourceId: row.source_id,
      sourceType: row.source_type,
      reference: row.reference,
      counterparty: row.counterparty,
      issuedOn: row.issued_on,
      dueDate: row.due_date,
      amountDue: amount.toFixed(2),
      // Trimmed to a day: the time of payment is noise on a payables list.
      paidAt: row.paid_at === null ? null : row.paid_at.slice(0, 10),
      daysUntilDue,
      bucket,
    };
  });

  return {
    rows: mapped,
    totals: {
      outstanding: outstanding.toFixed(2),
      overdue: overdue.toFixed(2),
      dueWithin30: dueWithin30.toFixed(2),
      paid: paid.toFixed(2),
    },
    showCosts,
  };
}
