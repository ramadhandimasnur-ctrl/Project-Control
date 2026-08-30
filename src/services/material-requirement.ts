import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { resources, units, workItemResources, workItems } from '@/db/schema';
import { toDecimal } from '@/lib/calc/decimal';
import { todayIso } from '@/lib/date';
import { simulateCapitalNeed } from '@/lib/calc/capital';
import {
  materialForScope,
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
import { getSimulationCandidates } from './scope';
import { effectiveCoefficient } from '@/lib/calc/estimate';

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

export async function getMaterialRequirement(
  userId: string,
  projectId: string,
  onDate: string = todayIso(),
): Promise<MaterialRequirementSummary> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);

  // Demand: every AHSP line of every active work item.
  const demand = await db
    .select({
      resourceId: workItemResources.resourceId,
      workItemId: workItems.id,
      // Procurement follows what execution plans to build, not what was sold.
      volume: sql<string>`coalesce(${workItems.volumeRap}, ${workItems.volume})`,
      coefRap: workItemResources.coef,
      wasteFactor: workItemResources.wasteFactor,
      qtyTyped: workItemResources.qty,
      resourceCode: resources.code,
      resourceName: resources.name,
      resourceSpec: resources.spec,
      unitCode: units.code,
    })
    .from(workItemResources)
    .innerJoin(workItems, eq(workItems.id, workItemResources.workItemId))
    .innerJoin(resources, eq(resources.id, workItemResources.resourceId))
    .innerJoin(units, eq(units.id, resources.unitId))
    // Only the execution analysis describes what will be bought.
    .where(
      and(
        eq(workItems.projectId, projectId),
        eq(workItems.isActive, true),
        eq(workItemResources.estimateType, 'RAP'),
      ),
    );

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
      /*
       * The effective coefficient, so a line written as a quantity is bought
       * as that quantity. Waste is already inside it, which is why it is not
       * passed on — applying it twice would order more than the number
       * somebody wrote down.
       */
      coefRap: effectiveCoefficient(
        { coef: row.coefRap, wasteFactor: row.wasteFactor, qty: row.qtyTyped },
        row.volume,
      ).toString(),
      wasteFactor: '0',
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
// --- scope simulation -------------------------------------------------------

export type MaterialScope = {
  targetWeight: string;
  currentWeight: string;
  gap: string;
  achievable: boolean;
  /** The work items the target requires, and how much of each. */
  workItems: { code: string; name: string; requiredFraction: string }[];
  rows: {
    resourceCode: string;
    resourceName: string;
    unitCode: string;
    required: string;
    stock: string;
    toBuy: string;
    priceRap: string | null;
    cost: string | null;
  }[];
  totalCost: string;
  unpriced: { resourceCode: string; resourceName: string }[];
  showCosts: boolean;
};

/**
 * Material a progress target consumes, and what still has to be bought.
 *
 * The scope comes from the same simulation the capital page uses, so the
 * purchasing list and the cash figure describe the same stretch of work in the
 * same plan order.
 */
