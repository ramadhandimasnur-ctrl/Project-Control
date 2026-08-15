import 'server-only';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import {
  cashAccounts,
  cashTransactions,
  materialTransactions,
  projects,
  purchaseItems,
  purchases,
  resources,
  suppliers,
  units,
  warehouses,
} from '@/db/schema';
import { type Decimal, toDecimal, toMoneyString, toQuantityString } from '@/lib/calc/decimal';
import { inventoryPosition, type InventoryMovement } from '@/lib/calc/inventory';
import { convertQuantity, type ConvertibleUnit } from '@/lib/calc/unit-conversion';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

/**
 * Purchasing, and the posting routine that turns a purchase into stock and
 * cash — charter section 5.8.
 *
 * Posting is the single most consequential operation in the system: it moves
 * inventory, re-prices the moving average and commits money, all of which must
 * agree with each other. Everything below happens inside one database
 * transaction, so a failure at any point leaves nothing behind. Stock that
 * appeared without a cash trail, or the reverse, would be undetectable later.
 */

export type PurchaseStatus = 'DRAFT' | 'POSTED' | 'VOID';

export type PurchaseLineInput = {
  resourceId: string;
  warehouseId: string;
  qty: string;
  unitId: string;
  unitPrice: string;
  discount?: string;
  note?: string | null;
};

export type PurchaseHeaderInput = {
  supplierId?: string | null;
  poNo?: string | null;
  invoiceNo?: string | null;
  purchaseDate: string;
  dueDate?: string | null;
  paidAt?: string | null;
  vatAmount?: string;
  note?: string | null;
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type PurchaseRow = {
  id: string;
  poNo: string | null;
  invoiceNo: string | null;
  supplierName: string | null;
  purchaseDate: string;
  dueDate: string | null;
  paidAt: string | null;
  status: PurchaseStatus;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  lineCount: number;
};

export async function listPurchases(userId: string, projectId: string): Promise<PurchaseRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await db
    .select({
      id: purchases.id,
      poNo: purchases.poNo,
      invoiceNo: purchases.invoiceNo,
      supplierName: suppliers.name,
      purchaseDate: purchases.purchaseDate,
      dueDate: purchases.dueDate,
      paidAt: purchases.paidAt,
      status: purchases.status,
      subtotal: purchases.subtotal,
      vatAmount: purchases.vatAmount,
      totalAmount: purchases.totalAmount,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(eq(purchases.projectId, projectId))
    .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt));

  if (rows.length === 0) return [];

  const counts = await db
    .select({ purchaseId: purchaseItems.purchaseId, id: purchaseItems.id })
    .from(purchaseItems)
    .where(
      inArray(
        purchaseItems.purchaseId,
        rows.map((r) => r.id),
      ),
    );

  const byPurchase = new Map<string, number>();
  for (const row of counts) {
    byPurchase.set(row.purchaseId, (byPurchase.get(row.purchaseId) ?? 0) + 1);
  }

  return rows.map((r) => ({ ...r, lineCount: byPurchase.get(r.id) ?? 0 }));
}

export type PurchaseDetailLine = {
  id: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  warehouseId: string;
  warehouseName: string;
  qty: string;
  unitId: string;
  unitCode: string;
  unitPrice: string;
  discount: string;
  amount: string;
  note: string | null;
};

export type PurchaseDetail = PurchaseRow & { lines: PurchaseDetailLine[]; note: string | null };

