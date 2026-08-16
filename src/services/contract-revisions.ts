import 'server-only';

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import {
  contractBaselineItems,
  contractBaselines,
  contractRevisionLines,
  contractRevisions,
  projects,
  workItems,
} from '@/db/schema';
import {
  compareScope,
  summariseRevision,
  type RevisionLineInput,
  type ScopeComparisonInput,
} from '@/lib/calc/contract-revision';
import { toDecimal } from '@/lib/calc/decimal';
import { todayIso } from '@/lib/date';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { getProjectEstimate } from './ahsp';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

/**
 * Pekerjaan tambah/kurang — contract change orders.
 *
 * A revision is a set of volume changes held apart from the work breakdown
 * until it is approved. Drafting it against the live breakdown would answer
 * "what is this job worth now" while destroying the answer to "what did we
 * agree to build", and an addendum exists to prove the second.
 *
 * Approving one writes the new volumes onto the work items and moves the
 * project's declared contract value. Everything else the system reports —
 * item weights, the S-curve, earned value, the capital plan — is derived from
 * those volumes and follows on its own. There is no second recalculation step
 * to forget to run, which is exactly why none of those figures are stored.
 */

export type RevisionStatus = 'DRAFT' | 'APPROVED' | 'CANCELLED';

export const REVISION_STATUS_LABELS: Record<RevisionStatus, string> = {
  DRAFT: 'Draf',
  APPROVED: 'Disetujui',
  CANCELLED: 'Dibatalkan',
};

/** CCO-01, CCO-02 … the form the paperwork uses. */
export function revisionCode(seq: number): string {
  return `CCO-${String(seq).padStart(2, '0')}`;
}

export type RevisionRow = {
  id: string;
  seq: number;
  code: string;
  title: string;
  reason: string | null;
  effectiveDate: string;
  status: RevisionStatus;
  contractValueBefore: string | null;
  contractValueAfter: string | null;
  approvedAt: string | null;
  lineCount: number;
};

export async function listRevisions(userId: string, projectId: string): Promise<RevisionRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await db
    .select({
      id: contractRevisions.id,
      seq: contractRevisions.seq,
      title: contractRevisions.title,
      reason: contractRevisions.reason,
      effectiveDate: contractRevisions.effectiveDate,
      status: contractRevisions.status,
      contractValueBefore: contractRevisions.contractValueBefore,
      contractValueAfter: contractRevisions.contractValueAfter,
      approvedAt: contractRevisions.approvedAt,
      /*
       * Written out rather than interpolated. Drizzle renders a column
       * reference inside `sql` without knowing it has landed in a subquery,
       * and an unqualified `id` there resolves against the inner table — a
       * correlated count that silently returns zero for every row.
       */
      lineCount: sql<number>`(
        SELECT count(*)::int FROM contract_revision_lines l
        WHERE l.revision_id = contract_revisions.id
      )`,
    })
    .from(contractRevisions)
    .where(eq(contractRevisions.projectId, projectId))
    .orderBy(desc(contractRevisions.seq));

  return rows.map((row) => ({
    ...row,
    code: revisionCode(row.seq),
    approvedAt: row.approvedAt?.toISOString() ?? null,
  }));
}

export type RevisionDetail = RevisionRow & {
  lines: {
    id: string;
    workItemId: string;
    code: string;
    name: string;
    unitCode: string;
    volumeBefore: string;
    volumeAfter: string;
    volumeDelta: string;
    unitValue: string;
    valueBefore: string;
    valueAfter: string;
    valueDelta: string;
    kind: 'ADD' | 'CHANGE' | 'REMOVE';
    note: string | null;
  }[];
  summary: {
    addedValue: string;
    removedValue: string;
    netValue: string;
    contractValueBefore: string;
    contractValueAfter: string;
    netPercent: string | null;
  };
};

