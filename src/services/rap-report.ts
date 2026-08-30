import { sql } from 'drizzle-orm';

import { withUser } from '@/db/context';
import { safeDivide, toDecimal, ZERO } from '@/lib/calc/decimal';
import { notFound } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { canViewOrgCosts } from './org-access';

/**
 * The operational report — what a period actually cost, and to whom.
 *
 * Separate from the opname sheet on purpose. Opname is a contract document:
 * it reports progress against RAB, it is signed, and it is what the owner is
 * billed from. This one is for the people running the site, and it answers a
 * different question — where the money went this period, split the way money
 * is actually spent: material out of store, foremen certified, and everything
 * else booked by hand.
 *
 * Both read the same records. What differs is which side of the contract they
 * are written for, and mixing the two on one sheet produced a document that
 * neither the owner nor the site manager could use.
 */

export type RapReportSection = {
  label: string;
  rows: {
    reference: string;
    description: string;
    qty: string | null;
    unitCode: string | null;
    amount: string;
  }[];
  total: string;
};

export type RapReport = {
  period: { id: string; label: string; startDate: string; endDate: string };
  progress: {
    /** Approved share of the whole project earned in this period. */
    weightThisPeriod: string;
    itemsWorked: number;
  };
  material: RapReportSection;
  subcontract: RapReportSection;
  booked: RapReportSection;
  advances: RapReportSection;
  totals: {
    spentThisPeriod: string;
    /** RAP for the work approved this period — what it was budgeted to cost. */
    earnedThisPeriod: string;
    variance: string;
    /** earned / spent. Null until something has been spent. */
    ratio: string | null;
  };
  showCosts: boolean;
};

const sum = (rows: { amount: string }[]): string =>
  rows.reduce((acc, row) => acc.plus(toDecimal(row.amount)), ZERO).toFixed(2);