export async function getPurchase(
  userId: string,
  projectId: string,
  purchaseId: string,
): Promise<PurchaseDetail> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [header] = await db
    .select({
      id: purchases.id,
      poNo: purchases.poNo,
      invoiceNo: purchases.invoiceNo,
      supplierName: suppliers.name,
      purchaseDate: purchases.purchaseDate,
      dueDate: purchases.dueDate,
      paidAt: purchases.paidAt,
      status: purchases.status,
      subtotal: purchases.subtotal,
      vatAmount: purchases.vatAmount,
      totalAmount: purchases.totalAmount,
      note: purchases.note,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(and(eq(purchases.id, purchaseId), eq(purchases.projectId, projectId)))
    .limit(1);

  if (!header) throw notFound('Pembelian tidak ditemukan.');

  const lines = await db
    .select({
      id: purchaseItems.id,
      resourceId: purchaseItems.resourceId,
      resourceCode: resources.code,
      resourceName: resources.name,
      warehouseId: purchaseItems.warehouseId,
      warehouseName: warehouses.name,
      qty: purchaseItems.qty,
      unitId: purchaseItems.unitId,
      unitCode: units.code,
      unitPrice: purchaseItems.unitPrice,
      discount: purchaseItems.discount,
      amount: purchaseItems.amount,
      note: purchaseItems.note,
    })
    .from(purchaseItems)
    .innerJoin(resources, eq(resources.id, purchaseItems.resourceId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseItems.warehouseId))
    .innerJoin(units, eq(units.id, purchaseItems.unitId))
    .where(eq(purchaseItems.purchaseId, purchaseId))
    .orderBy(asc(resources.code));

  return { ...header, lineCount: lines.length, lines };
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

/** Line amount: qty x price − discount, never below zero. */
function lineAmount(line: PurchaseLineInput): Decimal {
  const gross = toDecimal(line.qty).times(toDecimal(line.unitPrice));
  const net = gross.minus(toDecimal(line.discount ?? 0));
  return net.isNegative() ? toDecimal(0) : net;
}

export async function saveDraftPurchase(
  user: SessionUser,
  projectId: string,
  purchaseId: string | null,
  header: PurchaseHeaderInput,
  lines: readonly PurchaseLineInput[],
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  if (lines.length === 0) {
    throw validation(
      'Pembelian harus memiliki setidaknya satu baris barang.',
      'Tambahkan barang yang dibeli sebelum menyimpan.',
    );
  }

  if (purchaseId !== null) {
    const [existing] = await db
      .select({ status: purchases.status })
      .from(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.projectId, projectId)))
      .limit(1);

    if (!existing) throw notFound('Pembelian tidak ditemukan.');
    if (existing.status !== 'DRAFT') {
      throw conflict(
        'Pembelian yang sudah di-POST atau dibatalkan tidak dapat diubah.',
        'Batalkan (VOID) pembelian ini lalu buat yang baru.',
      );
    }
  }

  await assertLinesBelongToProject(access.orgId, projectId, lines);

  const subtotal = lines.reduce<Decimal>((acc, line) => acc.plus(lineAmount(line)), toDecimal(0));
  const vat = toDecimal(header.vatAmount ?? 0);
  const total = subtotal.plus(vat);

  return withUser(user.id, async (tx) => {
    let id = purchaseId;

    const values = {
      projectId,
      supplierId: header.supplierId ?? null,
      poNo: header.poNo ?? null,
      invoiceNo: header.invoiceNo ?? null,
      purchaseDate: header.purchaseDate,
      dueDate: header.dueDate ?? null,
      paidAt: header.paidAt ?? null,
      note: header.note ?? null,
      subtotal: toMoneyString(subtotal),
      vatAmount: toMoneyString(vat),
      totalAmount: toMoneyString(total),
      updatedBy: user.id,
    };

    if (id === null) {
      const [created] = await tx
        .insert(purchases)
        .values({ ...values, status: 'DRAFT', createdBy: user.id })
        .returning({ id: purchases.id });
      if (!created) throw conflict('Pembelian gagal dibuat.');
      id = created.id;
    } else {
      await tx.update(purchases).set(values).where(eq(purchases.id, id));
      await tx.delete(purchaseItems).where(eq(purchaseItems.purchaseId, id));
    }

    await tx.insert(purchaseItems).values(
      lines.map((line) => ({
        purchaseId: id,
        resourceId: line.resourceId,
        warehouseId: line.warehouseId,
        qty: toQuantityString(line.qty),
        unitId: line.unitId,
        unitPrice: toMoneyString(line.unitPrice),
        discount: toMoneyString(line.discount ?? 0),
        amount: toMoneyString(lineAmount(line)),
        note: line.note ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'purchases',
      recordId: id,
      action: purchaseId === null ? 'INSERT' : 'UPDATE',
      after: { ...values, lineCount: lines.length },
      actorId: user.id,
    });

    return { id };
  });
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

export type PostingImpactLine = {
  resourceCode: string;
  resourceName: string;
  unitCode: string;
  /** Quantity in the resource's own unit, after conversion. */
  qtyIn: string;
  unitCost: string;
  averageBefore: string | null;
  averageAfter: string;
};

export type PostingImpact = {
  lines: PostingImpactLine[];
  cashOut: string | null;
  cashDate: string | null;
  cashAccountName: string | null;
  totalAmount: string;
};

/**
 * What posting will do, computed before anything is written.
 *
 * Charter section 6.5 asks the confirmation dialog to state the effect in
 * concrete terms — "stock +100 kg, cash out Rp1.620.000, average 15.500 →
 * 15.850" — rather than asking the user to approve an abstraction.
 */
export async function previewPurchasePosting(
  userId: string,
  projectId: string,
  purchaseId: string,
  cashAccountId?: string,
): Promise<PostingImpact> {
  await assertProjectAccess(userId, projectId, 'ENGINEER');

  const context = await loadPostingContext(projectId, purchaseId);
  const lines: PostingImpactLine[] = [];

  for (const line of context.lines) {
    const existing = await loadMovements(line.resourceId, line.warehouseId);
    const before = inventoryPosition(existing);

    const after = inventoryPosition([
      ...existing,
      {
        txnType: 'IN',
        qty: line.convertedQty,
        unitCost: line.unitCostPerResourceUnit,
        txnDate: context.purchase.purchaseDate,
        sequence: Number.MAX_SAFE_INTEGER,
      },
    ]);

    lines.push({
      resourceCode: line.resourceCode,
      resourceName: line.resourceName,
      unitCode: line.resourceUnitCode,
      qtyIn: toQuantityString(line.convertedQty),
      unitCost: toMoneyString(line.unitCostPerResourceUnit),
      averageBefore: before.qty.isZero() ? null : toMoneyString(before.averageCost),
      averageAfter: toMoneyString(after.averageCost),
    });
  }

  const cash = await resolveCashPlan(projectId, context.purchase, cashAccountId);

  return {
    lines,
    cashOut: cash === null ? null : toMoneyString(context.purchase.totalAmount),
    cashDate: cash?.date ?? null,
    cashAccountName: cash?.accountName ?? null,
    totalAmount: toMoneyString(context.purchase.totalAmount),
  };
}

export type PostResult = {
  movementsCreated: number;
  cashRecorded: boolean;
};

/**
 * Posts a purchase: stock in, cash out, audit — or nothing at all.
 *
 * Charter rule 5 and section 5.8. The three effects are written inside one
 * transaction precisely because they must never disagree, and the test suite
 * forces a failure mid-way to prove the rollback.
 */
export async function postPurchase(
  user: SessionUser,
  projectId: string,
  purchaseId: string,
  options: { cashAccountId?: string } = {},
): Promise<PostResult> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const context = await loadPostingContext(projectId, purchaseId);

  if (context.purchase.status !== 'DRAFT') {
    throw conflict(
      context.purchase.status === 'POSTED'
        ? 'Pembelian ini sudah di-POST.'
        : 'Pembelian yang sudah dibatalkan tidak dapat di-POST.',
      'Buat pembelian baru bila diperlukan.',
    );
  }

  const cash = await resolveCashPlan(projectId, context.purchase, options.cashAccountId);

  return withUser(user.id, async (tx) => {
    const now = new Date();

    await tx
      .update(purchases)
      .set({ status: 'POSTED', postedAt: now, postedBy: user.id, updatedBy: user.id })
      .where(eq(purchases.id, purchaseId));

    // 1. Stock in, one movement per line, priced at what was actually paid.
    for (const line of context.lines) {
      await tx.insert(materialTransactions).values({
        projectId,
        warehouseId: line.warehouseId,
        resourceId: line.resourceId,
        txnType: 'IN',
        txnDate: context.purchase.purchaseDate,
        qty: toQuantityString(line.convertedQty),
        unitId: line.resourceUnitId,
        unitCost: toMoneyString(line.unitCostPerResourceUnit),
        purchaseItemId: line.purchaseItemId,
        refNo: context.purchase.invoiceNo ?? context.purchase.poNo,
        createdBy: user.id,
        updatedBy: user.id,
      });
    }

    // 2. The moving average is derived from those movements, never stored, so
    //    there is nothing further to update — it has already changed.

    // 3. Cash out, only under PURCHASE_BASED recognition.
    if (cash !== null) {
      await tx.insert(cashTransactions).values({
        projectId,
        accountId: cash.accountId,
        txnDate: cash.date,
        direction: 'OUT',
        category: 'MATERIAL',
        amount: toMoneyString(context.purchase.totalAmount),
        sourceType: 'PURCHASE',
        sourceId: purchaseId,
        description: `Pembelian ${context.purchase.invoiceNo ?? context.purchase.poNo ?? ''}`.trim(),
        createdBy: user.id,
        updatedBy: user.id,
      });
    }

    // 4. Audit.
    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'purchases',
      recordId: purchaseId,
      action: 'UPDATE',
      before: { status: 'DRAFT' },
      after: {
        status: 'POSTED',
        movements: context.lines.length,
        cashRecorded: cash !== null,
        totalAmount: toMoneyString(context.purchase.totalAmount),
      },
      actorId: user.id,
    });

    return { movementsCreated: context.lines.length, cashRecorded: cash !== null };
  });
}

