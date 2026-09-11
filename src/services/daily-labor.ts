import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { withUser } from '@/db/context';
import { actualCosts, dailyLabor, dailyLaborLines, foremen } from '@/db/schema';
import { toDecimal, ZERO } from '@/lib/calc/decimal';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { assertOrgAccess, canViewOrgCosts } from './org-access';
import { type SessionUser } from './session';

/**
 * Day-rate labour — upah harian.
 *
 * The other half of how work gets paid for on a site, and the half the system
 * could not see. Piecework is measured and certified; a day-rate crew is paid
 * for turning up, and the risk of a slow day sits with whoever is paying.
 *
 * Two figures are stored rather than derived on read. A rate renegotiated in
 * June must not rewrite what a day in March cost, and a day already paid has
 * to keep saying what it was paid for.
 */

export type ForemanRow = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  bankAccount: string | null;
  isActive: boolean;
  note: string | null;
};

export async function listForemen(userId: string): Promise<ForemanRow[]> {
  const access = await assertOrgAccess(userId);

  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: foremen.id,
        code: foremen.code,
        name: foremen.name,
        phone: foremen.phone,
        bankAccount: foremen.bankAccount,
        isActive: foremen.isActive,
        note: foremen.note,
      })
      .from(foremen)
      .where(eq(foremen.orgId, access.orgId))
      .orderBy(asc(foremen.code)),
  );

  return rows;
}

export async function saveForeman(
  user: SessionUser,
  foremanId: string | null,
  input: {
    code: string;
    name: string;
    phone: string | null;
    address: string | null;
    bankAccount: string | null;
    isActive: boolean;
    note: string | null;
  },
): Promise<{ id: string }> {
  const access = await assertOrgAccess(user.id, 'ADMIN');

  return withUser(user.id, async (tx) => {
    let id = foremanId;
    const values = { ...input, updatedBy: user.id };

    if (id === null) {
      const [created] = await tx
        .insert(foremen)
        .values({ ...values, orgId: access.orgId, createdBy: user.id })
        .returning({ id: foremen.id });
      if (!created) throw conflict('Mandor gagal disimpan.');
      id = created.id;
    } else {
      await tx
        .update(foremen)
        .set(values)
        .where(and(eq(foremen.id, id), eq(foremen.orgId, access.orgId)));
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'foremen',
      recordId: id,
      action: foremanId === null ? 'INSERT' : 'UPDATE',
      before: null,
      after: { code: input.code, name: input.name },
      actorId: user.id,
    });

    return { id };
  });
}

export type DailyLaborRow = {
  id: string;
  workDate: string;
  foremanId: string | null;
  foremanName: string | null;
  periodId: string | null;
  periodLabel: string | null;
  workerCount: number;
  dayFraction: string;
  dailyRate: string;
  personDays: string;
  grossAmount: string;
  status: 'DRAFT' | 'APPROVED' | 'PAID';
  paidAt: string | null;
  note: string | null;
  /** Person-days already attached to a work item. */
  allocatedPersonDays: string;
  /** What remains unattached, and therefore lands on no work item. */
  unallocatedPersonDays: string;
  lineCount: number;
};

