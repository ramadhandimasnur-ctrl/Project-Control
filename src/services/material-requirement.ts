import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { resources, units, workItemResources, workItems } from '@/db/schema';
import { toDecimal } from '@/lib/calc/decimal';
import {
  rankByShortage,
  rankByWastage,
  summariseMaterial,
  totalShortageValue,
  type MaterialStatus,
  type RequirementLine,
} from '@/lib/calc/material';

import { assertProjectAccess } from './access';
import { canViewOrgCosts } from './org-access';
import { resolvePriceMap } from './prices';

/**
 * The material requirement table — charter section 6.5.
 *
 * Every figure comes from `lib/calc/material`; this gathers the inputs. The
 * column that matters most is wastage, which needs both sides of the story:
 * what left the warehouse, and what the approved progress says should have
 * been used.
 */

export type MaterialRequirementRow = {
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceSpec: string | null;
  unitCode: string;
  workItemCount: number;
  requirementTotal: string;
  purchased: string;
  issued: string;
  theoreticalUsage: string;
  wastage: string;
  wastagePercent: string | null;
  stock: string;
  shortage: string;
  stockValue: string | null;
  purchaseValueRemaining: string | null;
  status: MaterialStatus;
};

export type MaterialRequirementSummary = {
  rows: MaterialRequirementRow[];
  showCosts: boolean;
  totals: {
    stockValue: string | null;
    purchaseValueRemaining: string;
    shortageCount: number;
    wastageCount: number;
  };
  /** Most critical first, for the dashboard watch list. */
  topShortages: MaterialRequirementRow[];
  topWastage: MaterialRequirementRow[];
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getMaterialRequirement(
  userId: string,
  projectId: string,
  onDate: string = today(),
): Promise<MaterialRequirementSummary> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);

  // Demand: every AHSP line of every active work item.
  const demand = await db
    .select({
      resourceId: workItemResources.resourceId,
      workItemId: workItems.id,
      volume: workItems.volume,
      coefRap: workItemResources.coefRap,
      wasteFactor: workItemResources.wasteFactor,
      resourceCode: resources.code,
      resourceName: resources.name,
      resourceSpec: resources.spec,
      unitCode: units.code,
    })
    .from(workItemResources)
    .innerJoin(workItems, eq(workItems.id, workItemResources.workItemId))
    .innerJoin(resources, eq(resources.id, workItemResources.resourceId))
    .innerJoin(units, eq(units.id, resources.unitId))
    .where(and(eq(workItems.projectId, projectId), eq(workItems.isActive, true)));

  if (demand.length === 0) {
    return {
      rows: [],
      showCosts,
      totals: { stockValue: null, purchaseValueRemaining: '0.00', shortageCount: 0, wastageCount: 0 },
      topShortages: [],
      topWastage: [],
    };
  }

  const resourceIds = [...new Set(demand.map((d) => d.resourceId))];

  /*
   * Purchased, issued and stock come from the views so that a project with a
   * long ledger is aggregated in the database rather than streamed into Node.
   * Progress is not part of Phase 4 yet, so theoretical usage is zero for
   * every work item — wastage therefore reads as "everything issued so far",
   * which is correct until progress exists to compare against.
   */
  const [purchasedRows, stockRows] = await Promise.all([
    withUser(userId, (tx) =>
      tx.execute<{ resource_id: string; qty: string }>(sql`
        SELECT pi.resource_id, coalesce(sum(pi.qty), 0)::text AS qty
        FROM purchase_items pi
        JOIN purchases p ON p.id = pi.purchase_id
        WHERE p.project_id = ${projectId} AND p.status = 'POSTED'
        GROUP BY pi.resource_id
      `),
    ),
    withUser(userId, (tx) =>
      tx.execute<{ resource_id: string; qty_on_hand: string; qty_issued: string }>(sql`
        SELECT resource_id,
               coalesce(sum(qty_on_hand), 0)::text AS qty_on_hand,
               coalesce(sum(qty_issued), 0)::text  AS qty_issued
        FROM v_inventory_balance
        WHERE project_id = ${projectId}
        GROUP BY resource_id
      `),
    ),
  ]);

  const purchasedBy = new Map(purchasedRows.map((r) => [r.resource_id, r.qty]));
  const stockBy = new Map(stockRows.map((r) => [r.resource_id, r]));

  const movingCost = showCosts
    ? await withUser(userId, (tx) =>
        tx.execute<{ resource_id: string; cost: string }>(sql`
          SELECT resource_id,
                 CASE WHEN sum(qty_on_hand) = 0 THEN NULL
                      ELSE sum(stock_value) / sum(qty_on_hand) END::text AS cost
          FROM v_inventory_balance
          WHERE project_id = ${projectId}
          GROUP BY resource_id
        `),
      )
    : [];

  const costBy = new Map(movingCost.map((r) => [r.resource_id, r.cost]));
  const rapPrices = showCosts
    ? await resolvePriceMap(resourceIds, projectId, 'RAP', onDate)
    : { resolved: new Map(), missing: [] };

  const linesBy = new Map<string, RequirementLine[]>();
  const metaBy = new Map<string, (typeof demand)[number]>();
  const workItemsBy = new Map<string, Set<string>>();

  for (const row of demand) {
    const list = linesBy.get(row.resourceId) ?? [];
    list.push({
      workItemId: row.workItemId,
      volume: row.volume,
      coefRap: row.coefRap,
      wasteFactor: row.wasteFactor,
    });
    linesBy.set(row.resourceId, list);
    metaBy.set(row.resourceId, row);

    const items = workItemsBy.get(row.resourceId) ?? new Set<string>();
    items.add(row.workItemId);
    workItemsBy.set(row.resourceId, items);
  }

  // Empty until Phase 6 records progress; every work item then contributes.
  const cumulativePctByWorkItem = new Map<string, string>();

  const rows: MaterialRequirementRow[] = resourceIds.map((resourceId) => {
    const meta = metaBy.get(resourceId)!;
    const stock = stockBy.get(resourceId);
    const cost = costBy.get(resourceId) ?? null;

    const summary = summariseMaterial({
      lines: linesBy.get(resourceId) ?? [],
      purchased: purchasedBy.get(resourceId) ?? 0,
      issued: stock?.qty_issued ?? 0,
      stock: stock?.qty_on_hand ?? 0,
      cumulativePctByWorkItem,
      movingAverageCost: showCosts ? cost : null,
      priceRap: showCosts ? (rapPrices.resolved.get(resourceId)?.price ?? null) : null,
    });

    return {
      resourceId,
      resourceCode: meta.resourceCode,
      resourceName: meta.resourceName,
      resourceSpec: meta.resourceSpec,
      unitCode: meta.unitCode,
      workItemCount: workItemsBy.get(resourceId)?.size ?? 0,
      requirementTotal: summary.requirementTotal.toFixed(4),
      purchased: summary.purchased.toFixed(4),
      issued: summary.issued.toFixed(4),
      theoreticalUsage: summary.theoreticalUsage.toFixed(4),
      wastage: summary.wastage.toFixed(4),
      wastagePercent: summary.wastagePercent?.toFixed(6) ?? null,
      stock: summary.stock.toFixed(4),
      shortage: summary.shortage.toFixed(4),
      stockValue: summary.stockValue?.toFixed(2) ?? null,
      purchaseValueRemaining: summary.purchaseValueRemaining?.toFixed(2) ?? null,
      status: summary.status,
    };
  });

  rows.sort((a, b) => a.resourceCode.localeCompare(b.resourceCode));

  const decimalRows = rows.map((r) => ({
    ...r,
    shortage: toDecimal(r.shortage),
    wastage: toDecimal(r.wastage),
    purchaseValueRemaining: r.purchaseValueRemaining === null ? null : toDecimal(r.purchaseValueRemaining),
  }));

  const stockValueTotal = showCosts
    ? rows.reduce((acc, r) => acc.plus(toDecimal(r.stockValue ?? 0)), toDecimal(0)).toFixed(2)
    : null;

  return {
    rows,
    showCosts,
    totals: {
      stockValue: stockValueTotal,
      purchaseValueRemaining: totalShortageValue(decimalRows).toFixed(2),
      shortageCount: rows.filter((r) => Number(r.shortage) > 0).length,
      wastageCount: rows.filter((r) => Number(r.wastage) > 0).length,
    },
    topShortages: rankByShortage(decimalRows)
      .slice(0, 5)
      .map((r) => rows.find((row) => row.resourceId === r.resourceId)!),
    topWastage: rankByWastage(decimalRows)
      .slice(0, 5)
      .map((r) => rows.find((row) => row.resourceId === r.resourceId)!),
  };
}