/**
 * Reverses a posted purchase.
 *
 * The original rows stay: the stock movement is voided rather than deleted and
 * the cash row likewise, so the ledger still shows what happened and when it
 * was undone (charter rule 6).
 */
export async function voidPurchase(
  user: SessionUser,
  projectId: string,
  purchaseId: string,
  reason: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  if (reason.trim() === '') {
    throw validation('Alasan pembatalan wajib diisi.', 'Jejak audit harus menjelaskan mengapa.');
  }

  const [purchase] = await db
    .select({ id: purchases.id, status: purchases.status })
    .from(purchases)
    .where(and(eq(purchases.id, purchaseId), eq(purchases.projectId, projectId)))
    .limit(1);

  if (!purchase) throw notFound('Pembelian tidak ditemukan.');
  if (purchase.status === 'VOID') throw conflict('Pembelian ini sudah dibatalkan.');

  await withUser(user.id, async (tx) => {
    await tx
      .update(purchases)
      .set({ status: 'VOID', voidReason: reason, updatedBy: user.id })
      .where(eq(purchases.id, purchaseId));

    const items = await tx
      .select({ id: purchaseItems.id })
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, purchaseId));

    if (items.length > 0) {
      await tx
        .update(materialTransactions)
        .set({ isVoid: true, voidReason: reason, voidedBy: user.id, voidedAt: new Date() })
        .where(
          inArray(
            materialTransactions.purchaseItemId,
            items.map((i) => i.id),
          ),
        );
    }

    await tx
      .update(cashTransactions)
      .set({ isVoid: true, voidReason: reason, updatedBy: user.id })
      .where(
        and(
          eq(cashTransactions.sourceType, 'PURCHASE'),
          eq(cashTransactions.sourceId, purchaseId),
        ),
      );

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'purchases',
      recordId: purchaseId,
      action: 'VOID',
      after: { reason },
      actorId: user.id,
    });
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type PostingLine = {
  purchaseItemId: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceUnitId: string;
  resourceUnitCode: string;
  warehouseId: string;
  /** Quantity expressed in the resource's own unit. */
  convertedQty: Decimal;
  /** Price per one resource unit, after any unit conversion. */
  unitCostPerResourceUnit: Decimal;
};

