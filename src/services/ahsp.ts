import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { projects, resources, units, workGroups, workItemResources, workItems } from '@/db/schema';
import { type Decimal, safeDivide, toDecimal } from '@/lib/calc/decimal';
import {
  effectiveCoefficient,
  estimateWorkItem,
  lineQuantity,
  type EstimateLine,
} from '@/lib/calc/estimate';
import {
  computeWeights,
  reconcileContractValue,
  type WeightBasis,
  type WeightReconciliation,
} from '@/lib/calc/weight';
import { todayIso } from '@/lib/date';
import { conflict, notFound } from '@/lib/errors';
import { type AhspLineFormValues } from '@/lib/validation/work-breakdown';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { canViewOrgCosts } from './org-access';
import { resolvePriceMap, type MissingPrice } from './prices';
import { type SessionUser } from './session';

/** The units table joined a second time, for the execution unit. */
const unitRap = alias(units, 'unit_rap');

export type AhspRole = 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCON' | 'PACKAGE';
export type EstimateType = 'RAB' | 'RAP';

export type AhspLineView = {
  id: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceSpec: string | null;
  unitCode: string;
  /** Which of the two analyses this line belongs to. */
  estimateType: EstimateType;
  role: AhspRole;
  coef: string;
  wasteFactor: string;
  note: string | null;
  sortOrder: number;
  /** null when the price book has no entry in force — rendered as "—". */
  price: string | null;
  /** What must actually be procured, however the line arrived at it. */
  qty: string;
  /*
   * The figure somebody typed, or null when the quantity was derived.
   *
   * Kept apart from `qty` so the screen can tell the two cases apart: a
   * derived quantity is a consequence of the coefficient and moves when the
   * volume does, while a typed one is a decision and does not.
   */
  qtyTyped: string | null;
  amount: string | null;
};

export type WorkItemEstimateView = {
  workItemId: string;
  unitCode: string;
  /** Resolved: equal to `unitCode` unless the item measures RAP differently. */
  unitCodeRap: string;
  volume: string;
  /** Resolved: equal to `volume` unless the item stores a different one. */
  volumeRap: string;
  unitCostRab: string;
  unitCostRap: string;
  totalRab: string;
  totalRap: string;
  contractValue: string;
  margin: string;
  marginPercent: string | null;
  estimateSpread: string;
  /** Subtotals per AHSP section, per analysis, for the two footers. */
  subtotals: Record<EstimateType, Record<AhspRole, string>>;
  lines: AhspLineView[];
  missingPrices: MissingPrice[];
};

const EMPTY_SUBTOTALS = (): Record<AhspRole, string> => ({
  LABOR: '0.00',
  MATERIAL: '0.00',
  EQUIPMENT: '0.00',
  SUBCON: '0.00',
  PACKAGE: '0.00',
});

/**
 * The full unit-rate analysis of one work item, priced.
 *
 * Every figure here comes from `lib/calc/estimate`; this function's job is to
 * gather the inputs and hand them over, never to do the arithmetic itself.
 */