export async function getRevision(
  userId: string,
  projectId: string,
  revisionId: string,
): Promise<RevisionDetail> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [header] = await db
    .select()
    .from(contractRevisions)
    .where(and(eq(contractRevisions.id, revisionId), eq(contractRevisions.projectId, projectId)))
    .limit(1);

  if (!header) throw notFound('Revisi CCO tidak ditemukan.');

  const [lines, estimate, project] = await Promise.all([
    db
      .select({
        id: contractRevisionLines.id,
        workItemId: contractRevisionLines.workItemId,
        volumeBefore: contractRevisionLines.volumeBefore,
        volumeAfter: contractRevisionLines.volumeAfter,
        note: contractRevisionLines.note,
        sortOrder: contractRevisionLines.sortOrder,
        code: workItems.code,
        name: workItems.name,
      })
      .from(contractRevisionLines)
      .innerJoin(workItems, eq(workItems.id, contractRevisionLines.workItemId))
      .where(eq(contractRevisionLines.revisionId, revisionId))
      .orderBy(asc(contractRevisionLines.sortOrder), asc(workItems.code)),
    getProjectEstimate(userId, projectId),
    db
      .select({ contractValue: projects.contractValue })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
  ]);

  const byItem = new Map(estimate.items.map((item) => [item.workItemId, item]));

  /*
   * The unit rate comes from the estimate rather than being stored on the
   * line. A revision prices its volumes at what the item is worth per unit,
   * and freezing a copy would let the two drift the moment a price changed.
   */
  const inputs: RevisionLineInput[] = lines.map((line) => {
    const item = byItem.get(line.workItemId);
    const volume = toDecimal(item?.volume ?? 0);
    const unitValue = volume.isZero()
      ? toDecimal(0)
      : toDecimal(item?.contractValue ?? 0).dividedBy(volume);

    return {
      workItemId: line.workItemId,
      code: line.code,
      name: line.name,
      unitCode: item?.unitCode ?? '',
      volumeBefore: line.volumeBefore,
      volumeAfter: line.volumeAfter,
      unitValue,
      includeInProgressWeight: item?.includeInProgressWeight ?? true,
    };
  });

  const contractValueBefore =
    header.contractValueBefore ?? project[0]?.contractValue ?? '0';
  const summary = summariseRevision(inputs, contractValueBefore);
  const noteOf = new Map(lines.map((line) => [line.workItemId, line]));

  return {
    id: header.id,
    seq: header.seq,
    code: revisionCode(header.seq),
    title: header.title,
    reason: header.reason,
    effectiveDate: header.effectiveDate,
    status: header.status,
    contractValueBefore: header.contractValueBefore,
    contractValueAfter: header.contractValueAfter,
    approvedAt: header.approvedAt?.toISOString() ?? null,
    lineCount: lines.length,
    lines: summary.lines.map((line) => {
      const source = noteOf.get(line.workItemId);
      return {
        id: source?.id ?? line.workItemId,
        workItemId: line.workItemId,
        code: line.code,
        name: line.name,
        unitCode: line.unitCode,
        volumeBefore: line.volumeBefore.toString(),
        volumeAfter: line.volumeAfter.toString(),
        volumeDelta: line.volumeDelta.toString(),
        unitValue: line.unitValue.toFixed(2),
        valueBefore: line.valueBefore.toFixed(2),
        valueAfter: line.valueAfter.toFixed(2),
        valueDelta: line.valueDelta.toFixed(2),
        kind: line.kind,
        note: source?.note ?? null,
      };
    }),
    summary: {
      addedValue: summary.addedValue.toFixed(2),
      removedValue: summary.removedValue.toFixed(2),
      netValue: summary.netValue.toFixed(2),
      contractValueBefore: summary.contractValueBefore.toFixed(2),
      contractValueAfter: summary.contractValueAfter.toFixed(2),
      netPercent: summary.netPercent?.toFixed(6) ?? null,
    },
  };
}

// --- Baseline 0 --------------------------------------------------------------

export type BaselineSummary = {
  id: string;
  frozenAt: string;
  contractValue: string;
  itemCount: number;
  notes: string | null;
};

export async function getContractBaseline(
  userId: string,
  projectId: string,
): Promise<BaselineSummary | null> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [row] = await db
    .select({
      id: contractBaselines.id,
      frozenAt: contractBaselines.frozenAt,
      contractValue: contractBaselines.contractValue,
      notes: contractBaselines.notes,
      // Table-qualified for the same reason as `lineCount` above.
      itemCount: sql<number>`(
        SELECT count(*)::int FROM contract_baseline_items i
        WHERE i.baseline_id = contract_baselines.id
      )`,
    })
    .from(contractBaselines)
    .where(eq(contractBaselines.projectId, projectId))
    .limit(1);

  if (!row) return null;
  return { ...row, frozenAt: row.frozenAt.toISOString() };
}

