import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Every enum in the system, in one place, so the values that appear in the UI,
 * the Zod schemas and the database can never drift apart.
 */

// --- Organisation & access -------------------------------------------------
export const globalRoleEnum = pgEnum('global_role', ['ADMIN', 'MEMBER']);

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
export const progressStatusEnum = pgEnum('progress_status', [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
]);
export const checklistResultEnum = pgEnum('checklist_result', ['PASS', 'FAIL', 'NA']);

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
