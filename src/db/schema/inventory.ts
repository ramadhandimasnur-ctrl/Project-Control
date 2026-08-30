import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { day, money, percent, primaryId, quantity } from './_shared';
import { materialTxnTypeEnum, purchaseStatusEnum } from './enums';
import { auditColumns, organizations, users } from './org';
import { projects } from './projects';
import { resources, suppliers, units } from './resources';
import { workItems } from './work';

export const warehouses = pgTable(
  'warehouses',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /*
     * Null means the organisation's own store, shared between projects.
     *
     * Buying in bulk for several sites is ordinary, and a warehouse that had to
     * belong to exactly one project made a lorry-load of cement split three
     * ways into three entries at three guessed quantities. What arrives at a
     * central store is recorded once and handed out as it is needed.
     */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Where it physically stands, e.g. "Halaman belakang, dekat pos jaga". */
    location: text('location'),
    city: text('city'),
    address: text('address'),
    isDefault: boolean('is_default').notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('warehouses_project_name_unique').on(t.projectId, t.name),
    uniqueIndex('warehouses_one_default')
      .on(t.projectId)
      .where(sql`${t.isDefault}`),
  ],
);

export const purchases = pgTable(
  'purchases',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),

    poNo: text('po_no'),
    invoiceNo: text('invoice_no'),
    purchaseDate: day('purchase_date').notNull(),
    dueDate: day('due_date'),
    paidAt: day('paid_at'),

    status: purchaseStatusEnum('status').notNull().default('DRAFT'),

    subtotal: money('subtotal').notNull().default('0'),
    vatAmount: money('vat_amount').notNull().default('0'),
    totalAmount: money('total_amount').notNull().default('0'),

    note: text('note'),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
    postedBy: uuid('posted_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
    ...auditColumns(),
  },
  (t) => [
    index('purchases_project_idx').on(t.projectId, t.purchaseDate),
    index('purchases_status_idx').on(t.projectId, t.status),
    check(
      'purchases_amounts_nonneg',
      sql`${t.subtotal} >= 0 AND ${t.vatAmount} >= 0 AND ${t.totalAmount} >= 0`,
    ),
    check('purchases_due_after_purchase', sql`${t.dueDate} IS NULL OR ${t.dueDate} >= ${t.purchaseDate}`),
  ],
);

export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: primaryId(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    qty: quantity('qty').notNull(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    /** The *actual* price paid. This never writes back to `resource_prices`. */
    unitPrice: money('unit_price').notNull(),
    discount: money('discount').notNull().default('0'),
    amount: money('amount').notNull().default('0'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    index('purchase_items_purchase_idx').on(t.purchaseId),
    index('purchase_items_resource_idx').on(t.resourceId),
    check('purchase_items_qty_positive', sql`${t.qty} > 0`),
    check(
      'purchase_items_money_nonneg',
      sql`${t.unitPrice} >= 0 AND ${t.discount} >= 0 AND ${t.amount} >= 0`,
    ),
  ],
);

/**
 * Warehouse ledger — semi-immutable and append-only.
 *
 * `qty`, `unit_cost`, `txn_date` and `resource_id` cannot be UPDATEd once the
 * row exists (enforced by a trigger in the migration). Corrections are made by
 * voiding the row or posting an ADJUSTMENT, so the moving-average history
 * always reconstructs identically.
 */
export const materialTransactions = pgTable(
  'material_transactions',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),

    txnType: materialTxnTypeEnum('txn_type').notNull(),
    txnDate: day('txn_date').notNull(),
    /**
     * Positive for every type except ADJUSTMENT, whose sign carries its own
     * direction. A stock count that finds less than the books claim has to be
     * recordable, and OUT cannot serve: it requires a work item to charge,
     * while shrinkage belongs to no work item at all.
     */
    qty: quantity('qty').notNull(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    unitCost: money('unit_cost'),

    /** Required for OUT — issuing material must always name its consumer. */
    workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'restrict' }),
    purchaseItemId: uuid('purchase_item_id').references(() => purchaseItems.id, {
      onDelete: 'restrict',
    }),

    refNo: text('ref_no'),
    note: text('note'),

    isVoid: boolean('is_void').notNull().default(false),
    voidReason: text('void_reason'),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidedAt: timestamp('voided_at', { withTimezone: true, mode: 'date' }),
    ...auditColumns(),
  },
  (t) => [
    // The moving-average walk orders by (txn_date, created_at) per resource.
    index('material_transactions_balance_idx').on(
      t.projectId,
      t.warehouseId,
      t.resourceId,
      t.txnDate,
      t.createdAt,
    ),
    index('material_transactions_work_item_idx').on(t.workItemId),
    index('material_transactions_purchase_item_idx').on(t.purchaseItemId),
    check(
      'material_transactions_qty_valid',
      sql`${t.qty} <> 0 AND (${t.qty} > 0 OR ${t.txnType} = 'ADJUSTMENT')`,
    ),
    check(
      'material_transactions_unit_cost_nonneg',
      sql`${t.unitCost} IS NULL OR ${t.unitCost} >= 0`,
    ),
    check(
      'material_transactions_out_needs_work_item',
      sql`${t.txnType} <> 'OUT' OR ${t.workItemId} IS NOT NULL`,
    ),
    check(
      'material_transactions_void_has_reason',
      sql`${t.isVoid} = false OR ${t.voidReason} IS NOT NULL`,
    ),
  ],
);


/**
 * Goods arriving at a central store.
 *
 * Carries its own terms, because a bulk order is invoiced to the company and
 * not to a site: it falls due whatever any one project happens to be doing.
 * Project purchases keep using `purchases`, which knows about work items and
 * project costing; this knows about neither, on purpose.
 */
export const warehouseReceipts = pgTable(
  'warehouse_receipts',
  {
    id: primaryId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    docNo: text('doc_no'),
    receiptDate: day('receipt_date').notNull(),
    qty: quantity('qty').notNull(),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'restrict' }),
    unitPrice: money('unit_price').notNull().default('0'),
    vatPercent: percent('vat_percent').notNull().default('0'),
    totalAmount: money('total_amount').notNull().default('0'),
    dueDate: day('due_date'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    index('warehouse_receipts_warehouse_idx').on(t.warehouseId, t.receiptDate),
    check('warehouse_receipts_qty_positive', sql`${t.qty} > 0`),
    check(
      'warehouse_receipts_amounts_nonneg',
      sql`${t.unitPrice} >= 0 AND ${t.totalAmount} >= 0`,
    ),
    check(
      'warehouse_receipts_due_after_receipt',
      sql`${t.dueDate} IS NULL OR ${t.dueDate} >= ${t.receiptDate}`,
    ),
  ],
);

/**
 * Central stock handed to a project.
 *
 * Issuing writes an ordinary IN movement on the receiving project's own
 * warehouse — which is where material planning, stock and costing already
 * look — and the movement's id is kept here. The two cannot drift, and undoing
 * one undoes the other.
 */
export const warehouseAllocations = pgTable(
  'warehouse_allocations',
  {
    id: primaryId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    allocatedOn: day('allocated_on').notNull(),
    qty: quantity('qty').notNull(),
    unitCost: money('unit_cost').notNull().default('0'),
    materialTransactionId: uuid('material_transaction_id').references(
      () => materialTransactions.id,
      { onDelete: 'set null' },
    ),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    index('warehouse_allocations_warehouse_idx').on(t.warehouseId, t.allocatedOn),
    index('warehouse_allocations_project_idx').on(t.projectId),
    check('warehouse_allocations_qty_positive', sql`${t.qty} > 0`),
  ],
);