export async function listDailyLabor(
  userId: string,
  projectId: string,
  options: { periodId?: string } = {},
): Promise<{ rows: DailyLaborRow[]; totals: { grossAmount: string; personDays: string }; showCosts: boolean }> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);

  if (!showCosts) {
    return { rows: [], totals: { grossAmount: '0.00', personDays: '0.0000' }, showCosts };
  }

  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      id: string;
      work_date: string;
      foreman_id: string | null;
      foreman_name: string | null;
      period_id: string | null;
      period_label: string | null;
      worker_count: number;
      day_fraction: string;
      daily_rate: string;
      person_days: string;
      gross_amount: string;
      status: DailyLaborRow['status'];
      paid_at: string | null;
      note: string | null;
      allocated: string;
      line_count: number;
    }>(sql`
      SELECT
        d.id, d.work_date::text, d.foreman_id, f.name AS foreman_name,
        d.period_id, p.label AS period_label,
        d.worker_count, d.day_fraction::text, d.daily_rate::text,
        d.person_days::text, d.gross_amount::text, d.status, d.paid_at::text, d.note,
        coalesce((SELECT sum(l.person_days) FROM daily_labor_lines l
                  WHERE l.daily_labor_id = d.id), 0)::text        AS allocated,
        (SELECT count(*)::int FROM daily_labor_lines l
         WHERE l.daily_labor_id = d.id)                           AS line_count
      FROM daily_labor d
      LEFT JOIN foremen f          ON f.id = d.foreman_id
      LEFT JOIN schedule_periods p ON p.id = d.period_id
      WHERE d.project_id = ${projectId}
        ${options.periodId === undefined ? sql`` : sql`AND d.period_id = ${options.periodId}`}
      ORDER BY d.work_date DESC, d.created_at DESC
      LIMIT 500
    `),
  );

  let gross = ZERO;
  let days = ZERO;

  const mapped = rows.map((row): DailyLaborRow => {
    const personDays = toDecimal(row.person_days);
    const allocated = toDecimal(row.allocated);
    gross = gross.plus(row.gross_amount);
    days = days.plus(personDays);

    return {
      id: row.id,
      workDate: row.work_date,
      foremanId: row.foreman_id,
      foremanName: row.foreman_name,
      periodId: row.period_id,
      periodLabel: row.period_label,
      workerCount: row.worker_count,
      dayFraction: row.day_fraction,
      dailyRate: row.daily_rate,
      personDays: personDays.toFixed(4),
      grossAmount: toDecimal(row.gross_amount).toFixed(2),
      status: row.status,
      paidAt: row.paid_at,
      note: row.note,
      allocatedPersonDays: allocated.toFixed(4),
      // Never negative on screen: over-allocation is refused on write, and a
      // negative remainder would read as spare capacity.
      unallocatedPersonDays: personDays.minus(allocated).greaterThan(0)
        ? personDays.minus(allocated).toFixed(4)
        : '0.0000',
      lineCount: row.line_count,
    };
  });

  return {
    rows: mapped,
    totals: { grossAmount: gross.toFixed(2), personDays: days.toFixed(4) },
    showCosts,
  };
}

export type DailyLaborDetail = DailyLaborRow & {
  lines: {
    id: string;
    workItemId: string | null;
    workItemCode: string | null;
    workItemName: string | null;
    personDays: string;
    qtyOutput: string | null;
    allocatedCost: string;
    note: string | null;
  }[];
};

export async function getDailyLabor(
  userId: string,
  projectId: string,
  dailyLaborId: string,
): Promise<DailyLaborDetail> {
  const { rows } = await listDailyLabor(userId, projectId);
  const header = rows.find((row) => row.id === dailyLaborId);
  if (!header) throw notFound('Catatan upah harian tidak ditemukan.');

  const lines = await withUser(userId, (tx) =>
    tx.execute<{
      id: string;
      work_item_id: string | null;
      code: string | null;
      name: string | null;
      person_days: string;
      qty_output: string | null;
      allocated_cost: string;
      note: string | null;
    }>(sql`
      SELECT l.id, l.work_item_id, wi.code, wi.name,
             l.person_days::text, l.qty_output::text, l.allocated_cost::text, l.note
      FROM daily_labor_lines l
      LEFT JOIN work_items wi ON wi.id = l.work_item_id
      WHERE l.daily_labor_id = ${dailyLaborId}
      ORDER BY l.created_at
    `),
  );

  return {
    ...header,
    lines: lines.map((row) => ({
      id: row.id,
      workItemId: row.work_item_id,
      workItemCode: row.code,
      workItemName: row.name,
      personDays: row.person_days,
      qtyOutput: row.qty_output,
      allocatedCost: row.allocated_cost,
      note: row.note,
    })),
  };
}

export type DailyLaborInput = {
  workDate: string;
  periodId: string | null;
  foremanId: string | null;
  workerCount: number;
  dayFraction: string;
  dailyRate: string;
  note: string | null;
  lines: { workItemId: string | null; personDays: string; qtyOutput: string | null; note: string | null }[];
};