export async function getMaterialScope(
  userId: string,
  projectId: string,
  /** Null asks for the next quarter above today's progress. */
  targetWeight: string | null,
  onDate: string = todayIso(),
): Promise<MaterialScope> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);

  const candidates = await getSimulationCandidates(userId, projectId);

  /*
   * Defaulting lives here rather than in the page so the two callers cannot
   * open on different targets — and so working out "where are we now" does not
   * cost a second pass over the whole estimate.
   */
  const current = simulateCapitalNeed(candidates, '0').currentWeight;
  const resolvedTarget =
    targetWeight ??
    String(Math.min(Math.floor(current.times(100).toNumber() / 25) * 25 + 25, 100) / 100);

  const simulation = simulateCapitalNeed(candidates, resolvedTarget);

  const fractionOf = new Map(
    simulation.rows.map((row) => [row.workItemId, row.requiredFraction.toString()]),
  );

  const empty: MaterialScope = {
    targetWeight: simulation.targetWeight.toString(),
    currentWeight: simulation.currentWeight.toString(),
    gap: simulation.gap.toString(),
    achievable: simulation.achievable,
    workItems: [],
    rows: [],
    totalCost: '0',
    unpriced: [],
    showCosts,
  };

  if (fractionOf.size === 0) return empty;

  const demand = await db
    .select({
      workItemId: workItems.id,
      resourceId: workItemResources.resourceId,
      // Procurement follows what execution plans to build, not what was sold.
      volume: sql<string>`coalesce(${workItems.volumeRap}, ${workItems.volume})`,
      coefRap: workItemResources.coef,
      wasteFactor: workItemResources.wasteFactor,
      qtyTyped: workItemResources.qty,
      resourceCode: resources.code,
      resourceName: resources.name,
      unitCode: units.code,
    })
    .from(workItemResources)
    .innerJoin(workItems, eq(workItems.id, workItemResources.workItemId))
    .innerJoin(resources, eq(resources.id, workItemResources.resourceId))
    .innerJoin(units, eq(units.id, resources.unitId))
    .where(
      and(
        eq(workItems.projectId, projectId),
        eq(workItems.isActive, true),
        inArray(workItems.id, [...fractionOf.keys()]),
        /*
         * Materials only. The AHSP lines of a work item also carry labour,
         * equipment and subcontract rows, and those are costs rather than
         * things anyone procures into a store — "beli 30 OH Pekerja" is not a
         * purchase order. The requirement table below keeps every kind,
         * because its question is about what left the warehouse.
         */
        eq(resources.type, 'MATERIAL'),
        // Only the execution analysis describes what will be bought.
        eq(workItemResources.estimateType, 'RAP'),
      ),
    );

  if (demand.length === 0) {
    return {
      ...empty,
      workItems: simulation.rows.map((row) => ({
        code: row.code,
        name: row.name,
        requiredFraction: row.requiredFraction.toString(),
      })),
    };
  }

  const resourceIds = [...new Set(demand.map((row) => row.resourceId))];

  const [stockRows, priceMap] = await Promise.all([
    withUser(userId, (tx) =>
      tx.execute<{ resource_id: string; qty_on_hand: string }>(sql`
        SELECT resource_id, coalesce(sum(qty_on_hand), 0)::text AS qty_on_hand
        FROM v_inventory_balance
        WHERE project_id = ${projectId}
        GROUP BY resource_id
      `),
    ),
    showCosts
      ? resolvePriceMap(resourceIds, projectId, 'RAP', onDate)
      : Promise.resolve(null),
  ]);

  const stockBy = new Map(stockRows.map((row) => [row.resource_id, row.qty_on_hand]));

  const scope = materialForScope(
    demand.map((row) => ({
      resourceId: row.resourceId,
      resourceCode: row.resourceCode,
      resourceName: row.resourceName,
      unitCode: row.unitCode,
      volume: row.volume,
      // As above: a typed quantity becomes a coefficient here, waste included.
      coefRap: effectiveCoefficient(
        { coef: row.coefRap, wasteFactor: row.wasteFactor, qty: row.qtyTyped },
        row.volume,
      ).toString(),
      wasteFactor: '0',
      fraction: fractionOf.get(row.workItemId) ?? '0',
      priceRap: priceMap?.resolved.get(row.resourceId)?.price.toString() ?? null,
      stock: stockBy.get(row.resourceId) ?? '0',
    })),
  );

  return {
    ...empty,
    workItems: simulation.rows.map((row) => ({
      code: row.code,
      name: row.name,
      requiredFraction: row.requiredFraction.toString(),
    })),
    rows: scope.rows.map((row) => ({
      resourceCode: row.resourceCode,
      resourceName: row.resourceName,
      unitCode: row.unitCode,
      required: row.required.toString(),
      stock: row.stock.toString(),
      toBuy: row.toBuy.toString(),
      priceRap: row.priceRap === null ? null : row.priceRap.toString(),
      cost: row.cost === null ? null : row.cost.toString(),
    })),
    totalCost: scope.totalCost.toString(),
    // Only meaningful when prices were fetched at all.
    unpriced: showCosts ? scope.unpriced : [],
  };
}

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