type PostingContext = {
  purchase: {
    status: PurchaseStatus;
    purchaseDate: string;
    dueDate: string | null;
    paidAt: string | null;
    totalAmount: string;
    invoiceNo: string | null;
    poNo: string | null;
  };
  lines: PostingLine[];
};

/**
 * Loads a purchase and converts every line into the resource's own unit.
 *
 * Buying cement by the sack while the catalogue counts kilograms is ordinary;
 * storing the movement in the purchase unit would make stock unaddable.
 */
async function loadPostingContext(
  projectId: string,
  purchaseId: string,
): Promise<PostingContext> {
  const [purchase] = await db
    .select({
      status: purchases.status,
      purchaseDate: purchases.purchaseDate,
      dueDate: purchases.dueDate,
      paidAt: purchases.paidAt,
      totalAmount: purchases.totalAmount,
      invoiceNo: purchases.invoiceNo,
      poNo: purchases.poNo,
    })
    .from(purchases)
    .where(and(eq(purchases.id, purchaseId), eq(purchases.projectId, projectId)))
    .limit(1);

  if (!purchase) throw notFound('Pembelian tidak ditemukan.');

  const rows = await db
    .select({
      purchaseItemId: purchaseItems.id,
      resourceId: purchaseItems.resourceId,
      warehouseId: purchaseItems.warehouseId,
      qty: purchaseItems.qty,
      unitPrice: purchaseItems.unitPrice,
      amount: purchaseItems.amount,
      purchaseUnitId: purchaseItems.unitId,
      resourceCode: resources.code,
      resourceName: resources.name,
      resourceUnitId: resources.unitId,
    })
    .from(purchaseItems)
    .innerJoin(resources, eq(resources.id, purchaseItems.resourceId))
    .where(eq(purchaseItems.purchaseId, purchaseId));

  if (rows.length === 0) {
    throw validation(
      'Pembelian ini tidak memiliki baris barang, sehingga tidak ada yang dapat di-POST.',
      'Tambahkan barang terlebih dahulu.',
    );
  }

  const unitIds = [...new Set(rows.flatMap((r) => [r.purchaseUnitId, r.resourceUnitId]))];
  const unitRows = await db
    .select({
      id: units.id,
      code: units.code,
      dimension: units.dimension,
      factorToBase: units.factorToBase,
    })
    .from(units)
    .where(inArray(units.id, unitIds));

  const unitById = new Map(unitRows.map((u) => [u.id, u]));

  const lines: PostingLine[] = rows.map((row) => {
    const from = unitById.get(row.purchaseUnitId);
    const to = unitById.get(row.resourceUnitId);

    if (!from || !to) {
      throw notFound(`Satuan untuk "${row.resourceName}" tidak ditemukan.`);
    }

    const conversion = convertQuantity(row.qty, toConvertible(from), toConvertible(to));
    if (!conversion.ok) {
      throw validation(
        `Baris "${row.resourceName}": ${conversion.message}`,
        conversion.hint ?? 'Perbaiki satuan pada baris pembelian ini.',
      );
    }

    // Price follows the quantity: the amount paid is fixed, so the per-unit
    // cost is recomputed against the converted quantity rather than carried
    // across unchanged.
    const perUnit = conversion.value.isZero()
      ? toDecimal(0)
      : toDecimal(row.amount).dividedBy(conversion.value);

    return {
      purchaseItemId: row.purchaseItemId,
      resourceId: row.resourceId,
      resourceCode: row.resourceCode,
      resourceName: row.resourceName,
      resourceUnitId: row.resourceUnitId,
      resourceUnitCode: to.code,
      warehouseId: row.warehouseId,
      convertedQty: conversion.value,
      unitCostPerResourceUnit: perUnit,
    };
  });

  return { purchase, lines };
}

