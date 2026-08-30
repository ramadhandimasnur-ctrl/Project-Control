import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { withUser } from '@/db/context';
import {
  actualCosts,
  subcontractAdvances,
  subcontractCertificateLines,
  subcontractCertificates,
  subcontractItems,
  subcontracts,
} from '@/db/schema';
import { safeDivide, toDecimal, ZERO } from '@/lib/calc/decimal';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { canViewOrgCosts } from './org-access';
import { type SessionUser } from './session';

/**
 * Piecework and subcontracting — "borongan mandor".
 *
 * After material, this is the largest cash stream on a building site, and the
 * one most often run on paper. Three documents and one comparison:
 *
 *   the contract   what was agreed, item by item
 *   the advance    money paid before any of it was measured
 *   the certificate what was measured this period, at the agreed rate
 *
 * The comparison is the point of recording it here rather than in a notebook:
 * a foreman's certified value set against the labour the RAP budgeted for the
 * same work items. That is the number that says whether putting the work out
 * to piecework was cheaper than doing it in-house, and it cannot be produced
 * from either side alone.
 */

export type SubcontractRow = {
  id: string;
  partyName: string;
  scope: string | null;
  contractType: 'LUMPSUM' | 'UNIT_RATE';
  contractValue: string;
  retentionPercent: string;
  startDate: string | null;
  endDate: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  note: string | null;
  itemCount: number;
  /** Certified so far, across approved and paid certificates. */
  certifiedValue: string;
  advancesPaid: string;
  advancesRecouped: string;
  /** Advances paid but not yet recovered from a certificate. */
  advanceOutstanding: string;
  retentionHeld: string;
  netPaid: string;
  /** certifiedValue / contractValue. Null on a contract with no value. */
  completion: string | null;
};

export async function listSubcontracts(
  userId: string,
  projectId: string,
): Promise<{ rows: SubcontractRow[]; showCosts: boolean }> {
  await assertProjectAccess(userId, projectId, 'VIEWER');
  const showCosts = await canViewOrgCosts(userId);
  if (!showCosts) return { rows: [], showCosts };

  /*
   * One query. Every figure is an aggregate over a child table, and asking for
   * them separately would be four round trips for a list that is usually a
   * handful of rows.
   */
  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      id: string;
      party_name: string;
      scope: string | null;
      contract_type: 'LUMPSUM' | 'UNIT_RATE';
      contract_value: string;
      retention_percent: string;
      start_date: string | null;
      end_date: string | null;
      status: SubcontractRow['status'];
      note: string | null;
      item_count: number;
      certified: string;
      advances_paid: string;
      advances_recouped: string;
      retention_held: string;
      net_paid: string;
    }>(sql`
      SELECT
        s.id, s.party_name, s.scope, s.contract_type,
        s.contract_value::text, s.retention_percent::text,
        s.start_date::text, s.end_date::text, s.status, s.note,
        (SELECT count(*)::int FROM subcontract_items i WHERE i.subcontract_id = s.id) AS item_count,
        coalesce((SELECT sum(c.progress_value) FROM subcontract_certificates c
                  WHERE c.subcontract_id = s.id AND c.status <> 'DRAFT'), 0)::text AS certified,
        coalesce((SELECT sum(a.amount) FROM subcontract_advances a
                  WHERE a.subcontract_id = s.id), 0)::text AS advances_paid,
        coalesce((SELECT sum(c.advance_recouped) FROM subcontract_certificates c
                  WHERE c.subcontract_id = s.id AND c.status <> 'DRAFT'), 0)::text AS advances_recouped,
        coalesce((SELECT sum(c.retention_withheld) FROM subcontract_certificates c
                  WHERE c.subcontract_id = s.id AND c.status <> 'DRAFT'), 0)::text AS retention_held,
        coalesce((SELECT sum(c.net_payable) FROM subcontract_certificates c
                  WHERE c.subcontract_id = s.id AND c.status = 'PAID'), 0)::text AS net_paid
      FROM subcontracts s
      WHERE s.project_id = ${projectId}
      ORDER BY s.created_at
    `),
  );

  return {
    showCosts,
    rows: rows.map((row): SubcontractRow => {
      const contractValue = toDecimal(row.contract_value);
      const certified = toDecimal(row.certified);
      const paid = toDecimal(row.advances_paid);
      const recouped = toDecimal(row.advances_recouped);

      return {
        id: row.id,
        partyName: row.party_name,
        scope: row.scope,
        contractType: row.contract_type,
        contractValue: contractValue.toFixed(2),
        retentionPercent: row.retention_percent,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        note: row.note,
        itemCount: row.item_count,
        certifiedValue: certified.toFixed(2),
        advancesPaid: paid.toFixed(2),
        advancesRecouped: recouped.toFixed(2),
        // Never below zero: recovering more than was advanced is a data error,
        // and showing it as a negative debt would read as credit.
        advanceOutstanding: paid.minus(recouped).greaterThan(0)
          ? paid.minus(recouped).toFixed(2)
          : '0.00',
        retentionHeld: toDecimal(row.retention_held).toFixed(2),
        netPaid: toDecimal(row.net_paid).toFixed(2),
        completion: contractValue.isZero()
          ? null
          : (safeDivide(certified, contractValue)?.toFixed(4) ?? null),
      };
    }),
  };
}