export async function getRapReport(
  userId: string,
  projectId: string,
  periodId: string,
): Promise<RapReport> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);

  const [period] = await withUser(userId, (tx) =>
    tx.execute<{ id: string; label: string; start_date: string; end_date: string }>(sql`
      SELECT id, label, start_date::text, end_date::text
      FROM schedule_periods WHERE id = ${periodId} AND project_id = ${projectId}
    `),
  );

  if (!period) throw notFound('Periode tidak ditemukan pada proyek ini.');

  const empty: RapReportSection = { label: '', rows: [], total: '0.00' };
  const header = {
    period: {
      id: period.id,
      label: period.label,
      startDate: period.start_date,
      endDate: period.end_date,
    },
  };

  if (!showCosts) {
    return {
      ...header,
      progress: { weightThisPeriod: '0', itemsWorked: 0 },
      material: { ...empty, label: 'Material keluar gudang' },
      subcontract: { ...empty, label: 'Sertifikat borongan' },
      booked: { ...empty, label: 'Biaya dicatat langsung' },
      advances: { ...empty, label: 'Kasbon dibayar' },
      totals: {
        spentThisPeriod: '0.00',
        earnedThisPeriod: '0.00',
        variance: '0.00',
        ratio: null,
      },
      showCosts,
    };
  }

  /*
   * Four ledgers and the progress line, in one round trip.
   *
   * Every section is bounded by the period's dates rather than by a period id,
   * because only progress carries one — material leaves the store on a date,
   * and a certificate is dated, not filed under a week.
   */
  const [material, subcontract, booked, advances, progress] = await Promise.all([
    withUser(userId, (tx) =>
      tx.execute<{
        reference: string;
        description: string;
        qty: string;
        unit_code: string;
        amount: string;
      }>(sql`
        SELECT
          coalesce(wi.code, '—')                    AS reference,
          r.name                                    AS description,
          sum(mt.qty)::text                         AS qty,
          u.code                                    AS unit_code,
          sum(mt.qty * coalesce(mt.unit_cost, 0))::text AS amount
        FROM material_transactions mt
        JOIN resources r ON r.id = mt.resource_id
        JOIN units u     ON u.id = r.unit_id
        LEFT JOIN work_items wi ON wi.id = mt.work_item_id
        WHERE mt.project_id = ${projectId}
          AND mt.txn_type = 'OUT' AND NOT mt.is_void
          AND mt.txn_date BETWEEN ${period.start_date} AND ${period.end_date}
        GROUP BY wi.code, r.name, u.code
        ORDER BY wi.code NULLS LAST, r.name
      `),
    ),
    withUser(userId, (tx) =>
      tx.execute<{ reference: string; description: string; amount: string }>(sql`
        SELECT c.cert_no AS reference, s.party_name AS description, c.progress_value::text AS amount
        FROM subcontract_certificates c
        JOIN subcontracts s ON s.id = c.subcontract_id
        WHERE s.project_id = ${projectId}
          AND c.status <> 'DRAFT'
          AND c.cert_date BETWEEN ${period.start_date} AND ${period.end_date}
        ORDER BY c.cert_date, c.cert_no
      `),
    ),
    withUser(userId, (tx) =>
      tx.execute<{ reference: string; description: string; amount: string }>(sql`
        SELECT
          coalesce(wi.code, '—')                             AS reference,
          coalesce(ac.source_ref, ac.note, ac.category::text) AS description,
          ac.amount::text                                     AS amount
        FROM actual_costs ac
        LEFT JOIN work_items wi ON wi.id = ac.work_item_id
        WHERE ac.project_id = ${projectId}
          AND ac.subcontract_certificate_id IS NULL
          AND ac.cost_date BETWEEN ${period.start_date} AND ${period.end_date}
        ORDER BY ac.cost_date
      `),
    ),
    withUser(userId, (tx) =>
      tx.execute<{ reference: string; description: string; amount: string }>(sql`
        SELECT
          to_char(a.advance_date, 'DD-MM-YYYY') AS reference,
          s.party_name                          AS description,
          a.amount::text                        AS amount
        FROM subcontract_advances a
        JOIN subcontracts s ON s.id = a.subcontract_id
        WHERE s.project_id = ${projectId}
          AND a.advance_date BETWEEN ${period.start_date} AND ${period.end_date}
        ORDER BY a.advance_date
      `),
    ),
    withUser(userId, (tx) =>
      tx.execute<{ weight: string; items: number }>(sql`
        SELECT
          coalesce(sum(pe.pct_this_period * coalesce(wc.total_rap, 0)), 0)::text AS weight,
          count(DISTINCT pe.work_item_id)::int                                   AS items
        FROM progress_entries pe
        LEFT JOIN v_work_item_cost wc ON wc.work_item_id = pe.work_item_id
        WHERE pe.project_id = ${projectId}
          AND pe.period_id = ${periodId}
          AND pe.status = 'APPROVED'
      `),
    ),
  ]);

  const materialRows = material.map((row) => ({
    reference: row.reference,
    description: row.description,
    qty: toDecimal(row.qty).toFixed(4),
    unitCode: row.unit_code,
    amount: toDecimal(row.amount).toFixed(2),
  }));

  const plain = (rows: { reference: string; description: string; amount: string }[]) =>
    rows.map((row) => ({
      reference: row.reference,
      description: row.description,
      qty: null,
      unitCode: null,
      amount: toDecimal(row.amount).toFixed(2),
    }));

  const subcontractRows = plain(subcontract);
  const bookedRows = plain(booked);
  const advanceRows = plain(advances);

  /*
   * Advances are not a cost. They are money moved to a foreman before any of
   * it was measured, and it becomes cost when a certificate says so. Listing
   * them and leaving them out of the total is the whole point — a site manager
   * needs to see the cash going out without it double-counting against the
   * certificate that later recovers it.
   */
  const spent = toDecimal(sum(materialRows))
    .plus(toDecimal(sum(subcontractRows)))
    .plus(toDecimal(sum(bookedRows)));

  const earned = toDecimal(progress[0]?.weight ?? '0');

  return {
    ...header,
    progress: {
      weightThisPeriod: earned.toFixed(2),
      itemsWorked: progress[0]?.items ?? 0,
    },
    material: { label: 'Material keluar gudang', rows: materialRows, total: sum(materialRows) },
    subcontract: {
      label: 'Sertifikat borongan',
      rows: subcontractRows,
      total: sum(subcontractRows),
    },
    booked: { label: 'Biaya dicatat langsung', rows: bookedRows, total: sum(bookedRows) },
    advances: { label: 'Kasbon dibayar', rows: advanceRows, total: sum(advanceRows) },
    totals: {
      spentThisPeriod: spent.toFixed(2),
      earnedThisPeriod: earned.toFixed(2),
      variance: earned.minus(spent).toFixed(2),
      ratio: spent.isZero() ? null : (safeDivide(earned, spent)?.toFixed(4) ?? null),
    },
    showCosts,
  };
}