/**
 * Records a day, and splits it across the work it went into.
 *
 * The two derived figures are computed here and stored: person-days is the
 * headcount times the fraction of a day worked, and the gross is that times
 * the rate. A form that let all four be typed would eventually hold four
 * numbers that do not multiply out, and the one somebody is paid on is
 * whichever they read first.
 */
export async function saveDailyLabor(
  user: SessionUser,
  projectId: string,
  dailyLaborId: string | null,
  input: DailyLaborInput,
): Promise<{ id: string; grossAmount: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const personDays = toDecimal(input.workerCount).times(toDecimal(input.dayFraction));
  const rate = toDecimal(input.dailyRate);
  const gross = personDays.times(rate);

  const allocated = input.lines.reduce((acc, line) => acc.plus(toDecimal(line.personDays)), ZERO);

  /*
   * More allocated than worked is not a rounding question — it is somebody
   * counting the same crew on two items. Refused rather than scaled down,
   * because scaling silently changes what the report says happened.
   */
  if (allocated.greaterThan(personDays)) {
    throw validation(
      `Pembagian ${allocated.toString()} hari-orang melebihi ${personDays.toString()} yang tercatat hari itu.`,
    );
  }

  return withUser(user.id, async (tx) => {
    let id = dailyLaborId;

    const header = {
      projectId,
      periodId: input.periodId,
      foremanId: input.foremanId,
      workDate: input.workDate,
      workerCount: input.workerCount,
      dayFraction: input.dayFraction,
      dailyRate: input.dailyRate,
      personDays: personDays.toFixed(4),
      grossAmount: gross.toFixed(2),
      note: input.note,
      updatedBy: user.id,
    };

    if (id === null) {
      const [created] = await tx
        .insert(dailyLabor)
        .values({ ...header, createdBy: user.id })
        .returning({ id: dailyLabor.id });
      if (!created) throw conflict('Catatan upah harian gagal disimpan.');
      id = created.id;
    } else {
      const [existing] = await tx
        .select({ status: dailyLabor.status })
        .from(dailyLabor)
        .where(and(eq(dailyLabor.id, id), eq(dailyLabor.projectId, projectId)))
        .limit(1);

      if (!existing) throw notFound('Catatan upah harian tidak ditemukan.');
      if (existing.status === 'PAID') {
        throw conflict(
          'Catatan yang sudah dibayar tidak dapat diubah.',
          'Catatan pembayaran adalah bukti; koreksi lewat catatan hari berikutnya.',
        );
      }

      await tx.update(dailyLabor).set(header).where(eq(dailyLabor.id, id));
      await tx.delete(dailyLaborLines).where(eq(dailyLaborLines.dailyLaborId, id));
    }

    const parentId = id;
    if (input.lines.length > 0) {
      await tx.insert(dailyLaborLines).values(
        input.lines.map((line) => ({
          dailyLaborId: parentId,
          workItemId: line.workItemId,
          personDays: line.personDays,
          qtyOutput: line.qtyOutput,
          // Person-days times the day's rate, not a share of the gross: the
          // two agree, and this one stays right when part of the day is left
          // unallocated.
          allocatedCost: toDecimal(line.personDays).times(rate).toFixed(2),
          note: line.note,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'daily_labor',
      recordId: id,
      action: dailyLaborId === null ? 'INSERT' : 'UPDATE',
      before: null,
      after: { workDate: input.workDate, grossAmount: gross.toFixed(2), lines: input.lines.length },
      actorId: user.id,
    });

    return { id: parentId, grossAmount: gross.toFixed(2) };
  });
}

/**
 * Approves a day, and books what it cost against the items it was spent on.
 *
 * Keyed on the day, so approving twice replaces the booking rather than adding
 * a second copy. Person-days left unallocated are booked without a work item —
 * they were still spent, and dropping them would make the project look cheaper
 * than it was.
 */
export async function approveDailyLabor(
  user: SessionUser,
  projectId: string,
  dailyLaborId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  await withUser(user.id, async (tx) => {
    const [header] = await tx
      .select()
      .from(dailyLabor)
      .where(and(eq(dailyLabor.id, dailyLaborId), eq(dailyLabor.projectId, projectId)))
      .limit(1);

    if (!header) throw notFound('Catatan upah harian tidak ditemukan.');
    if (header.status === 'PAID') {
      throw conflict('Catatan yang sudah dibayar tidak dapat diubah.');
    }

    await tx
      .update(dailyLabor)
      .set({ status: 'APPROVED', updatedBy: user.id })
      .where(eq(dailyLabor.id, dailyLaborId));

    await tx.delete(actualCosts).where(eq(actualCosts.dailyLaborId, dailyLaborId));

    const lines = await tx
      .select({
        workItemId: dailyLaborLines.workItemId,
        allocatedCost: dailyLaborLines.allocatedCost,
      })
      .from(dailyLaborLines)
      .where(eq(dailyLaborLines.dailyLaborId, dailyLaborId));

    const allocatedCost = lines.reduce((acc, line) => acc.plus(toDecimal(line.allocatedCost)), ZERO);
    const remainder = toDecimal(header.grossAmount).minus(allocatedCost);

    const bookings = lines.map((line) => ({
      workItemId: line.workItemId,
      amount: toDecimal(line.allocatedCost).toFixed(2),
    }));

    // Whatever nobody attributed still left the account.
    if (remainder.greaterThan(0)) {
      bookings.push({ workItemId: null, amount: remainder.toFixed(2) });
    }

    if (bookings.length > 0) {
      await tx.insert(actualCosts).values(
        bookings.map((booking) => ({
          projectId,
          workItemId: booking.workItemId,
          category: 'LABOR' as const,
          costDate: header.workDate,
          amount: booking.amount,
          dailyLaborId,
          sourceRef: `Upah harian ${header.workDate}`,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'daily_labor',
      recordId: dailyLaborId,
      action: 'UPDATE',
      before: { status: header.status },
      after: { status: 'APPROVED', costLines: bookings.length },
      actorId: user.id,
    });
  });
}

export async function markDailyLaborPaid(
  user: SessionUser,
  projectId: string,
  dailyLaborId: string,
  input: { paidAt: string; paymentMethod: string | null; refNo: string | null },
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  await withUser(user.id, async (tx) => {
    const [header] = await tx
      .select({ status: dailyLabor.status })
      .from(dailyLabor)
      .where(and(eq(dailyLabor.id, dailyLaborId), eq(dailyLabor.projectId, projectId)))
      .limit(1);

    if (!header) throw notFound('Catatan upah harian tidak ditemukan.');
    if (header.status === 'DRAFT') {
      throw conflict(
        'Catatan ini belum disetujui.',
        'Setujui dulu hari kerjanya sebelum mencatat pembayaran.',
      );
    }

    await tx
      .update(dailyLabor)
      .set({
        status: 'PAID',
        paidAt: input.paidAt,
        paymentMethod: input.paymentMethod,
        refNo: input.refNo,
        updatedBy: user.id,
      })
      .where(eq(dailyLabor.id, dailyLaborId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'daily_labor',
      recordId: dailyLaborId,
      action: 'UPDATE',
      before: { status: header.status },
      after: { status: 'PAID', paidAt: input.paidAt },
      actorId: user.id,
    });
  });
}

export async function deleteDailyLabor(
  user: SessionUser,
  projectId: string,
  dailyLaborId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  await withUser(user.id, async (tx) => {
    const [header] = await tx
      .select({ status: dailyLabor.status })
      .from(dailyLabor)
      .where(and(eq(dailyLabor.id, dailyLaborId), eq(dailyLabor.projectId, projectId)))
      .limit(1);

    if (!header) throw notFound('Catatan upah harian tidak ditemukan.');
    if (header.status === 'PAID') {
      throw conflict(
        'Catatan yang sudah dibayar tidak dapat dihapus.',
        'Catatan pembayaran adalah bukti.',
      );
    }

    // The booked cost goes with it, through the foreign key.
    await tx.delete(dailyLabor).where(eq(dailyLabor.id, dailyLaborId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'daily_labor',
      recordId: dailyLaborId,
      action: 'DELETE',
      before: { status: header.status },
      after: null,
      actorId: user.id,
    });
  });
}

/** Kept for the list screen's default ordering. */
export const dailyLaborOrder = desc(dailyLabor.workDate);