export type SubcontractDetail = SubcontractRow & {
  items: {
    id: string;
    workItemId: string | null;
    workItemCode: string | null;
    description: string;
    qty: string;
    unitCode: string | null;
    unitRate: string;
    amount: string;
    /** Certified against this item so far, across every certificate. */
    certifiedQty: string;
    /** What the RAP budgeted in labour for the same work item. */
    rapLabourValue: string | null;
  }[];
  certificates: {
    id: string;
    certNo: string;
    certDate: string;
    periodLabel: string | null;
    progressValue: string;
    advanceRecouped: string;
    retentionWithheld: string;
    netPayable: string;
    status: 'DRAFT' | 'APPROVED' | 'PAID';
    paidAt: string | null;
    lineCount: number;
  }[];
  advances: { id: string; advanceDate: string; amount: string; note: string | null }[];
  /*
   * Certified against budgeted, for the work items this contract covers.
   *
   * Null when the contract names no work items — a lump sum for "site
   * clearance" cannot be compared against a budget line that does not exist,
   * and inventing a comparison there would be worse than admitting it.
   */
  vsRapLabour: { certified: string; budgeted: string; variance: string } | null;
};

export async function getSubcontract(
  userId: string,
  projectId: string,
  subcontractId: string,
): Promise<SubcontractDetail> {
  const { rows, showCosts } = await listSubcontracts(userId, projectId);
  const header = rows.find((row) => row.id === subcontractId);
  if (!header || !showCosts) throw notFound('Kontrak borongan tidak ditemukan.');

  const [items, certificates, advances] = await Promise.all([
    withUser(userId, (tx) =>
      tx.execute<{
        id: string;
        work_item_id: string | null;
        work_item_code: string | null;
        description: string;
        qty: string;
        unit_code: string | null;
        unit_rate: string;
        amount: string;
        certified_qty: string;
        rap_labour: string | null;
      }>(sql`
        SELECT
          i.id, i.work_item_id, wi.code AS work_item_code, i.description,
          i.qty::text, u.code AS unit_code, i.unit_rate::text, i.amount::text,
          coalesce((SELECT sum(l.qty) FROM subcontract_certificate_lines l
                    JOIN subcontract_certificates c ON c.id = l.certificate_id
                    WHERE l.subcontract_item_id = i.id AND c.status <> 'DRAFT'), 0)::text
            AS certified_qty,
          /*
           * The labour the execution budget carries for the same work item.
           * Read from the priced analysis rather than recomputed, so it is the
           * same figure RAB/RAP and the cost screens quote.
           */
          (SELECT sum(pl.eff_coef * coalesce(pl.price, 0))
                  * coalesce(wi.volume_rap, wi.volume)
           FROM (
             SELECT wir.work_item_id,
                    CASE WHEN wir.qty IS NULL THEN wir.coef * (1 + wir.waste_factor)
                         ELSE wir.qty / nullif(coalesce(wi2.volume_rap, wi2.volume), 0) END AS eff_coef,
                    pr.price
             FROM work_item_resources wir
             JOIN work_items wi2 ON wi2.id = wir.work_item_id
             LEFT JOIN LATERAL (
               SELECT rp.price FROM resource_prices rp
               WHERE rp.resource_id = wir.resource_id AND rp.price_type = 'RAP'
                 AND rp.effective_from <= CURRENT_DATE
                 AND (rp.project_id IS NULL OR rp.project_id = wi2.project_id)
               ORDER BY (rp.project_id IS NOT NULL) DESC, rp.effective_from DESC, rp.id DESC
               LIMIT 1
             ) pr ON true
             WHERE wir.estimate_type = 'RAP' AND wir.role = 'LABOR'
           ) pl
           WHERE pl.work_item_id = i.work_item_id)::text AS rap_labour
        FROM subcontract_items i
        LEFT JOIN work_items wi ON wi.id = i.work_item_id
        LEFT JOIN units u ON u.id = i.unit_id
        WHERE i.subcontract_id = ${subcontractId}
        ORDER BY i.created_at
      `),
    ),
    withUser(userId, (tx) =>
      tx
        .select({
          id: subcontractCertificates.id,
          certNo: subcontractCertificates.certNo,
          certDate: subcontractCertificates.certDate,
          progressValue: subcontractCertificates.progressValue,
          advanceRecouped: subcontractCertificates.advanceRecouped,
          retentionWithheld: subcontractCertificates.retentionWithheld,
          netPayable: subcontractCertificates.netPayable,
          status: subcontractCertificates.status,
          paidAt: subcontractCertificates.paidAt,
          periodId: subcontractCertificates.periodId,
          lineCount: sql<number>`(
            SELECT count(*)::int FROM subcontract_certificate_lines l
            WHERE l.certificate_id = subcontract_certificates.id
          )`,
          periodLabel: sql<string | null>`(
            SELECT p.label FROM schedule_periods p
            WHERE p.id = subcontract_certificates.period_id
          )`,
        })
        .from(subcontractCertificates)
        .where(eq(subcontractCertificates.subcontractId, subcontractId))
        .orderBy(desc(subcontractCertificates.certDate)),
    ),
    withUser(userId, (tx) =>
      tx
        .select()
        .from(subcontractAdvances)
        .where(eq(subcontractAdvances.subcontractId, subcontractId))
        .orderBy(asc(subcontractAdvances.advanceDate)),
    ),
  ]);

  const mappedItems = items.map((row) => ({
    id: row.id,
    workItemId: row.work_item_id,
    workItemCode: row.work_item_code,
    description: row.description,
    qty: row.qty,
    unitCode: row.unit_code,
    unitRate: row.unit_rate,
    amount: row.amount,
    certifiedQty: row.certified_qty,
    rapLabourValue: row.rap_labour,
  }));

  const budgeted = mappedItems.reduce(
    (acc, item) => (item.rapLabourValue === null ? acc : acc.plus(toDecimal(item.rapLabourValue))),
    ZERO,
  );
  const anyBudget = mappedItems.some((item) => item.rapLabourValue !== null);

  return {
    ...header,
    items: mappedItems,
    certificates: certificates.map((row) => ({
      id: row.id,
      certNo: row.certNo,
      certDate: row.certDate,
      periodLabel: row.periodLabel,
      progressValue: row.progressValue,
      advanceRecouped: row.advanceRecouped,
      retentionWithheld: row.retentionWithheld,
      netPayable: row.netPayable,
      status: row.status,
      paidAt: row.paidAt,
      lineCount: row.lineCount,
    })),
    advances: advances.map((row) => ({
      id: row.id,
      advanceDate: row.advanceDate,
      amount: row.amount,
      note: row.note,
    })),
    vsRapLabour: anyBudget
      ? {
          certified: header.certifiedValue,
          budgeted: budgeted.toFixed(2),
          variance: budgeted.minus(toDecimal(header.certifiedValue)).toFixed(2),
        }
      : null,
  };
}