/**
 * Freezes the scope as it stands — Baseline 0.
 *
 * Refuses to overwrite an existing one. The whole value of the baseline is
 * that it does not move; a "refreeze" after a revision would erase the thing
 * every later comparison is measured against, and it would do so silently.
 */
export async function freezeContractBaseline(
  user: SessionUser,
  projectId: string,
  notes: string | null = null,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const existing = await getContractBaseline(user.id, projectId);
  if (existing) {
    throw conflict(
      'Baseline 0 sudah dikunci untuk proyek ini.',
      'Baseline awal hanya dikunci sekali; perubahan lingkup setelahnya dicatat sebagai revisi CCO.',
    );
  }

  const estimate = await getProjectEstimate(user.id, projectId);
  if (estimate.items.length === 0) {
    throw validation(
      'Belum ada pekerjaan untuk dikunci sebagai Baseline 0.',
      'Susun daftar pekerjaan beserta volumenya terlebih dahulu.',
    );
  }

  const [project] = await db
    .select({ contractValue: projects.contractValue })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(contractBaselines)
      .values({
        projectId,
        contractValue: project?.contractValue ?? '0',
        frozenBy: user.id,
        notes,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: contractBaselines.id });

    if (!created) throw conflict('Baseline 0 gagal dikunci.');

    await tx.insert(contractBaselineItems).values(
      estimate.items.map((item, index) => ({
        baselineId: created.id,
        workItemId: item.workItemId,
        code: item.code,
        name: item.name,
        unitCode: item.unitCode,
        volume: item.volume,
        unitValue: toDecimal(item.volume).isZero()
          ? '0'
          : toDecimal(item.contractValue).dividedBy(toDecimal(item.volume)).toFixed(2),
        totalValue: item.contractValue,
        weight: item.weight,
        sortOrder: index,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'contract_baselines',
      recordId: created.id,
      action: 'INSERT',
      after: { itemCount: estimate.items.length, contractValue: project?.contractValue },
      actorId: user.id,
    });

    return { id: created.id };
  });
}

// --- drafting ----------------------------------------------------------------

export type RevisionInput = {
  title: string;
  reason: string | null;
  effectiveDate: string;
  lines: { workItemId: string; volumeAfter: string; note: string | null }[];
};

/**
 * Drafts a revision.
 *
 * `volumeBefore` is captured now, from the live breakdown, and never read
 * again. A revision drafted in March and approved in May has to keep saying
 * what the volume was when it was proposed — otherwise a second revision
 * approved in between would quietly rewrite the first one's own history.
 */