function toConvertible(unit: {
  code: string;
  dimension: string;
  factorToBase: string;
}): ConvertibleUnit {
  return { code: unit.code, dimension: unit.dimension, factorToBase: unit.factorToBase };
}

async function loadMovements(
  resourceId: string,
  warehouseId: string,
): Promise<InventoryMovement[]> {
  const rows = await db
    .select({
      txnType: materialTransactions.txnType,
      qty: materialTransactions.qty,
      unitCost: materialTransactions.unitCost,
      txnDate: materialTransactions.txnDate,
      createdAt: materialTransactions.createdAt,
      isVoid: materialTransactions.isVoid,
    })
    .from(materialTransactions)
    .where(
      and(
        eq(materialTransactions.resourceId, resourceId),
        eq(materialTransactions.warehouseId, warehouseId),
        eq(materialTransactions.isVoid, false),
      ),
    )
    .orderBy(asc(materialTransactions.txnDate), asc(materialTransactions.createdAt));

  return rows.map((row, index) => ({
    txnType: row.txnType,
    qty: row.qty,
    unitCost: row.unitCost,
    txnDate: row.txnDate,
    sequence: index,
    isVoid: row.isVoid,
  }));
}

type CashPlan = { accountId: string; accountName: string; date: string };

/**
 * Decides whether posting also moves cash, and from which account.
 *
 * Under CONSUMPTION_BASED recognition a purchase is not yet a cost, so nothing
 * is written; the money is recognised when the material is issued.
 */
