import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { projects, resources, units, workGroups, workItemResources, workItems } from '@/db/schema';
import { type Decimal, toDecimal } from '@/lib/calc/decimal';
import { estimateWorkItem, type EstimateLine } from '@/lib/calc/estimate';
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

export type AhspRole = 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCON' | 'PACKAGE';

export type AhspLineView = {
  id: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceSpec: string | null;
  unitCode: string;
  role: AhspRole;
  coefRab: string;
  coefRap: string;
  wasteFactor: string;
  note: string | null;
  sortOrder: number;
  /** null when the price book has no entry in force — rendered as "—". */
  priceRab: string | null;
  priceRap: string | null;
  /** volume x coefficient x (1 + waste): what must actually be procured. */
  qtyRab: string | null;
  qtyRap: string | null;
  amountRab: string | null;
  amountRap: string | null;
};

export type WorkItemEstimateView = {
  workItemId: string;
  volume: string;
  unitCostRab: string;
  unitCostRap: string;
  totalRab: string;
  totalRap: string;
  contractValue: string;
  margin: string;
  marginPercent: string | null;
  estimateSpread: string;
  /** Subtotals per AHSP section, for the footer. */
  subtotalsRap: Record<AhspRole, string>;
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
      volume: workItems.volume,
      contractUnitPrice: workItems.contractUnitPrice,
      unitPriceRab: workItems.unitPriceRab,
      unitPriceRap: workItems.unitPriceRap,
    })
    .from(workItems)
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
      role: workItemResources.role,
      coefRab: workItemResources.coefRab,
      coefRap: workItemResources.coefRap,
      wasteFactor: workItemResources.wasteFactor,
      note: workItemResources.note,
      sortOrder: workItemResources.sortOrder,
    })
    .from(workItemResources)
    .innerJoin(resources, eq(resources.id, workItemResources.resourceId))
    .innerJoin(units, eq(units.id, resources.unitId))
    .where(eq(workItemResources.workItemId, workItemId))
    .orderBy(asc(workItemResources.sortOrder), asc(resources.code));

  const showCosts = await canViewOrgCosts(userId);
  const resourceIds = rows.map((r) => r.resourceId);

  const [rab, rap] = showCosts
    ? await Promise.all([
        resolvePriceMap(resourceIds, projectId, 'RAB', onDate),
        resolvePriceMap(resourceIds, projectId, 'RAP', onDate),
      ])
    : [
        { resolved: new Map(), missing: [] as MissingPrice[] },
        { resolved: new Map(), missing: [] as MissingPrice[] },
      ];

  const volume = toDecimal(item.volume);
  const wasteMultiplier = (waste: string) => toDecimal(1).plus(toDecimal(waste));

  const lines: AhspLineView[] = rows.map((row) => {
    const priceRab = rab.resolved.get(row.resourceId)?.price ?? null;
    const priceRap = rap.resolved.get(row.resourceId)?.price ?? null;

    const qRab = volume.times(toDecimal(row.coefRab)).times(wasteMultiplier(row.wasteFactor));
    const qRap = volume.times(toDecimal(row.coefRap)).times(wasteMultiplier(row.wasteFactor));

    return {
      ...row,
      priceRab: priceRab?.toFixed(2) ?? null,
      priceRap: priceRap?.toFixed(2) ?? null,
      qtyRab: qRab.toFixed(4),
      qtyRap: qRap.toFixed(4),
      amountRab: priceRab === null ? null : qRab.times(priceRab).toFixed(2),
      amountRap: priceRap === null ? null : qRap.times(priceRap).toFixed(2),
    };
  });

  // A line with no price contributes nothing rather than blocking the total;
  // `missingPrices` is what tells the user the total is incomplete.
  const estimateLines: EstimateLine[] = rows.map((row) => ({
    coefRab: row.coefRab,
    coefRap: row.coefRap,
    wasteFactor: row.wasteFactor,
    priceRab: rab.resolved.get(row.resourceId)?.price ?? 0,
    priceRap: rap.resolved.get(row.resourceId)?.price ?? 0,
  }));

  const estimate = estimateWorkItem({
    volume: item.volume,
    lines: estimateLines,
    contractUnitPrice: item.contractUnitPrice,
    markup: project?.defaultMarkup ?? 0,
    directUnitRab: item.unitPriceRab,
    directUnitRap: item.unitPriceRap,
  });

  const subtotalsRap = EMPTY_SUBTOTALS();
  for (const line of lines) {
    if (line.amountRap === null) continue;
    subtotalsRap[line.role] = toDecimal(subtotalsRap[line.role])
      .plus(line.amountRap)
      .toFixed(2);
  }

  // Only price types actually in use are reported as missing.
  const missing = showCosts ? dedupeMissing([...rab.missing, ...rap.missing]) : [];

  return {
    workItemId,
    volume: item.volume,
    unitCostRab: estimate.unitCostRab.toFixed(2),
    unitCostRap: estimate.unitCostRap.toFixed(2),
    totalRab: estimate.totalRab.toFixed(2),
    totalRap: estimate.totalRap.toFixed(2),
    contractValue: estimate.contractValue.toFixed(2),
    margin: estimate.margin.toFixed(2),
    marginPercent: estimate.marginPercent?.toFixed(6) ?? null,
    estimateSpread: estimate.estimateSpread.toFixed(2),
    subtotalsRap,
    lines,
    missingPrices: missing,
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
  volume: string;
  includeInProgressWeight: boolean;
  unitCostRab: string;
  unitCostRap: string;
  totalRab: string;
  totalRap: string;
  contractValue: string;
  margin: string;
  marginPercent: string | null;
  weight: string;
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
      volume: workItems.volume,
      contractUnitPrice: workItems.contractUnitPrice,
      unitPriceRab: workItems.unitPriceRab,
      unitPriceRap: workItems.unitPriceRap,
      includeInProgressWeight: workItems.includeInProgressWeight,
    })
    .from(workItems)
    .innerJoin(units, eq(units.id, workItems.unitId))
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
            coefRab: workItemResources.coefRab,
            coefRap: workItemResources.coefRap,
            wasteFactor: workItemResources.wasteFactor,
          })
          .from(workItemResources)
          .where(inArray(workItemResources.workItemId, itemIds));

  const showCosts = await canViewOrgCosts(userId);
  const resourceIds = [...new Set(lines.map((l) => l.resourceId))];

  const [rab, rap] = showCosts
    ? await Promise.all([
        resolvePriceMap(resourceIds, projectId, 'RAB', onDate),
        resolvePriceMap(resourceIds, projectId, 'RAP', onDate),
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
      lines: itemLines.map((l) => ({
        coefRab: l.coefRab,
        coefRap: l.coefRap,
        wasteFactor: l.wasteFactor,
        priceRab: rab.resolved.get(l.resourceId)?.price ?? 0,
        priceRap: rap.resolved.get(l.resourceId)?.price ?? 0,
      })),
      contractUnitPrice: item.contractUnitPrice,
      markup: project.defaultMarkup,
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
      volume: item.volume,
      includeInProgressWeight: item.includeInProgressWeight,
      unitCostRab: estimate.unitCostRab.toFixed(2),
      unitCostRap: estimate.unitCostRap.toFixed(2),
      totalRab: estimate.totalRab.toFixed(2),
      totalRap: estimate.totalRap.toFixed(2),
      contractValue: estimate.contractValue.toFixed(2),
      margin: estimate.margin.toFixed(2),
      marginPercent: estimate.marginPercent?.toFixed(6) ?? null,
      weight: (weights.get(item.id) ?? toDecimal(0)).toFixed(6),
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
        eq(workItemResources.resourceId, values.resourceId),
        eq(workItemResources.role, values.role),
      ),
    )
    .limit(1);

  if (duplicate && duplicate.id !== lineId) {
    throw conflict(
      'Sumber daya ini sudah ada pada bagian analisa yang sama.',
      'Ubah koefisien baris yang sudah ada, atau pilih bagian analisa lain.',
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