export async function getWorkItemEstimate(
  userId: string,
  projectId: string,
  workItemId: string,
  onDate: string = todayIso(),
): Promise<WorkItemEstimateView> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [item] = await db
    .select({
      id: workItems.id,
      unitCode: units.code,
      unitCodeRap: sql<string>`coalesce(${unitRap.code}, ${units.code})`,
      volume: workItems.volume,
      volumeRap: workItems.volumeRap,
      contractUnitPrice: workItems.contractUnitPrice,
      unitPriceRab: workItems.unitPriceRab,
      unitPriceRap: workItems.unitPriceRap,
    })
    .from(workItems)
    .innerJoin(units, eq(units.id, workItems.unitId))
    .leftJoin(unitRap, eq(unitRap.id, workItems.unitRapId))
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!item) throw notFound('Pekerjaan tidak ditemukan.');

  const [project] = await db
    .select({ defaultMarkup: projects.defaultMarkup })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const rows = await db
    .select({
      id: workItemResources.id,
      resourceId: workItemResources.resourceId,
      resourceCode: resources.code,
      resourceName: resources.name,
      resourceSpec: resources.spec,
      unitCode: units.code,
      estimateType: workItemResources.estimateType,
      role: workItemResources.role,
      coef: workItemResources.coef,
      wasteFactor: workItemResources.wasteFactor,
      qty: workItemResources.qty,
      note: workItemResources.note,
      sortOrder: workItemResources.sortOrder,
    })
    .from(workItemResources)
    .innerJoin(resources, eq(resources.id, workItemResources.resourceId))
    .innerJoin(units, eq(units.id, resources.unitId))
    .where(eq(workItemResources.workItemId, workItemId))
    .orderBy(asc(workItemResources.sortOrder), asc(resources.code));

  const showCosts = await canViewOrgCosts(userId);

  /*
   * Each analysis asks only for the prices its own lines need. Asking both
   * books for every resource would report a missing RAP price for a material
   * that only the budget analysis names — a warning about a gap that does not
   * exist, on a total that is in fact complete.
   */
  const idsOf = (type: EstimateType) =>
    rows.filter((r) => r.estimateType === type).map((r) => r.resourceId);

  const [rab, rap] = showCosts
    ? await Promise.all([
        resolvePriceMap(idsOf('RAB'), projectId, 'RAB', onDate),
        resolvePriceMap(idsOf('RAP'), projectId, 'RAP', onDate),
      ])
    : [
        { resolved: new Map(), missing: [] as MissingPrice[] },
        { resolved: new Map(), missing: [] as MissingPrice[] },
      ];

  const volume = toDecimal(item.volume);
  // Procurement follows the volume execution actually plans to build.
  const volumeRap = item.volumeRap === null ? volume : toDecimal(item.volumeRap);

  const lines: AhspLineView[] = rows.map((row) => {
    const book = row.estimateType === 'RAB' ? rab : rap;
    const price = book.resolved.get(row.resourceId)?.price ?? null;
    const onVolume = row.estimateType === 'RAB' ? volume : volumeRap;
    const qty = lineQuantity(row, onVolume);

    return {
      ...row,
      price: price?.toFixed(2) ?? null,
      qtyTyped: row.qty,
      qty: qty.toFixed(4),
      amount: price === null ? null : qty.times(price).toFixed(2),
    };
  });

  /*
   * A line now belongs to one analysis, so it contributes to one side and
   * zero to the other — which is exactly what a zero coefficient has always
   * meant to `lib/calc/estimate`. A line with no price contributes nothing
   * rather than blocking the total; `missingPrices` is what tells the user the
   * total is incomplete.
   */
  const estimateLines: EstimateLine[] = rows.map((row) => ({
    /*
     * The effective coefficient, not the stored one: a line may carry a typed
     * quantity instead, and this is where the two become one thing again.
     * Waste is already inside it, so `wasteFactor` must not be applied twice.
     */
    coefRab: row.estimateType === 'RAB' ? effectiveCoefficient(row, volume).toString() : '0',
    coefRap: row.estimateType === 'RAP' ? effectiveCoefficient(row, volumeRap).toString() : '0',
    wasteFactor: '0',
    priceRab: rab.resolved.get(row.resourceId)?.price ?? 0,
    priceRap: rap.resolved.get(row.resourceId)?.price ?? 0,
  }));

  const estimate = estimateWorkItem({
    volume: item.volume,
    volumeRap: item.volumeRap,
    lines: estimateLines,
    contractUnitPrice: item.contractUnitPrice,
    markup: project?.defaultMarkup ?? 0,
    directUnitRab: item.unitPriceRab,
    directUnitRap: item.unitPriceRap,
  });

  const subtotals: Record<EstimateType, Record<AhspRole, string>> = {
    RAB: EMPTY_SUBTOTALS(),
    RAP: EMPTY_SUBTOTALS(),
  };
  for (const line of lines) {
    if (line.amount === null) continue;
    const bucket = subtotals[line.estimateType];
    bucket[line.role] = toDecimal(bucket[line.role]).plus(line.amount).toFixed(2);
  }

  // Only price types actually in use are reported as missing.
  const missing = showCosts ? dedupeMissing([...rab.missing, ...rap.missing]) : [];

  return {
    workItemId,
    unitCode: item.unitCode,
    unitCodeRap: item.unitCodeRap,
    volume: item.volume,
    volumeRap: volumeRap.toString(),
    unitCostRab: estimate.unitCostRab.toFixed(2),
    unitCostRap: estimate.unitCostRap.toFixed(2),
    totalRab: estimate.totalRab.toFixed(2),
    totalRap: estimate.totalRap.toFixed(2),
    contractValue: estimate.contractValue.toFixed(2),
    margin: estimate.margin.toFixed(2),
    marginPercent: estimate.marginPercent?.toFixed(6) ?? null,
    estimateSpread: estimate.estimateSpread.toFixed(2),
    subtotals,
    lines,
    missingPrices: missing,
  };
}

