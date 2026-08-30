import { sql } from 'drizzle-orm';

import { withUser } from '@/db/context';
import { toDecimal } from '@/lib/calc/decimal';
import { addDays, todayIso } from '@/lib/date';

import { assertProjectAccess } from './access';
import { canViewOrgCosts } from './org-access';

/**
 * When each material has to be ordered, not only how much of it.
 *
 * The material schedule already answers "how much is still needed". What it
 * could not answer is the question that actually stops a site: by when does
 * somebody have to place the order. That is the planned start of the earliest
 * work item consuming the material, less the supplier's lead time, less
 * whatever margin the project wants to keep.
 *
 * A resource with no scheduled work has no order date, and says so rather than
 * being given today's date — a made-up deadline is worse than an admitted gap,
 * because it looks like an answer.
 */

export type ProcurementPlanRow = {
  resourceId: string;
  code: string;
  name: string;
  unitCode: string;
  leadTimeDays: number;
  /** Still to buy: requirement less what has already been purchased. */
  outstanding: string;
  /** Earliest planned start among the work items that consume it. */
  neededBy: string | null;
  /** neededBy − lead time − buffer. Null when nothing using it is scheduled. */
  orderBy: string | null;
  /** Days from today until the order date. Negative means it is already late. */
  daysUntilOrder: number | null;
  urgency: 'LATE' | 'SOON' | 'PLANNED' | 'UNSCHEDULED';
  estimatedValue: string | null;
};

export type ProcurementPlan = {
  rows: ProcurementPlanRow[];
  bufferDays: number;
  showCosts: boolean;
};

/** Whole days between two ISO days, positive when `to` is later. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/*
 * Seven days of margin unless the caller says otherwise.
 *
 * Not zero: an order placed exactly on the calculated day leaves no room for a
 * supplier who answers late, and the whole point of the column is to be warned
 * before it is too late rather than exactly as it becomes too late.
 */
const DEFAULT_BUFFER_DAYS = 7;

export async function getProcurementPlan(
  userId: string,
  projectId: string,
  options: { bufferDays?: number; today?: string } = {},
): Promise<ProcurementPlan> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);

  const bufferDays = Math.min(Math.max(options.bufferDays ?? DEFAULT_BUFFER_DAYS, 0), 365);
  const today = options.today ?? todayIso();

  /*
   * Requirement, purchases and the earliest planned start, in one query.
   *
   * The requirement comes from the same view the material schedule reads, so
   * the two screens cannot disagree about how much is needed — including for
   * lines whose quantity was typed rather than derived from a coefficient.
   */
  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      resource_id: string;
      code: string;
      name: string;
      unit_code: string;
      lead_time_days: number;
      required: string;
      purchased: string;
      needed_by: string | null;
      price_rap: string | null;
    }>(sql`
      WITH need AS (
        SELECT resource_id, resource_code, resource_name, unit_code,
               sum(qty_required) AS required,
               max(price_rap)    AS price_rap
        FROM v_material_requirement
        WHERE project_id = ${projectId}
        GROUP BY resource_id, resource_code, resource_name, unit_code
      ),
      bought AS (
        SELECT resource_id, coalesce(sum(qty), 0) AS purchased
        FROM material_transactions
        WHERE project_id = ${projectId} AND txn_type = 'IN' AND NOT is_void
        GROUP BY resource_id
      ),
      -- The earliest scheduled start among the items that consume it. Only the
      -- execution analysis: budget lines describe what was priced, not what
      -- will be bought.
      starts AS (
        SELECT wir.resource_id, min(ws.planned_start) AS needed_by
        FROM work_item_resources wir
        JOIN work_items wi ON wi.id = wir.work_item_id AND wi.is_active
        JOIN work_item_schedules ws ON ws.work_item_id = wi.id
        WHERE wi.project_id = ${projectId} AND wir.estimate_type = 'RAP'
        GROUP BY wir.resource_id
      )
      SELECT
        n.resource_id,
        n.resource_code                    AS code,
        n.resource_name                    AS name,
        n.unit_code,
        coalesce(r.lead_time_days, 0)      AS lead_time_days,
        n.required::text                   AS required,
        coalesce(b.purchased, 0)::text     AS purchased,
        s.needed_by::text                  AS needed_by,
        n.price_rap::text                  AS price_rap
      FROM need n
      JOIN resources r  ON r.id = n.resource_id
      LEFT JOIN bought b ON b.resource_id = n.resource_id
      LEFT JOIN starts s ON s.resource_id = n.resource_id
      ORDER BY s.needed_by NULLS LAST, n.resource_code
    `),
  );

  const mapped = rows
    .map((row): ProcurementPlanRow => {
      const outstanding = toDecimal(row.required).minus(toDecimal(row.purchased));
      const leadTimeDays = Number(row.lead_time_days) || 0;

      const orderBy =
        row.needed_by === null ? null : addDays(row.needed_by, -(leadTimeDays + bufferDays));
      const daysUntilOrder = orderBy === null ? null : daysBetween(today, orderBy);

      const urgency: ProcurementPlanRow['urgency'] =
        orderBy === null || daysUntilOrder === null
          ? 'UNSCHEDULED'
          : daysUntilOrder < 0
            ? 'LATE'
            : daysUntilOrder <= 7
              ? 'SOON'
              : 'PLANNED';

      return {
        resourceId: row.resource_id,
        code: row.code,
        name: row.name,
        unitCode: row.unit_code,
        leadTimeDays,
        outstanding: outstanding.toFixed(4),
        neededBy: row.needed_by,
        orderBy,
        daysUntilOrder,
        urgency,
        estimatedValue:
          !showCosts || row.price_rap === null
            ? null
            : outstanding.times(toDecimal(row.price_rap)).toFixed(2),
      };
    })
    // Nothing left to buy is nothing to plan. Rows that are fully purchased
    // belong on the material schedule, not on a list of things to order.
    .filter((row) => toDecimal(row.outstanding).greaterThan(0));

  return { rows: mapped, bufferDays, showCosts };
}