export async function createRevision(
  user: SessionUser,
  projectId: string,
  input: RevisionInput,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  if (input.lines.length === 0) {
    throw validation('Revisi CCO harus memuat setidaknya satu pekerjaan.');
  }

  const items = await db
    .select({ id: workItems.id, volume: workItems.volume })
    .from(workItems)
    .where(eq(workItems.projectId, projectId));

  const volumeOf = new Map(items.map((item) => [item.id, item.volume]));
  for (const line of input.lines) {
    if (!volumeOf.has(line.workItemId)) {
      throw notFound('Salah satu pekerjaan pada revisi ini tidak ada di proyek.');
    }
  }

  const [last] = await db
    .select({ seq: contractRevisions.seq })
    .from(contractRevisions)
    .where(eq(contractRevisions.projectId, projectId))
    .orderBy(desc(contractRevisions.seq))
    .limit(1);

  const seq = (last?.seq ?? 0) + 1;

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(contractRevisions)
      .values({
        projectId,
        seq,
        title: input.title,
        reason: input.reason,
        effectiveDate: input.effectiveDate,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: contractRevisions.id });

    if (!created) throw conflict('Revisi CCO gagal dibuat.');

    await tx.insert(contractRevisionLines).values(
      input.lines.map((line, index) => ({
        revisionId: created.id,
        workItemId: line.workItemId,
        volumeBefore: volumeOf.get(line.workItemId) ?? '0',
        volumeAfter: line.volumeAfter,
        note: line.note,
        sortOrder: index,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'contract_revisions',
      recordId: created.id,
      action: 'INSERT',
      after: { seq, ...input },
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function deleteRevision(
  user: SessionUser,
  projectId: string,
  revisionId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const [header] = await db
    .select({ status: contractRevisions.status, seq: contractRevisions.seq })
    .from(contractRevisions)
    .where(and(eq(contractRevisions.id, revisionId), eq(contractRevisions.projectId, projectId)))
    .limit(1);

  if (!header) throw notFound('Revisi CCO tidak ditemukan.');

  if (header.status === 'APPROVED') {
    throw conflict(
      'Revisi yang sudah disetujui tidak dapat dihapus.',
      'Volumenya sudah masuk ke kontrak. Ajukan revisi baru untuk mengembalikannya.',
    );
  }

  await withUser(user.id, async (tx) => {
    await tx.delete(contractRevisions).where(eq(contractRevisions.id, revisionId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'contract_revisions',
      recordId: revisionId,
      action: 'DELETE',
      before: header,
      actorId: user.id,
    });
  });
}

// --- approval ----------------------------------------------------------------

/**
 * Approves a revision and writes its volumes onto the work items.
 *
 * One transaction. A half-applied addendum — some volumes moved, the contract
 * value not, or the other way round — is a project whose figures cannot be
 * reconciled with its own paperwork, and no screen would show which half
 * landed.
 *
 * Baseline 0 is frozen here if it has not been already: the first approved
 * revision is the last honest moment to record what the original scope was.
 */
export async function approveRevision(
  user: SessionUser,
  projectId: string,
  revisionId: string,
): Promise<{ contractValueBefore: string; contractValueAfter: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const detail = await getRevision(user.id, projectId, revisionId);
  if (detail.status === 'APPROVED') {
    throw conflict('Revisi CCO ini sudah disetujui.');
  }
  if (detail.status === 'CANCELLED') {
    throw conflict(
      'Revisi CCO ini sudah dibatalkan.',
      'Buat revisi baru bila perubahannya tetap diperlukan.',
    );
  }

  const baseline = await getContractBaseline(user.id, projectId);
  if (!baseline) await freezeContractBaseline(user, projectId, 'Dikunci otomatis saat CCO pertama disetujui.');

  const { contractValueBefore, contractValueAfter } = detail.summary;

  await withUser(user.id, async (tx) => {
    for (const line of detail.lines) {
      await tx
        .update(workItems)
        .set({ volume: line.volumeAfter, updatedBy: user.id })
        .where(and(eq(workItems.id, line.workItemId), eq(workItems.projectId, projectId)));
    }

    await tx
      .update(projects)
      .set({ contractValue: contractValueAfter, updatedBy: user.id })
      .where(eq(projects.id, projectId));

    await tx
      .update(contractRevisions)
      .set({
        status: 'APPROVED',
        contractValueBefore,
        contractValueAfter,
        approvedBy: user.id,
        approvedAt: new Date(),
        updatedBy: user.id,
      })
      .where(eq(contractRevisions.id, revisionId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'contract_revisions',
      recordId: revisionId,
      action: 'UPDATE',
      before: { status: detail.status, contractValue: contractValueBefore },
      after: {
        status: 'APPROVED',
        contractValue: contractValueAfter,
        lines: detail.lines.map((line) => ({
          workItemId: line.workItemId,
          volumeBefore: line.volumeBefore,
          volumeAfter: line.volumeAfter,
        })),
      },
      actorId: user.id,
    });
  });

  return { contractValueBefore, contractValueAfter };
}

export async function cancelRevision(
  user: SessionUser,
  projectId: string,
  revisionId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const [header] = await db
    .select({ status: contractRevisions.status })
    .from(contractRevisions)
    .where(and(eq(contractRevisions.id, revisionId), eq(contractRevisions.projectId, projectId)))
    .limit(1);

  if (!header) throw notFound('Revisi CCO tidak ditemukan.');
  if (header.status === 'APPROVED') {
    throw conflict(
      'Revisi yang sudah disetujui tidak dapat dibatalkan.',
      'Volumenya sudah masuk ke kontrak. Ajukan revisi baru untuk mengembalikannya.',
    );
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(contractRevisions)
      .set({ status: 'CANCELLED', updatedBy: user.id })
      .where(eq(contractRevisions.id, revisionId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'contract_revisions',
      recordId: revisionId,
      action: 'UPDATE',
      before: header,
      after: { status: 'CANCELLED' },
      actorId: user.id,
    });
  });
}

// --- comparison, for the printed addendum ------------------------------------

export type ScopeComparisonView = {
  hasBaseline: boolean;
  frozenAt: string | null;
  rows: {
    workItemId: string | null;
    code: string;
    name: string;
    unitCode: string;
    baselineVolume: string;
    baselineValue: string;
    baselineWeight: string;
    currentVolume: string;
    currentValue: string;
    currentWeight: string;
    volumeDelta: string;
    valueDelta: string;
    weightDelta: string;
  }[];
  totals: {
    baselineValue: string;
    currentValue: string;
    valueDelta: string;
    valuePercent: string | null;
  };
};

/**
 * Baseline 0 against the scope as it stands, item by item.
 *
 * Items appear if they exist on either side: one added by a revision has no
 * baseline row, one removed outright has no current row, and dropping either
 * would leave a column that does not add up to its own total.
 */
export async function getScopeComparison(
  userId: string,
  projectId: string,
): Promise<ScopeComparisonView> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [baseline, estimate] = await Promise.all([
    getContractBaseline(userId, projectId),
    getProjectEstimate(userId, projectId),
  ]);

  const baselineRows = baseline
    ? await db
        .select()
        .from(contractBaselineItems)
        .where(eq(contractBaselineItems.baselineId, baseline.id))
        .orderBy(asc(contractBaselineItems.sortOrder))
    : [];

  const byKey = new Map<string, ScopeComparisonInput>();

  for (const row of baselineRows) {
    byKey.set(row.workItemId ?? `code:${row.code}`, {
      workItemId: row.workItemId,
      code: row.code,
      name: row.name,
      unitCode: row.unitCode,
      baselineVolume: row.volume,
      baselineValue: row.totalValue,
      baselineWeight: row.weight,
      currentVolume: '0',
      currentValue: '0',
      currentWeight: '0',
    });
  }

  for (const item of estimate.items) {
    const key = item.workItemId;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        currentVolume: item.volume,
        currentValue: item.contractValue,
        currentWeight: item.weight,
      });
    } else {
      byKey.set(key, {
        workItemId: item.workItemId,
        code: item.code,
        name: item.name,
        unitCode: item.unitCode,
        baselineVolume: '0',
        baselineValue: '0',
        baselineWeight: '0',
        currentVolume: item.volume,
        currentValue: item.contractValue,
        currentWeight: item.weight,
      });
    }
  }

  const comparison = compareScope([...byKey.values()]);

  return {
    hasBaseline: baseline !== null,
    frozenAt: baseline?.frozenAt ?? null,
    rows: comparison.rows.map((row) => ({
      workItemId: row.workItemId,
      code: row.code,
      name: row.name,
      unitCode: row.unitCode,
      baselineVolume: String(row.baselineVolume),
      baselineValue: String(row.baselineValue),
      baselineWeight: String(row.baselineWeight),
      currentVolume: String(row.currentVolume),
      currentValue: String(row.currentValue),
      currentWeight: String(row.currentWeight),
      volumeDelta: row.volumeDelta.toString(),
      valueDelta: row.valueDelta.toFixed(2),
      weightDelta: row.weightDelta.toFixed(6),
    })),
    totals: {
      baselineValue: comparison.totals.baselineValue.toFixed(2),
      currentValue: comparison.totals.currentValue.toFixed(2),
      valueDelta: comparison.totals.valueDelta.toFixed(2),
      valuePercent: comparison.totals.valuePercent?.toFixed(6) ?? null,
    },
  };
}

/** Today, as the default effective date on a new revision. */
export const defaultEffectiveDate = todayIso;