// ---------------------------------------------------------------------------
// Both analyses of many work items, for printing
// ---------------------------------------------------------------------------

export type WorkItemAnalyses = {
  workItemId: string;
  code: string;
  name: string;
  spec: string | null;
  unitCode: string;
  /** Resolved: equal to `unitCode` unless the item measures RAP differently. */
  unitCodeRap: string;
  groupName: string | null;
  volume: string;
  volumeRap: string;
  unitCostRab: string;
  unitCostRap: string;
  totalRab: string;
  totalRap: string;
  subtotals: Record<EstimateType, Record<AhspRole, string>>;
  lines: AhspLineView[];
};

/**
 * Every work item's two analyses, in four queries rather than four per item.
 *
 * The print sheet needs the whole book at once. Calling `getWorkItemEstimate`
 * in a loop would issue a couple of hundred round trips for a project of any
 * size, and a document that takes a minute to open is a document nobody prints.
 */
export async function listWorkItemAnalyses(
  userId: string,
  projectId: string,
  options: { workItemId?: string | undefined } = {},
  onDate: string = todayIso(),
): Promise<{ items: WorkItemAnalyses[]; showCosts: boolean }> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const items = await db
    .select({
      id: workItems.id,
      code: workItems.code,
      name: workItems.name,
      spec: workItems.spec,
      groupName: workGroups.name,
      unitCode: units.code,
      unitCodeRap: sql<string>`coalesce(${unitRap.code}, ${units.code})`,
      volume: workItems.volume,
      volumeRap: workItems.volumeRap,
      unitPriceRab: workItems.unitPriceRab,
      unitPriceRap: workItems.unitPriceRap,
    })
    .from(workItems)
    .innerJoin(units, eq(units.id, workItems.unitId))
    .leftJoin(unitRap, eq(unitRap.id, workItems.unitRapId))
    .leftJoin(workGroups, eq(workGroups.id, workItems.groupId))
    .where(
      options.workItemId === undefined
        ? and(eq(workItems.projectId, projectId), eq(workItems.isActive, true))
        : and(eq(workItems.projectId, projectId), eq(workItems.id, options.workItemId)),
    )
    .orderBy(asc(workItems.sortOrder), asc(workItems.code));

  const showCosts = await canViewOrgCosts(userId);
  const itemIds = items.map((i) => i.id);

  const rows =
    itemIds.length === 0
      ? []
      : await db
          .select({
            id: workItemResources.id,
            workItemId: workItemResources.workItemId,
            resourceId: workItemResources.resourceId,
            resourceCode: resources.code,
            resourceName: resources.name,
            resourceSpec: resources.spec,
            unitCode: units.code,
            estimateType: workItemResources.estimateType,
            role: workItemResources.role,
            coef: workItemResources.coef,
            wasteFactor: workItemResources.wasteFactor,
            qty: workItemResources.qty,
            note: workItemResources.note,
            sortOrder: workItemResources.sortOrder,
          })
          .from(workItemResources)
          .innerJoin(resources, eq(resources.id, workItemResources.resourceId))
          .innerJoin(units, eq(units.id, resources.unitId))
          .where(inArray(workItemResources.workItemId, itemIds))
          .orderBy(asc(workItemResources.sortOrder), asc(resources.code));

  const idsOf = (type: EstimateType) => [
    ...new Set(rows.filter((r) => r.estimateType === type).map((r) => r.resourceId)),
  ];

  const [rab, rap] = showCosts
    ? await Promise.all([
        resolvePriceMap(idsOf('RAB'), projectId, 'RAB', onDate),
        resolvePriceMap(idsOf('RAP'), projectId, 'RAP', onDate),
      ])
    : [
        { resolved: new Map(), missing: [] as MissingPrice[] },
        { resolved: new Map(), missing: [] as MissingPrice[] },
      ];

  const rowsByItem = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = rowsByItem.get(row.workItemId) ?? [];
    list.push(row);
    rowsByItem.set(row.workItemId, list);
  }


  return {
    showCosts,
    items: items.map((item) => {
      const itemRows = rowsByItem.get(item.id) ?? [];
      const volume = toDecimal(item.volume);
      const volumeRap = item.volumeRap === null ? volume : toDecimal(item.volumeRap);

      const lines: AhspLineView[] = itemRows.map((row) => {
        const book = row.estimateType === 'RAB' ? rab : rap;
        const price = book.resolved.get(row.resourceId)?.price ?? null;
        const onVolume = row.estimateType === 'RAB' ? volume : volumeRap;
        const qty = lineQuantity(row, onVolume);

        return {
          ...row,
          price: price?.toFixed(2) ?? null,
          qtyTyped: row.qty,
          qty: qty.toFixed(4),
          amount: price === null ? null : qty.times(price).toFixed(2),
        };
      });

      const estimate = estimateWorkItem({
        volume: item.volume,
        volumeRap: item.volumeRap,
        lines: itemRows.map((row) => ({
          coefRab:
            row.estimateType === 'RAB' ? effectiveCoefficient(row, volume).toString() : '0',
          coefRap:
            row.estimateType === 'RAP' ? effectiveCoefficient(row, volumeRap).toString() : '0',
          wasteFactor: '0',
          priceRab: rab.resolved.get(row.resourceId)?.price ?? 0,
          priceRap: rap.resolved.get(row.resourceId)?.price ?? 0,
        })),
        contractUnitPrice: null,
        directUnitRab: item.unitPriceRab,
        directUnitRap: item.unitPriceRap,
      });

      const subtotals: Record<EstimateType, Record<AhspRole, string>> = {
        RAB: EMPTY_SUBTOTALS(),
        RAP: EMPTY_SUBTOTALS(),
      };
      for (const line of lines) {
        if (line.amount === null) continue;
        const bucket = subtotals[line.estimateType];
        bucket[line.role] = toDecimal(bucket[line.role]).plus(line.amount).toFixed(2);
      }

      return {
        workItemId: item.id,
        code: item.code,
        name: item.name,
        spec: item.spec,
        unitCode: item.unitCode,
        unitCodeRap: item.unitCodeRap,
        groupName: item.groupName,
        volume: item.volume,
        volumeRap: volumeRap.toString(),
        unitCostRab: estimate.unitCostRab.toFixed(2),
        unitCostRap: estimate.unitCostRap.toFixed(2),
        totalRab: estimate.totalRab.toFixed(2),
        totalRap: estimate.totalRap.toFixed(2),
        subtotals,
        lines,
      };
    }),
  };
}

