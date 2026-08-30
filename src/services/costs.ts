import { and, eq, sql } from 'drizzle-orm';

import { withUser } from '@/db/context';
import { actualCosts } from '@/db/schema';
import { safeDivide, toDecimal, ZERO } from '@/lib/calc/decimal';
import { conflict } from '@/lib/errors';
import { type ActualCostFormValues } from '@/lib/validation/costs';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { canViewOrgCosts } from './org-access';
import { type SessionUser } from './session';

/**
 * Cost control at the level of a work item.
 *
 * The project already knew what it had spent in total, from the cash ledger.
 * What it could not say was which item the money went to — the difference
 * between "we are over budget" and "we are over budget on the roof", and only
 * the second one can be acted on.
 *
 * Three figures per item, and they answer different questions:
 *
 *   RAB     what the item was sold for
 *   RAP     what it was planned to cost
 *   Aktual  what has actually been spent on it so far
 *
 * Comparing actual against RAP directly would call every unfinished item a
 * saving, so the comparison is made against the part of the plan that has
 * actually been earned: RAP x completion. That is CPI, and it is the only one
 * of the three that means anything mid-project.
 */

export type CostControlRow = {
  workItemId: string;
  code: string;
  name: string;
  unitCode: string;
  volume: string;
  /** Approved completion, 0..1. */
  completion: string;
  totalRab: string;
  totalRap: string;
  actual: string;
  actualIssued: string;
  actualBooked: string;
  /** RAP x completion — the budget for the work actually done. */
  earned: string;
  /** earned − actual. Negative means it cost more than it was worth. */
  variance: string;
  /** earned / actual. Null while nothing has been spent. */
  cpi: string | null;
  /** actual / completion — what the whole item looks likely to cost. */
  forecast: string | null;
};

export type CostControl = {
  rows: CostControlRow[];
  totals: {
    totalRab: string;
    totalRap: string;
    actual: string;
    earned: string;
    variance: string;
    cpi: string | null;
  };
  showCosts: boolean;
};

type RawRow = {
  work_item_id: string;
  code: string;
  name: string;
  unit_code: string;
  volume: string;
  completion: string;
  total_rab: string;
  total_rap: string;
  actual_issued: string;
  actual_booked: string;
};

/**
 * One query.
 *
 * Every figure here already exists in a view or a table; what was missing was
 * putting them beside each other. Fetching them separately would be four round
 * trips for one screen, which against a database in another region is most of
 * what the page costs.
 */
export async function getCostControl(userId: string, projectId: string): Promise<CostControl> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);

  if (!showCosts) {
    return {
      rows: [],
      totals: { totalRab: '0', totalRap: '0', actual: '0', earned: '0', variance: '0', cpi: null },
      showCosts,
    };
  }

  const rows = await withUser(userId, (tx) =>
    tx.execute<RawRow>(sql`
      WITH done AS (
        SELECT work_item_id, sum(pct_this_period) AS completion
        FROM progress_entries
        WHERE project_id = ${projectId} AND status = 'APPROVED'
        GROUP BY work_item_id
      ),
      spent AS (
        SELECT
          work_item_id,
          coalesce(sum(amount) FILTER (WHERE source = 'ISSUE'), 0)  AS issued,
          coalesce(sum(amount) FILTER (WHERE source = 'BOOKED'), 0) AS booked
        FROM v_work_item_actual_cost
        WHERE project_id = ${projectId} AND work_item_id IS NOT NULL
        GROUP BY work_item_id
      )
      SELECT
        c.work_item_id,
        c.code,
        c.name,
        u.code                          AS unit_code,
        c.volume::text                  AS volume,
        coalesce(d.completion, 0)::text AS completion,
        c.total_rab::text               AS total_rab,
        c.total_rap::text               AS total_rap,
        coalesce(s.issued, 0)::text     AS actual_issued,
        coalesce(s.booked, 0)::text     AS actual_booked
      FROM v_work_item_cost c
      JOIN work_items wi ON wi.id = c.work_item_id
      JOIN units u       ON u.id = wi.unit_id
      LEFT JOIN done  d ON d.work_item_id = c.work_item_id
      LEFT JOIN spent s ON s.work_item_id = c.work_item_id
      WHERE c.project_id = ${projectId} AND c.is_active
      ORDER BY wi.sort_order, c.code
    `),
  );

  let sumRab = ZERO;
  let sumRap = ZERO;
  let sumActual = ZERO;
  let sumEarned = ZERO;

  const mapped = rows.map((row): CostControlRow => {
    const completion = toDecimal(row.completion);
    const totalRap = toDecimal(row.total_rap);
    const issued = toDecimal(row.actual_issued);
    const booked = toDecimal(row.actual_booked);
    const actual = issued.plus(booked);
    const earned = totalRap.times(completion);
    const variance = earned.minus(actual);

    sumRab = sumRab.plus(row.total_rab);
    sumRap = sumRap.plus(totalRap);
    sumActual = sumActual.plus(actual);
    sumEarned = sumEarned.plus(earned);

    return {
      workItemId: row.work_item_id,
      code: row.code,
      name: row.name,
      unitCode: row.unit_code,
      volume: row.volume,
      completion: completion.toString(),
      totalRab: toDecimal(row.total_rab).toFixed(2),
      totalRap: totalRap.toFixed(2),
      actual: actual.toFixed(2),
      actualIssued: issued.toFixed(2),
      actualBooked: booked.toFixed(2),
      earned: earned.toFixed(2),
      variance: variance.toFixed(2),
      // Nothing spent is not a perfect score; it is no score.
      cpi: actual.isZero() ? null : safeDivide(earned, actual)?.toFixed(4) ?? null,
      // Nothing done cannot be extrapolated from.
      forecast: completion.isZero() ? null : safeDivide(actual, completion)?.toFixed(2) ?? null,
    };
  });

  return {
    rows: mapped,
    totals: {
      totalRab: sumRab.toFixed(2),
      totalRap: sumRap.toFixed(2),
      actual: sumActual.toFixed(2),
      earned: sumEarned.toFixed(2),
      variance: sumEarned.minus(sumActual).toFixed(2),
      cpi: sumActual.isZero() ? null : safeDivide(sumEarned, sumActual)?.toFixed(4) ?? null,
    },
    showCosts,
  };
}