async function resolveCashPlan(
  projectId: string,
  purchase: PostingContext['purchase'],
  cashAccountId?: string,
): Promise<CashPlan | null> {
  const [project] = await db
    .select({ costRecognition: projects.costRecognition })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project || project.costRecognition !== 'PURCHASE_BASED') return null;

  const accounts = await db
    .select({ id: cashAccounts.id, name: cashAccounts.name })
    .from(cashAccounts)
    .where(eq(cashAccounts.projectId, projectId))
    .orderBy(asc(cashAccounts.name));

  if (accounts.length === 0) {
    throw validation(
      'Proyek ini belum memiliki akun kas, sehingga pembelian tidak dapat dicatat sebagai kas keluar.',
      'Tambahkan akun kas terlebih dahulu, atau ubah pengakuan biaya menjadi "saat pemakaian" di Pengaturan.',
    );
  }

  const chosen =
    cashAccountId === undefined ? accounts[0] : accounts.find((a) => a.id === cashAccountId);

  if (!chosen) throw notFound('Akun kas tidak ditemukan pada proyek ini.');

  return {
    accountId: chosen.id,
    accountName: chosen.name,
    // Cash leaves when it is actually paid; failing that, when it falls due;
    // failing that, on the purchase date itself.
    date: purchase.paidAt ?? purchase.dueDate ?? purchase.purchaseDate,
  };
}

async function assertLinesBelongToProject(
  orgId: string,
  projectId: string,
  lines: readonly PurchaseLineInput[],
): Promise<void> {
  const resourceIds = [...new Set(lines.map((l) => l.resourceId))];
  const warehouseIds = [...new Set(lines.map((l) => l.warehouseId))];

  const [foundResources, foundWarehouses] = await Promise.all([
    db
      .select({ id: resources.id })
      .from(resources)
      .where(and(inArray(resources.id, resourceIds), eq(resources.orgId, orgId))),
    db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(inArray(warehouses.id, warehouseIds), eq(warehouses.projectId, projectId))),
  ]);

  if (foundResources.length !== resourceIds.length) {
    throw notFound('Salah satu sumber daya tidak ditemukan di organisasi ini.');
  }
  if (foundWarehouses.length !== warehouseIds.length) {
    throw notFound('Salah satu gudang tidak ditemukan di proyek ini.');
  }
}