function dedupeMissing(items: readonly MissingPrice[]): MissingPrice[] {
  const seen = new Set<string>();
  const out: MissingPrice[] = [];
  for (const item of items) {
    const key = `${item.resourceId}|${item.priceType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project-wide estimate
// ---------------------------------------------------------------------------

export type ProjectEstimateItem = {
  workItemId: string;
  code: string;
  name: string;
  groupName: string | null;
  unitCode: string;
  /** Resolved: equal to `unitCode` unless the item measures RAP differently. */
  unitCodeRap: string;
  volume: string;
  /** Resolved: equal to `volume` unless the item stores a different one. */
  volumeRap: string;
  includeInProgressWeight: boolean;
  unitCostRab: string;
  unitCostRap: string;
  totalRab: string;
  totalRap: string;
  contractValue: string;
  margin: string;
  marginPercent: string | null;
  weight: string;
  /**
   * Share of the project's total RAB.
   *
   * Distinct from `weight`, which follows whatever basis the project measures
   * progress on. This one answers a different question — how much of the budget
   * this line accounts for — so it includes items excluded from progress weight
   * and reconciles with the RAB column beside it.
   */
  weightRab: string;
  lineCount: number;
};

export type ProjectEstimate = {
  items: ProjectEstimateItem[];
  totals: {
    totalRab: string;
    totalRap: string;
    contractValue: string;
    margin: string;
    marginPercent: string | null;
  };
  reconciliation: {
    sumOfWorkItemContractValues: string;
    declaredContractValue: string;
    difference: string;
    differencePercent: string | null;
    needsAttention: boolean;
  };
  weightBasis: WeightBasis;
  missingPrices: MissingPrice[];
  showCosts: boolean;
};

/**
 * RAB, RAP, contract value, margin and weight for every work item.
 *
 * Deliberately a handful of queries rather than one per item: a project of 500
 * work items would otherwise issue a thousand round trips to price itself.
 */
export async function getProjectEstimate(
  userId: string,
  projectId: string,
  onDate: string = todayIso(),
): Promise<ProjectEstimate> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [project] = await db
    .select({
      contractValue: projects.contractValue,
      defaultMarkup: projects.defaultMarkup,
      progressWeightBasis: projects.progressWeightBasis,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw notFound('Proyek tidak ditemukan.');

  const items = await db
    .select({
      id: workItems.id,
      code: workItems.code,
      name: workItems.name,
      groupName: workGroups.name,
      unitCode: units.code,
      unitCodeRap: sql<string>`coalesce(${unitRap.code}, ${units.code})`,
      volume: workItems.volume,
      volumeRap: workItems.volumeRap,
      contractUnitPrice: workItems.contractUnitPrice,
      unitPriceRab: workItems.unitPriceRab,
      unitPriceRap: workItems.unitPriceRap,
      includeInProgressWeight: workItems.includeInProgressWeight,
    })
    .from(workItems)
    .innerJoin(units, eq(units.id, workItems.unitId))
    .leftJoin(unitRap, eq(unitRap.id, workItems.unitRapId))
    .leftJoin(workGroups, eq(workGroups.id, workItems.groupId))
    .where(and(eq(workItems.projectId, projectId), eq(workItems.isActive, true)))
    .orderBy(asc(workItems.sortOrder), asc(workItems.code));

  const itemIds = items.map((i) => i.id);
  const lines =
    itemIds.length === 0
      ? []
      : await db
          .select({
            workItemId: workItemResources.workItemId,
            resourceId: workItemResources.resourceId,
            estimateType: workItemResources.estimateType,
            coef: workItemResources.coef,
            wasteFactor: workItemResources.wasteFactor,
            qty: workItemResources.qty,
          })
          .from(workItemResources)
          .where(inArray(workItemResources.workItemId, itemIds));

  const showCosts = await canViewOrgCosts(userId);
  const idsOf = (type: EstimateType) => [
    ...new Set(lines.filter((l) => l.estimateType === type).map((l) => l.resourceId)),
  ];

  const [rab, rap] = showCosts
    ? await Promise.all([
        resolvePriceMap(idsOf('RAB'), projectId, 'RAB', onDate),
        resolvePriceMap(idsOf('RAP'), projectId, 'RAP', onDate),
      ])
    : [
        { resolved: new Map(), missing: [] as MissingPrice[] },
        { resolved: new Map(), missing: [] as MissingPrice[] },
      ];

  const linesByItem = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesByItem.get(line.workItemId) ?? [];
    list.push(line);
    linesByItem.set(line.workItemId, list);
  }

  const estimates = items.map((item) => {
    const itemLines = linesByItem.get(item.id) ?? [];
    const estimate = estimateWorkItem({
      volume: item.volume,
      volumeRap: item.volumeRap,
      lines: itemLines.map((l) => ({
        // As above: a typed quantity becomes a coefficient here, waste included.
        coefRab: l.estimateType === 'RAB' ? effectiveCoefficient(l, item.volume).toString() : '0',
        coefRap:
          l.estimateType === 'RAP'
            ? effectiveCoefficient(l, item.volumeRap ?? item.volume).toString()
            : '0',
        wasteFactor: '0',
        priceRab: rab.resolved.get(l.resourceId)?.price ?? 0,
        priceRap: rap.resolved.get(l.resourceId)?.price ?? 0,
      })),
      contractUnitPrice: item.contractUnitPrice,
      markup: project.defaultMarkup,
      directUnitRab: item.unitPriceRab,
      directUnitRap: item.unitPriceRap,
    });
    return { item, estimate, lineCount: itemLines.length };
  });

  const weights = new Map(
    computeWeights(
      estimates.map(({ item, estimate }) => ({
        id: item.id,
        contractValue: estimate.contractValue,
        totalRab: estimate.totalRab,
        totalRap: estimate.totalRap,
        includeInProgressWeight: item.includeInProgressWeight,
      })),
      project.progressWeightBasis,
    ).map((w) => [w.id, w.weight]),
  );

  const sum = (pick: (e: (typeof estimates)[number]) => Decimal): Decimal =>
    estimates.reduce<Decimal>((acc, e) => acc.plus(pick(e)), toDecimal(0));

  const totalRab = sum((e) => e.estimate.totalRab);
  const totalRap = sum((e) => e.estimate.totalRap);
  const contractTotal = sum((e) => e.estimate.contractValue);
  const margin = contractTotal.minus(totalRap);

  const reconciliation: WeightReconciliation = reconcileContractValue(
    estimates.map((e) => ({ contractValue: e.estimate.contractValue })),
    project.contractValue,
  );

  return {
    showCosts,
    weightBasis: project.progressWeightBasis,
    items: estimates.map(({ item, estimate, lineCount }) => ({
      workItemId: item.id,
      code: item.code,
      name: item.name,
      groupName: item.groupName,
      unitCode: item.unitCode,
      unitCodeRap: item.unitCodeRap,
      volume: item.volume,
      volumeRap: item.volumeRap ?? item.volume,
      includeInProgressWeight: item.includeInProgressWeight,
      unitCostRab: estimate.unitCostRab.toFixed(2),
      unitCostRap: estimate.unitCostRap.toFixed(2),
      totalRab: estimate.totalRab.toFixed(2),
      totalRap: estimate.totalRap.toFixed(2),
      contractValue: estimate.contractValue.toFixed(2),
      margin: estimate.margin.toFixed(2),
      marginPercent: estimate.marginPercent?.toFixed(6) ?? null,
      weight: (weights.get(item.id) ?? toDecimal(0)).toFixed(6),
      weightRab: (safeDivide(estimate.totalRab, totalRab) ?? toDecimal(0)).toFixed(6),
      lineCount,
    })),
    totals: {
      totalRab: totalRab.toFixed(2),
      totalRap: totalRap.toFixed(2),
      contractValue: contractTotal.toFixed(2),
      margin: margin.toFixed(2),
      marginPercent: contractTotal.isZero()
        ? null
        : margin.dividedBy(contractTotal).toFixed(6),
    },
    reconciliation: {
      sumOfWorkItemContractValues: reconciliation.sumOfWorkItemContractValues.toFixed(2),
      declaredContractValue: reconciliation.declaredContractValue.toFixed(2),
      difference: reconciliation.difference.toFixed(2),
      differencePercent: reconciliation.differencePercent?.toFixed(6) ?? null,
      needsAttention: reconciliation.needsAttention,
    },
    missingPrices: showCosts ? dedupeMissing([...rab.missing, ...rap.missing]) : [],
  };
}

// ---------------------------------------------------------------------------
// AHSP line maintenance
// ---------------------------------------------------------------------------

export async function saveAhspLine(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  lineId: string | null,
  values: AhspLineFormValues,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  await requireWorkItem(projectId, workItemId);
  await requireResourceInOrg(access.orgId, values.resourceId);

  const [duplicate] = await db
    .select({ id: workItemResources.id })
    .from(workItemResources)
    .where(
      and(
        eq(workItemResources.workItemId, workItemId),
        eq(workItemResources.estimateType, values.estimateType),
        eq(workItemResources.resourceId, values.resourceId),
        eq(workItemResources.role, values.role),
      ),
    )
    .limit(1);

  if (duplicate && duplicate.id !== lineId) {
    throw conflict(
      'Sumber daya ini sudah ada pada bagian yang sama di analisa ini.',
      'Ubah koefisien baris yang sudah ada, pilih bagian analisa lain, atau catat pada jenis analisa yang satunya.',
    );
  }

  return withUser(user.id, async (tx) => {
    let id = lineId;

    if (id === null) {
      const [created] = await tx
        .insert(workItemResources)
        .values({ ...values, workItemId, createdBy: user.id, updatedBy: user.id })
        .returning({ id: workItemResources.id });

      if (!created) throw conflict('Baris analisa gagal dibuat.');
      id = created.id;
    } else {
      await tx
        .update(workItemResources)
        .set({ ...values, updatedBy: user.id })
        .where(and(eq(workItemResources.id, id), eq(workItemResources.workItemId, workItemId)));
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_item_resources',
      recordId: id,
      action: lineId === null ? 'INSERT' : 'UPDATE',
      after: values,
      actorId: user.id,
    });

    return { id };
  });
}

export async function deleteAhspLine(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  lineId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  await withUser(user.id, async (tx) => {
    const [before] = await tx
      .select()
      .from(workItemResources)
      .where(and(eq(workItemResources.id, lineId), eq(workItemResources.workItemId, workItemId)))
      .limit(1);

    if (!before) throw notFound('Baris analisa tidak ditemukan.');

    await tx.delete(workItemResources).where(eq(workItemResources.id, lineId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_item_resources',
      recordId: lineId,
      action: 'DELETE',
      before,
      actorId: user.id,
    });
  });
}

async function requireWorkItem(projectId: string, workItemId: string) {
  const [row] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!row) throw notFound('Pekerjaan tidak ditemukan.');
  return row;
}

async function requireResourceInOrg(orgId: string, resourceId: string) {
  const [row] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.orgId, orgId)))
    .limit(1);

  if (!row) throw notFound('Sumber daya tidak ditemukan di organisasi ini.');
  return row;
}