export type PurchasedVsUsedRow = {
  resourceId: string;
  code: string;
  name: string;
  unitCode: string;
  qtyIn: string;
  qtyOut: string;
  qtyRemaining: string;
  valueIn: string;
  valueOut: string;
  /** valueIn / qtyIn — what the material has averaged, not what it was quoted. */
  avgPriceIn: string | null;
  /** qtyOut / qtyIn. Null when nothing has been received. */
  usedFraction: string | null;
};

/**
 * Bought against installed.
 *
 * The gap is not waste by itself — material bought early and not yet fitted is
 * stock, not loss. It becomes a question when the gap stops closing, which is
 * why the fraction is shown rather than only the difference.
 */
export async function getPurchasedVsUsed(
  userId: string,
  projectId: string,
): Promise<{ rows: PurchasedVsUsedRow[]; showCosts: boolean }> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);
  if (!showCosts) return { rows: [], showCosts };

  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      resource_id: string;
      code: string;
      name: string;
      unit_code: string;
      qty_in: string;
      qty_out: string;
      value_in: string;
      value_out: string;
    }>(sql`
      SELECT
        r.id                                    AS resource_id,
        r.code,
        r.name,
        u.code                                  AS unit_code,
        coalesce(sum(mt.qty) FILTER (WHERE mt.txn_type = 'IN'), 0)::text  AS qty_in,
        coalesce(sum(mt.qty) FILTER (WHERE mt.txn_type = 'OUT'), 0)::text AS qty_out,
        coalesce(sum(mt.qty * coalesce(mt.unit_cost, 0))
          FILTER (WHERE mt.txn_type = 'IN'), 0)::text                     AS value_in,
        coalesce(sum(mt.qty * coalesce(mt.unit_cost, 0))
          FILTER (WHERE mt.txn_type = 'OUT'), 0)::text                    AS value_out
      FROM material_transactions mt
      JOIN resources r ON r.id = mt.resource_id
      JOIN units u     ON u.id = r.unit_id
      WHERE mt.project_id = ${projectId} AND NOT mt.is_void
      GROUP BY r.id, r.code, r.name, u.code
      HAVING coalesce(sum(mt.qty) FILTER (WHERE mt.txn_type = 'IN'), 0) <> 0
          OR coalesce(sum(mt.qty) FILTER (WHERE mt.txn_type = 'OUT'), 0) <> 0
      ORDER BY r.code
    `),
  );

  return {
    showCosts,
    rows: rows.map((row) => {
      const qtyIn = toDecimal(row.qty_in);
      const qtyOut = toDecimal(row.qty_out);
      const valueIn = toDecimal(row.value_in);

      return {
        resourceId: row.resource_id,
        code: row.code,
        name: row.name,
        unitCode: row.unit_code,
        qtyIn: qtyIn.toFixed(4),
        qtyOut: qtyOut.toFixed(4),
        qtyRemaining: qtyIn.minus(qtyOut).toFixed(4),
        valueIn: valueIn.toFixed(2),
        valueOut: toDecimal(row.value_out).toFixed(2),
        avgPriceIn: qtyIn.isZero() ? null : safeDivide(valueIn, qtyIn)?.toFixed(2) ?? null,
        usedFraction: qtyIn.isZero() ? null : safeDivide(qtyOut, qtyIn)?.toFixed(4) ?? null,
      };
    }),
  };
}