export type SubcontractInput = {
  partyName: string;
  scope: string | null;
  contractType: 'LUMPSUM' | 'UNIT_RATE';
  contractValue: string;
  retentionPercent: string;
  startDate: string | null;
  endDate: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  note: string | null;
  items: {
    workItemId: string | null;
    description: string;
    qty: string;
    unitId: string | null;
    unitRate: string;
  }[];
};

export async function saveSubcontract(
  user: SessionUser,
  projectId: string,
  subcontractId: string | null,
  input: SubcontractInput,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  /*
   * Line amounts are derived, never taken from the form.
   *
   * A quantity, a rate and a total that were typed separately are three
   * chances to disagree, and the one a foreman argues from is whichever is
   * larger. Two are recorded; the third is arithmetic.
   */
  const items = input.items.map((item) => ({
    ...item,
    amount: toDecimal(item.qty).times(toDecimal(item.unitRate)).toFixed(2),
  }));

  const derivedValue = items.reduce((acc, item) => acc.plus(toDecimal(item.amount)), ZERO);

  /*
   * A unit-rate contract is worth the sum of its lines. A lump sum is worth
   * what was agreed, whatever the lines add up to — that is what "lump sum"
   * means, and forcing them to match would make the itemisation impossible to
   * use as a working breakdown.
   */
  const contractValue =
    input.contractType === 'UNIT_RATE' ? derivedValue.toFixed(2) : input.contractValue;

  return withUser(user.id, async (tx) => {
    let id = subcontractId;

    const header = {
      partyName: input.partyName,
      scope: input.scope,
      contractType: input.contractType,
      contractValue,
      retentionPercent: input.retentionPercent,
      startDate: input.startDate,
      endDate: input.endDate,
      status: input.status,
      note: input.note,
      updatedBy: user.id,
    };

    if (id === null) {
      const [created] = await tx
        .insert(subcontracts)
        .values({ ...header, projectId, createdBy: user.id })
        .returning({ id: subcontracts.id });
      if (!created) throw conflict('Kontrak borongan gagal dibuat.');
      id = created.id;
    } else {
      await tx
        .update(subcontracts)
        .set(header)
        .where(and(eq(subcontracts.id, id), eq(subcontracts.projectId, projectId)));

      /*
       * Items are replaced wholesale, and only while nothing has been
       * certified against them. Once a certificate exists, its lines point at
       * these rows; rewriting them would change what a signed document says
       * it measured.
       */
      const [certified] = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM subcontract_certificates
        WHERE subcontract_id = ${id} AND status <> 'DRAFT'
      `);

      if ((certified?.n ?? 0) > 0) {
        const changed = await tx.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM subcontract_items WHERE subcontract_id = ${id}
        `);
        if ((changed[0]?.n ?? 0) !== items.length) {
          throw conflict(
            'Rincian kontrak tidak dapat diubah setelah ada sertifikat yang disetujui.',
            'Batalkan sertifikatnya lebih dulu, atau buat kontrak baru untuk lingkup tambahan.',
          );
        }
      }

      await tx.delete(subcontractItems).where(eq(subcontractItems.subcontractId, id));
    }

    const parentId = id;
    if (items.length > 0) {
      await tx.insert(subcontractItems).values(
        items.map((item) => ({
          subcontractId: parentId,
          workItemId: item.workItemId,
          description: item.description,
          qty: item.qty,
          unitId: item.unitId,
          unitRate: item.unitRate,
          amount: item.amount,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'subcontracts',
      recordId: id,
      action: subcontractId === null ? 'INSERT' : 'UPDATE',
      before: null,
      after: { partyName: input.partyName, contractValue, items: items.length },
      actorId: user.id,
    });

    return { id: parentId };
  });
}

export async function recordAdvance(
  user: SessionUser,
  projectId: string,
  subcontractId: string,
  input: { advanceDate: string; amount: string; note: string | null },
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(subcontractAdvances)
      .values({
        subcontractId,
        advanceDate: input.advanceDate,
        amount: input.amount,
        note: input.note,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: subcontractAdvances.id });

    if (!created) throw conflict('Kasbon gagal dicatat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'subcontract_advances',
      recordId: created.id,
      action: 'INSERT',
      before: null,
      after: { amount: input.amount },
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function deleteAdvance(
  user: SessionUser,
  projectId: string,
  advanceId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  await withUser(user.id, async (tx) => {
    await tx.delete(subcontractAdvances).where(eq(subcontractAdvances.id, advanceId));
    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'subcontract_advances',
      recordId: advanceId,
      action: 'DELETE',
      before: null,
      after: null,
      actorId: user.id,
    });
  });
}

export type CertificateInput = {
  periodId: string;
  certNo: string;
  certDate: string;
  advanceRecouped: string;
  lines: { subcontractItemId: string; qty: string }[];
};

/**
 * Raises a certificate for one period.
 *
 * The value is measured, not typed: each line is a quantity against a contract
 * item, priced at the rate frozen from that item now. Retention comes off at
 * the contract percentage, and the advance recovery is bounded by what is
 * actually outstanding — recovering more than was ever advanced turns a debt
 * into a credit nobody agreed to.
 */
export async function createCertificate(
  user: SessionUser,
  projectId: string,
  subcontractId: string,
  input: CertificateInput,
): Promise<{ id: string; netPayable: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');
  const detail = await getSubcontract(user.id, projectId, subcontractId);

  if (input.lines.length === 0) {
    throw validation('Sertifikat harus memuat setidaknya satu baris yang diukur.');
  }

  const itemById = new Map(detail.items.map((item) => [item.id, item]));
  const lines = input.lines.map((line) => {
    const item = itemById.get(line.subcontractItemId);
    if (!item) throw notFound('Salah satu baris tidak ada di kontrak ini.');

    const qty = toDecimal(line.qty);
    const rate = toDecimal(item.unitRate);

    /*
     * Cumulative, not per certificate: the ceiling is the contract quantity
     * less everything already certified. Checked here rather than trusted to
     * the form, because the form does not know what other certificates exist.
     */
    const remaining = toDecimal(item.qty).minus(toDecimal(item.certifiedQty));
    if (qty.greaterThan(remaining)) {
      throw conflict(
        `"${item.description}" hanya menyisakan ${remaining.toString()} untuk disertifikasi.`,
        'Kurangi kuantitasnya, atau perbesar kontraknya lebih dulu.',
      );
    }

    return {
      subcontractItemId: item.id,
      workItemId: item.workItemId,
      description: item.description,
      qty: qty.toFixed(4),
      unitRate: rate.toFixed(2),
      amount: qty.times(rate).toFixed(2),
    };
  });

  const progressValue = lines.reduce((acc, line) => acc.plus(toDecimal(line.amount)), ZERO);
  const retention = progressValue.times(toDecimal(detail.retentionPercent));

  const requestedRecoup = toDecimal(input.advanceRecouped);
  const outstanding = toDecimal(detail.advanceOutstanding);
  if (requestedRecoup.greaterThan(outstanding)) {
    throw conflict(
      `Kasbon yang belum dikembalikan hanya ${outstanding.toFixed(2)}.`,
      'Potongan kasbon tidak boleh melebihi sisa yang belum dikembalikan.',
    );
  }

  const netPayable = progressValue.minus(retention).minus(requestedRecoup);
  if (netPayable.lessThan(0)) {
    throw conflict(
      'Potongan melebihi nilai pekerjaan yang disertifikasi.',
      'Kurangi potongan kasbon, atau tunda sebagiannya ke sertifikat berikutnya.',
    );
  }

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(subcontractCertificates)
      .values({
        subcontractId,
        periodId: input.periodId,
        certNo: input.certNo,
        certDate: input.certDate,
        progressValue: progressValue.toFixed(2),
        advanceRecouped: requestedRecoup.toFixed(2),
        retentionWithheld: retention.toFixed(2),
        netPayable: netPayable.toFixed(2),
        status: 'DRAFT',
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: subcontractCertificates.id });

    if (!created) throw conflict('Sertifikat gagal dibuat.');

    await tx.insert(subcontractCertificateLines).values(
      lines.map((line) => ({
        certificateId: created.id,
        subcontractItemId: line.subcontractItemId,
        workItemId: line.workItemId,
        description: line.description,
        qty: line.qty,
        unitRate: line.unitRate,
        amount: line.amount,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'subcontract_certificates',
      recordId: created.id,
      action: 'INSERT',
      before: null,
      after: {
        certNo: input.certNo,
        progressValue: progressValue.toFixed(2),
        netPayable: netPayable.toFixed(2),
      },
      actorId: user.id,
    });

    return { id: created.id, netPayable: netPayable.toFixed(2) };
  });
}

/**
 * Approves a certificate, and books what it certifies as cost.
 *
 * The booking is what connects piecework to cost control: without it the
 * project would show a foreman being paid and no work item bearing the
 * expense. Keyed on the certificate, so approving twice replaces the booking
 * rather than adding a second copy of it.
 */
export async function approveCertificate(
  user: SessionUser,
  projectId: string,
  certificateId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  await withUser(user.id, async (tx) => {
    const [header] = await tx.execute<{
      id: string;
      status: 'DRAFT' | 'APPROVED' | 'PAID';
      cert_no: string;
      cert_date: string;
      party_name: string;
    }>(sql`
      SELECT c.id, c.status, c.cert_no, c.cert_date::text, s.party_name
      FROM subcontract_certificates c
      JOIN subcontracts s ON s.id = c.subcontract_id
      WHERE c.id = ${certificateId} AND s.project_id = ${projectId}
    `);

    if (!header) throw notFound('Sertifikat tidak ditemukan.');
    if (header.status === 'PAID') {
      throw conflict('Sertifikat ini sudah dibayar dan tidak dapat diubah.');
    }

    await tx
      .update(subcontractCertificates)
      .set({ status: 'APPROVED', updatedBy: user.id })
      .where(eq(subcontractCertificates.id, certificateId));

    // Replaced, not added to: re-approving must not double the cost.
    await tx
      .delete(actualCosts)
      .where(eq(actualCosts.subcontractCertificateId, certificateId));

    const lines = await tx
      .select({
        workItemId: subcontractCertificateLines.workItemId,
        amount: subcontractCertificateLines.amount,
      })
      .from(subcontractCertificateLines)
      .where(eq(subcontractCertificateLines.certificateId, certificateId));

    if (lines.length > 0) {
      await tx.insert(actualCosts).values(
        lines.map((line) => ({
          projectId,
          workItemId: line.workItemId,
          category: 'SUBCON' as const,
          costDate: header.cert_date,
          amount: line.amount,
          subcontractCertificateId: certificateId,
          sourceRef: `${header.cert_no} — ${header.party_name}`,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'subcontract_certificates',
      recordId: certificateId,
      action: 'UPDATE',
      before: { status: header.status },
      after: { status: 'APPROVED', costLines: lines.length },
      actorId: user.id,
    });
  });
}

export async function markCertificatePaid(
  user: SessionUser,
  projectId: string,
  certificateId: string,
  paidAt: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  await withUser(user.id, async (tx) => {
    const [header] = await tx.execute<{ status: string }>(sql`
      SELECT c.status FROM subcontract_certificates c
      JOIN subcontracts s ON s.id = c.subcontract_id
      WHERE c.id = ${certificateId} AND s.project_id = ${projectId}
    `);

    if (!header) throw notFound('Sertifikat tidak ditemukan.');
    if (header.status === 'DRAFT') {
      throw conflict(
        'Sertifikat ini belum disetujui.',
        'Setujui dulu pengukurannya sebelum mencatat pembayaran.',
      );
    }

    await tx
      .update(subcontractCertificates)
      .set({ status: 'PAID', paidAt, updatedBy: user.id })
      .where(eq(subcontractCertificates.id, certificateId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'subcontract_certificates',
      recordId: certificateId,
      action: 'UPDATE',
      before: { status: header.status },
      after: { status: 'PAID', paidAt },
      actorId: user.id,
    });
  });
}

export async function deleteCertificate(
  user: SessionUser,
  projectId: string,
  certificateId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  await withUser(user.id, async (tx) => {
    const [header] = await tx.execute<{ status: string }>(sql`
      SELECT c.status FROM subcontract_certificates c
      JOIN subcontracts s ON s.id = c.subcontract_id
      WHERE c.id = ${certificateId} AND s.project_id = ${projectId}
    `);

    if (!header) throw notFound('Sertifikat tidak ditemukan.');
    if (header.status === 'PAID') {
      throw conflict(
        'Sertifikat yang sudah dibayar tidak dapat dihapus.',
        'Catatan pembayaran adalah bukti; buat koreksi lewat sertifikat berikutnya.',
      );
    }

    // The booked cost goes with it, through the foreign key.
    await tx.delete(subcontractCertificates).where(eq(subcontractCertificates.id, certificateId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'subcontract_certificates',
      recordId: certificateId,
      action: 'DELETE',
      before: { status: header.status },
      after: null,
      actorId: user.id,
    });
  });
}