/** Resource ids referenced by the project, for pickers. */
export async function listProjectResources(userId: string, projectId: string) {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await db
    .selectDistinct({
      id: resources.id,
      code: resources.code,
      name: resources.name,
      unitId: resources.unitId,
      unitCode: units.code,
    })
    .from(workItemResources)
    .innerJoin(workItems, eq(workItems.id, workItemResources.workItemId))
    .innerJoin(resources, eq(resources.id, workItemResources.resourceId))
    .innerJoin(units, eq(units.id, resources.unitId))
    .where(eq(workItems.projectId, projectId));

  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

/** Resources with stock on hand, for the issue form. */
export async function listResourcesInStock(userId: string, projectId: string) {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await withUser(userId, (tx) =>
    tx.execute<{ resource_id: string; qty_on_hand: string }>(sql`
      SELECT resource_id, sum(qty_on_hand)::text AS qty_on_hand
      FROM v_inventory_balance
      WHERE project_id = ${projectId}
      GROUP BY resource_id
      HAVING sum(qty_on_hand) > 0
    `),
  );

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.resource_id);
  const detail = await db
    .select({
      id: resources.id,
      code: resources.code,
      name: resources.name,
      unitId: resources.unitId,
      unitCode: units.code,
    })
    .from(resources)
    .innerJoin(units, eq(units.id, resources.unitId))
    .where(inArray(resources.id, ids));

  const qtyBy = new Map(rows.map((r) => [r.resource_id, r.qty_on_hand]));
  return detail
    .map((r) => ({ ...r, qtyOnHand: qtyBy.get(r.id) ?? '0' }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