export type ActualCostRow = {
  id: string;
  costDate: string;
  workItemId: string | null;
  workItemCode: string | null;
  workItemName: string | null;
  category: string;
  qty: string | null;
  unitCost: string | null;
  amount: string;
  sourceRef: string | null;
  note: string | null;
};

export async function listActualCosts(userId: string, projectId: string): Promise<ActualCostRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      id: string;
      cost_date: string;
      work_item_id: string | null;
      work_item_code: string | null;
      work_item_name: string | null;
      category: string;
      qty: string | null;
      unit_cost: string | null;
      amount: string;
      source_ref: string | null;
      note: string | null;
    }>(sql`
      SELECT ac.id, ac.cost_date::text, ac.work_item_id,
             wi.code AS work_item_code, wi.name AS work_item_name,
             ac.category, ac.qty::text, ac.unit_cost::text, ac.amount::text,
             ac.source_ref, ac.note
      FROM actual_costs ac
      LEFT JOIN work_items wi ON wi.id = ac.work_item_id
      WHERE ac.project_id = ${projectId}
      ORDER BY ac.cost_date DESC, ac.created_at DESC
      LIMIT 500
    `),
  );

  return rows.map((row) => ({
    id: row.id,
    costDate: row.cost_date,
    workItemId: row.work_item_id,
    workItemCode: row.work_item_code,
    workItemName: row.work_item_name,
    category: row.category,
    qty: row.qty,
    unitCost: row.unit_cost,
    amount: row.amount,
    sourceRef: row.source_ref,
    note: row.note,
  }));
}

export async function saveActualCost(
  user: SessionUser,
  projectId: string,
  costId: string | null,
  values: ActualCostFormValues,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  /*
   * Amount is taken as given when it is given, and derived otherwise.
   *
   * A day's labour is often known only as a total; plant hire is known as rate
   * times days. Insisting on one shape would make somebody multiply in their
   * head and type the answer, which is where arithmetic errors enter a ledger.
   */
  const amount =
    values.amount !== null
      ? toDecimal(values.amount)
      : values.qty !== null && values.unitCost !== null
        ? toDecimal(values.qty).times(toDecimal(values.unitCost))
        : null;

  if (amount === null) {
    throw conflict(
      'Jumlah biaya belum dapat dihitung.',
      'Isi nilainya langsung, atau isi kuantitas dan harga satuannya.',
    );
  }

  return withUser(user.id, async (tx) => {
    const payload = {
      projectId,
      workItemId: values.workItemId === '' ? null : values.workItemId,
      resourceId: values.resourceId === '' ? null : values.resourceId,
      category: values.category,
      costDate: values.costDate,
      qty: values.qty,
      unitCost: values.unitCost,
      amount: amount.toFixed(2),
      sourceRef: values.sourceRef,
      note: values.note,
      updatedBy: user.id,
    };

    let id = costId;
    if (id === null) {
      const [created] = await tx
        .insert(actualCosts)
        .values({ ...payload, createdBy: user.id })
        .returning({ id: actualCosts.id });
      if (!created) throw conflict('Biaya gagal disimpan.');
      id = created.id;
    } else {
      await tx
        .update(actualCosts)
        .set(payload)
        .where(and(eq(actualCosts.id, id), eq(actualCosts.projectId, projectId)));
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'actual_costs',
      recordId: id,
      action: costId === null ? 'INSERT' : 'UPDATE',
      before: null,
      after: { amount: payload.amount, category: payload.category },
      actorId: user.id,
    });

    return { id };
  });
}

export async function deleteActualCost(
  user: SessionUser,
  projectId: string,
  costId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  await withUser(user.id, async (tx) => {
    await tx
      .delete(actualCosts)
      .where(and(eq(actualCosts.id, costId), eq(actualCosts.projectId, projectId)));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'actual_costs',
      recordId: costId,
      action: 'DELETE',
      before: null,
      after: null,
      actorId: user.id,
    });
  });
}
