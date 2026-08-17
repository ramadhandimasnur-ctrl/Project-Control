import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Every enum in the system, in one place, so the values that appear in the UI,
 * the Zod schemas and the database can never drift apart.
 */

// --- Organisation & access -------------------------------------------------
export const globalRoleEnum = pgEnum('global_role', ['ADMIN', 'MEMBER']);

/**
 * Where an account stands in the approval workflow.
 *
 * Distinct from `is_active`, which is the enforcement flag the RLS helpers and
 * the session read. A check constraint ties the two together so they cannot
 * drift: only ACTIVE is active.
 */
/**
 * `REMOVED` is not a heavier `DEACTIVATED`; it answers a different question.
 *
 * Deactivating suspends someone who still belongs here — the account keeps its
 * project memberships and its email, and switching it back on restores exactly
 * what was there. Removing says they have left the organisation: memberships
 * are gone and the sign-in credential is deleted, so the address is free for
 * whoever holds it next.
 *
 * The row itself survives either way. Every table records `created_by` and
 * `updated_by` against it, so deleting the person would blank the authorship of
 * their progress entries, their purchases and the addenda they approved — in a
 * system whose whole purpose is that every figure can be traced to someone.
 */
export const userStatusEnum = pgEnum('user_status', [
  'PENDING',
  'ACTIVE',
  'REJECTED',
  'DEACTIVATED',
  'REMOVED',
]);

export const projectRoleEnum = pgEnum('project_role', [
  'ADMIN',
  'PROJECT_MANAGER',
  'ENGINEER',
  'FIELD_USER',
  'VIEWER',
]);

// --- Project configuration -------------------------------------------------
export const periodTypeEnum = pgEnum('period_type', ['DAY', 'WEEK', 'MONTH']);
export const durationUnitEnum = pgEnum('duration_unit', ['DAY', 'WEEK', 'MONTH']);
export const weightBasisEnum = pgEnum('weight_basis', ['CONTRACT', 'RAB', 'RAP']);
export const costRecognitionEnum = pgEnum('cost_recognition', [
  'PURCHASE_BASED',
  'CONSUMPTION_BASED',
]);
export const projectStatusEnum = pgEnum('project_status', [
  'DRAFT',
  'ACTIVE',
  'ON_HOLD',
  'CLOSED',
]);

// --- Master data -----------------------------------------------------------
export const unitDimensionEnum = pgEnum('unit_dimension', [
  'LENGTH',
  'AREA',
  'VOLUME',
  'MASS',
  'COUNT',
  'TIME',
  'LUMPSUM',
]);

/** Full resource taxonomy, including cost-only buckets such as OVERHEAD. */
export const resourceTypeEnum = pgEnum('resource_type', [
  'LABOR',
  'MATERIAL',
  'EQUIPMENT',
  'SUBCON',
  'PACKAGE',
  'OVERHEAD',
]);

/**
 * The subset of resource types that may appear as a line inside an AHSP
 * breakdown (sections A TENAGA / B MATERIAL / C ALAT / D PAKET).
 * OVERHEAD is deliberately absent: it is a project cost, not a unit-rate input.
 */
export const ahspRoleEnum = pgEnum('ahsp_role', [
  'LABOR',
  'MATERIAL',
  'EQUIPMENT',
  'SUBCON',
  'PACKAGE',
]);

export const priceTypeEnum = pgEnum('price_type', ['RAB', 'RAP']);

// --- Work breakdown & progress --------------------------------------------
export const progressMethodEnum = pgEnum('progress_method', ['VOLUME', 'PERCENT', 'MILESTONE']);
export const dependencyTypeEnum = pgEnum('dependency_type', ['FS', 'SS', 'FF', 'SF']);
/**
 * CANCELLED is withdrawal, not rejection.
 *
 * REJECTED is a supervisor sending work back; CANCELLED is the recorder
 * retracting their own entry — a wrong work item, a duplicate, a figure typed
 * against the wrong period. Both stop counting toward the realised curve, and
 * keeping them apart is what lets a report say whether the site was corrected
 * or merely mistyped.
 */
export const progressStatusEnum = pgEnum('progress_status', [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);
export const checklistResultEnum = pgEnum('checklist_result', ['PASS', 'FAIL', 'NA']);

/**
 * A change order is drafted, then approved or abandoned.
 *
 * Cancelled rather than deleted: a revision that was proposed and turned down
 * is part of how the contract got to where it is, and the sequence numbers
 * would otherwise be reused and stop matching the paperwork.
 */
export const contractRevisionStatusEnum = pgEnum('contract_revision_status', [
  'DRAFT',
  'APPROVED',
  'CANCELLED',
]);

// --- Purchasing & inventory -----------------------------------------------
export const purchaseStatusEnum = pgEnum('purchase_status', ['DRAFT', 'POSTED', 'VOID']);
export const materialTxnTypeEnum = pgEnum('material_txn_type', [
  'IN',
  'OUT',
  'ADJUSTMENT',
  'RETURN',
  'TRANSFER',
]);

// --- Subcontracting --------------------------------------------------------
export const subcontractTypeEnum = pgEnum('subcontract_type', ['LUMPSUM', 'UNIT_RATE']);
export const subcontractStatusEnum = pgEnum('subcontract_status', [
  'DRAFT',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
]);
export const certificateStatusEnum = pgEnum('certificate_status', ['DRAFT', 'APPROVED', 'PAID']);

// --- Cash, billing & terms -------------------------------------------------
export const cashAccountTypeEnum = pgEnum('cash_account_type', ['CASH', 'BANK']);
export const termTypeEnum = pgEnum('term_type', [
  'DOWN_PAYMENT',
  'PROGRESS',
  'MILESTONE',
  'RETENTION',
]);
export const paymentTermStatusEnum = pgEnum('payment_term_status', [
  'PLANNED',
  'CLAIMED',
  'INVOICED',
  'PAID',
]);
export const claimStatusEnum = pgEnum('claim_status', ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID']);
export const cashDirectionEnum = pgEnum('cash_direction', ['IN', 'OUT']);
export const cashCategoryEnum = pgEnum('cash_category', [
  // inflow
  'DOWN_PAYMENT',
  'TERMIN',
  'RETENTION_RELEASE',
  'OTHER_IN',
  // outflow
  'MATERIAL',
  'LABOR',
  'EQUIPMENT',
  'SUBCON',
  'OPERATIONAL',
  'TAX',
  'OTHER_OUT',
]);
export const cashSourceTypeEnum = pgEnum('cash_source_type', [
  'MANUAL',
  'PURCHASE',
  'SUBCON_PAYMENT',
  'PAYMENT_CLAIM',
  'PAYROLL',
]);

// --- Reporting & audit -----------------------------------------------------
export const reportTypeEnum = pgEnum('report_type', ['DAILY', 'WEEKLY', 'MONTHLY']);
export const issueSeverityEnum = pgEnum('issue_severity', ['LOW', 'MEDIUM', 'HIGH']);
export const issueStatusEnum = pgEnum('issue_status', ['OPEN', 'IN_PROGRESS', 'CLOSED']);
export const auditActionEnum = pgEnum('audit_action', ['INSERT', 'UPDATE', 'DELETE', 'VOID']);

/**
 * The three columns at the foot of a printed report.
 *
 * The slot is the role the column plays, not the person filling it — the
 * middle column stays "checked by" when the checker changes.
 */
export const signatorySlotEnum = pgEnum('signatory_slot', [
  'PREPARED_BY',
  'CHECKED_BY',
  'APPROVED_BY',
]);
