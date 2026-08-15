CREATE TYPE "public"."ahsp_role" AS ENUM('LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCON', 'PACKAGE');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('INSERT', 'UPDATE', 'DELETE', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."cash_account_type" AS ENUM('CASH', 'BANK');--> statement-breakpoint
CREATE TYPE "public"."cash_category" AS ENUM('DOWN_PAYMENT', 'TERMIN', 'RETENTION_RELEASE', 'OTHER_IN', 'MATERIAL', 'LABOR', 'EQUIPMENT', 'SUBCON', 'OPERATIONAL', 'TAX', 'OTHER_OUT');--> statement-breakpoint
CREATE TYPE "public"."cash_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."cash_source_type" AS ENUM('MANUAL', 'PURCHASE', 'SUBCON_PAYMENT', 'PAYMENT_CLAIM', 'PAYROLL');--> statement-breakpoint
CREATE TYPE "public"."certificate_status" AS ENUM('DRAFT', 'APPROVED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."checklist_result" AS ENUM('PASS', 'FAIL', 'NA');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."cost_recognition" AS ENUM('PURCHASE_BASED', 'CONSUMPTION_BASED');--> statement-breakpoint
CREATE TYPE "public"."dependency_type" AS ENUM('FS', 'SS', 'FF', 'SF');--> statement-breakpoint
CREATE TYPE "public"."duration_unit" AS ENUM('DAY', 'WEEK', 'MONTH');--> statement-breakpoint
CREATE TYPE "public"."global_role" AS ENUM('ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('OPEN', 'IN_PROGRESS', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."material_txn_type" AS ENUM('IN', 'OUT', 'ADJUSTMENT', 'RETURN', 'TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."payment_term_status" AS ENUM('PLANNED', 'CLAIMED', 'INVOICED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('DAY', 'WEEK', 'MONTH');--> statement-breakpoint
CREATE TYPE "public"."price_type" AS ENUM('RAB', 'RAP');--> statement-breakpoint
CREATE TYPE "public"."progress_method" AS ENUM('VOLUME', 'PERCENT', 'MILESTONE');--> statement-breakpoint
CREATE TYPE "public"."progress_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('ADMIN', 'PROJECT_MANAGER', 'ENGINEER', 'FIELD_USER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('DRAFT', 'ACTIVE', 'ON_HOLD', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('DRAFT', 'POSTED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCON', 'PACKAGE', 'OVERHEAD');--> statement-breakpoint
CREATE TYPE "public"."subcontract_status" AS ENUM('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."subcontract_type" AS ENUM('LUMPSUM', 'UNIT_RATE');--> statement-breakpoint
CREATE TYPE "public"."term_type" AS ENUM('DOWN_PAYMENT', 'PROGRESS', 'MILESTONE', 'RETENTION');--> statement-breakpoint
CREATE TYPE "public"."unit_dimension" AS ENUM('LENGTH', 'AREA', 'VOLUME', 'MASS', 'COUNT', 'TIME', 'LUMPSUM');--> statement-breakpoint
CREATE TYPE "public"."weight_basis" AS ENUM('CONTRACT', 'RAB', 'RAP');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"global_role" "global_role" DEFAULT 'MEMBER' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "project_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contract_no" text,
	"owner_name" text,
	"contractor_name" text,
	"location" text,
	"project_type" text,
	"contract_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"duration" integer,
	"duration_unit" "duration_unit" DEFAULT 'DAY' NOT NULL,
	"period_type" "period_type" DEFAULT 'WEEK' NOT NULL,
	"retention_percent" numeric(9, 6) DEFAULT '0' NOT NULL,
	"retention_release_days" integer DEFAULT 0 NOT NULL,
	"vat_percent" numeric(9, 6) DEFAULT '0' NOT NULL,
	"wht_percent" numeric(9, 6) DEFAULT '0' NOT NULL,
	"progress_weight_basis" "weight_basis" DEFAULT 'CONTRACT' NOT NULL,
	"cost_recognition" "cost_recognition" DEFAULT 'PURCHASE_BASED' NOT NULL,
	"default_markup" numeric(9, 6) DEFAULT '0' NOT NULL,
	"threshold_warning" numeric(9, 6) DEFAULT '-0.005' NOT NULL,
	"threshold_delayed" numeric(9, 6) DEFAULT '-0.05' NOT NULL,
	"require_checklist_before_approve" boolean DEFAULT true NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"status" "project_status" DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "projects_period_valid" CHECK ("projects"."end_date" >= "projects"."start_date"),
	CONSTRAINT "projects_contract_value_nonneg" CHECK ("projects"."contract_value" >= 0),
	CONSTRAINT "projects_rates_nonneg" CHECK ("projects"."retention_percent" >= 0 AND "projects"."vat_percent" >= 0 AND "projects"."wht_percent" >= 0 AND "projects"."default_markup" >= 0),
	CONSTRAINT "projects_lag_days_nonneg" CHECK ("projects"."retention_release_days" >= 0),
	CONSTRAINT "projects_threshold_order" CHECK ("projects"."threshold_warning" >= "projects"."threshold_delayed")
);
--> statement-breakpoint
CREATE TABLE "resource_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "resource_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "resource_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"project_id" uuid,
	"price_type" "price_type" NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"source" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "resource_prices_nonneg" CHECK ("resource_prices"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"spec" text,
	"category_id" uuid,
	"unit_id" uuid NOT NULL,
	"type" "resource_type" NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "resources_lead_time_nonneg" CHECK ("resources"."lead_time_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"address" text,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "suppliers_credit_days_nonneg" CHECK ("suppliers"."credit_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"dimension" "unit_dimension" NOT NULL,
	"base_unit_id" uuid,
	"factor_to_base" numeric(18, 6) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "units_factor_positive" CHECK ("units"."factor_to_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "ahsp_template_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"role" "ahsp_role" NOT NULL,
	"coef_rab" numeric(18, 6) DEFAULT '0' NOT NULL,
	"coef_rap" numeric(18, 6) DEFAULT '0' NOT NULL,
	"waste_factor" numeric(9, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ahsp_template_resources_nonneg" CHECK ("ahsp_template_resources"."coef_rab" >= 0 AND "ahsp_template_resources"."coef_rap" >= 0 AND "ahsp_template_resources"."waste_factor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ahsp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "volume_takeoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"label" text NOT NULL,
	"expression" text,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "work_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "work_item_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weight" numeric(9, 6) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "work_item_milestones_weight_range" CHECK ("work_item_milestones"."weight" >= 0 AND "work_item_milestones"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "work_item_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"role" "ahsp_role" NOT NULL,
	"coef_rab" numeric(18, 6) DEFAULT '0' NOT NULL,
	"coef_rap" numeric(18, 6) DEFAULT '0' NOT NULL,
	"waste_factor" numeric(9, 6) DEFAULT '0' NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "work_item_resources_nonneg" CHECK ("work_item_resources"."coef_rab" >= 0 AND "work_item_resources"."coef_rap" >= 0 AND "work_item_resources"."waste_factor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"spec" text,
	"unit_id" uuid NOT NULL,
	"volume" numeric(18, 4) DEFAULT '0' NOT NULL,
	"contract_unit_price" numeric(18, 2),
	"progress_method" "progress_method" DEFAULT 'VOLUME' NOT NULL,
	"include_in_progress_weight" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "work_items_volume_nonneg" CHECK ("work_items"."volume" >= 0),
	CONSTRAINT "work_items_contract_unit_price_nonneg" CHECK ("work_items"."contract_unit_price" IS NULL OR "work_items"."contract_unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "baseline_distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"baseline_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"planned_pct" numeric(9, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baseline_distributions_range" CHECK ("baseline_distributions"."planned_pct" >= 0 AND "baseline_distributions"."planned_pct" <= 1)
);
--> statement-breakpoint
CREATE TABLE "planned_distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"planned_pct" numeric(9, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "planned_distributions_range" CHECK ("planned_distributions"."planned_pct" >= 0 AND "planned_distributions"."planned_pct" <= 1)
);
--> statement-breakpoint
CREATE TABLE "schedule_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"baselined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"baselined_by" uuid,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "schedule_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"period_type" "period_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "schedule_periods_seq_positive" CHECK ("schedule_periods"."seq" >= 1),
	CONSTRAINT "schedule_periods_range_valid" CHECK ("schedule_periods"."end_date" >= "schedule_periods"."start_date")
);
--> statement-breakpoint
CREATE TABLE "work_item_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"planned_start" date,
	"planned_finish" date,
	"duration_days" integer,
	"predecessor_id" uuid,
	"dependency_type" "dependency_type" DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "work_item_schedules_range_valid" CHECK ("work_item_schedules"."planned_start" IS NULL OR "work_item_schedules"."planned_finish" IS NULL OR "work_item_schedules"."planned_finish" >= "work_item_schedules"."planned_start"),
	CONSTRAINT "work_item_schedules_duration_nonneg" CHECK ("work_item_schedules"."duration_days" IS NULL OR "work_item_schedules"."duration_days" >= 0),
	CONSTRAINT "work_item_schedules_no_self_dependency" CHECK ("work_item_schedules"."predecessor_id" <> "work_item_schedules"."work_item_id")
);
--> statement-breakpoint
CREATE TABLE "progress_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"progress_entry_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"caption" text,
	"taken_at" timestamp with time zone,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"qty_this_period" numeric(18, 4) DEFAULT '0' NOT NULL,
	"pct_this_period" numeric(9, 6) DEFAULT '0' NOT NULL,
	"method" "progress_method" NOT NULL,
	"status" "progress_status" DEFAULT 'DRAFT' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"reject_reason" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "progress_entries_qty_nonneg" CHECK ("progress_entries"."qty_this_period" >= 0),
	CONSTRAINT "progress_entries_pct_range" CHECK ("progress_entries"."pct_this_period" >= 0 AND "progress_entries"."pct_this_period" <= 1)
);
--> statement-breakpoint
CREATE TABLE "work_item_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"period_id" uuid,
	"as_drawing" "checklist_result" DEFAULT 'NA' NOT NULL,
	"position" "checklist_result" DEFAULT 'NA' NOT NULL,
	"dimension" "checklist_result" DEFAULT 'NA' NOT NULL,
	"verdict" "checklist_result" GENERATED ALWAYS AS (CASE
            WHEN as_drawing = 'FAIL' OR position = 'FAIL' OR dimension = 'FAIL' THEN 'FAIL'
            WHEN as_drawing = 'PASS' AND position = 'PASS' AND dimension = 'PASS' THEN 'PASS'
            ELSE 'NA'
          END::checklist_result) STORED,
	"checked_at" date,
	"checked_by" uuid,
	"note" text,
	"photo_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "material_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"txn_type" "material_txn_type" NOT NULL,
	"txn_date" date NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit_id" uuid NOT NULL,
	"unit_cost" numeric(18, 2),
	"work_item_id" uuid,
	"purchase_item_id" uuid,
	"ref_no" text,
	"note" text,
	"is_void" boolean DEFAULT false NOT NULL,
	"void_reason" text,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "material_transactions_qty_positive" CHECK ("material_transactions"."qty" > 0),
	CONSTRAINT "material_transactions_unit_cost_nonneg" CHECK ("material_transactions"."unit_cost" IS NULL OR "material_transactions"."unit_cost" >= 0),
	CONSTRAINT "material_transactions_out_needs_work_item" CHECK ("material_transactions"."txn_type" <> 'OUT' OR "material_transactions"."work_item_id" IS NOT NULL),
	CONSTRAINT "material_transactions_void_has_reason" CHECK ("material_transactions"."is_void" = false OR "material_transactions"."void_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit_id" uuid NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "purchase_items_qty_positive" CHECK ("purchase_items"."qty" > 0),
	CONSTRAINT "purchase_items_money_nonneg" CHECK ("purchase_items"."unit_price" >= 0 AND "purchase_items"."discount" >= 0 AND "purchase_items"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_id" uuid,
	"po_no" text,
	"invoice_no" text,
	"purchase_date" date NOT NULL,
	"due_date" date,
	"paid_at" date,
	"status" "purchase_status" DEFAULT 'DRAFT' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "purchases_amounts_nonneg" CHECK ("purchases"."subtotal" >= 0 AND "purchases"."vat_amount" >= 0 AND "purchases"."total_amount" >= 0),
	CONSTRAINT "purchases_due_after_purchase" CHECK ("purchases"."due_date" IS NULL OR "purchases"."due_date" >= "purchases"."purchase_date")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "subcontract_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subcontract_id" uuid NOT NULL,
	"advance_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "subcontract_advances_amount_positive" CHECK ("subcontract_advances"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "subcontract_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subcontract_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"cert_no" text NOT NULL,
	"cert_date" date NOT NULL,
	"progress_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"advance_recouped" numeric(18, 2) DEFAULT '0' NOT NULL,
	"retention_withheld" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_payable" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "certificate_status" DEFAULT 'DRAFT' NOT NULL,
	"paid_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "subcontract_certificates_nonneg" CHECK ("subcontract_certificates"."progress_value" >= 0 AND "subcontract_certificates"."advance_recouped" >= 0 AND "subcontract_certificates"."retention_withheld" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subcontract_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subcontract_id" uuid NOT NULL,
	"work_item_id" uuid,
	"description" text NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_id" uuid,
	"unit_rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "subcontract_items_nonneg" CHECK ("subcontract_items"."qty" >= 0 AND "subcontract_items"."unit_rate" >= 0 AND "subcontract_items"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subcontracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"party_name" text NOT NULL,
	"scope" text,
	"contract_type" "subcontract_type" DEFAULT 'LUMPSUM' NOT NULL,
	"contract_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"retention_percent" numeric(9, 6) DEFAULT '0' NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" "subcontract_status" DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "subcontracts_value_nonneg" CHECK ("subcontracts"."contract_value" >= 0),
	CONSTRAINT "subcontracts_retention_range" CHECK ("subcontracts"."retention_percent" >= 0 AND "subcontracts"."retention_percent" <= 1),
	CONSTRAINT "subcontracts_period_valid" CHECK ("subcontracts"."start_date" IS NULL OR "subcontracts"."end_date" IS NULL OR "subcontracts"."end_date" >= "subcontracts"."start_date")
);
--> statement-breakpoint
CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "cash_account_type" DEFAULT 'BANK' NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "cash_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"direction" "cash_direction" NOT NULL,
	"category" "cash_category" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"source_type" "cash_source_type" DEFAULT 'MANUAL' NOT NULL,
	"source_id" uuid,
	"description" text,
	"is_void" boolean DEFAULT false NOT NULL,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "cash_transactions_amount_positive" CHECK ("cash_transactions"."amount" > 0),
	CONSTRAINT "cash_transactions_void_has_reason" CHECK ("cash_transactions"."is_void" = false OR "cash_transactions"."void_reason" IS NOT NULL),
	CONSTRAINT "cash_transactions_category_matches_direction" CHECK (("cash_transactions"."direction" = 'IN'  AND "cash_transactions"."category" IN ('DOWN_PAYMENT','TERMIN','RETENTION_RELEASE','OTHER_IN'))
       OR ("cash_transactions"."direction" = 'OUT' AND "cash_transactions"."category" IN ('MATERIAL','LABOR','EQUIPMENT','SUBCON','OPERATIONAL','TAX','OTHER_OUT')))
);
--> statement-breakpoint
CREATE TABLE "payment_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"payment_term_id" uuid NOT NULL,
	"period_id" uuid,
	"claim_no" text NOT NULL,
	"claim_date" date NOT NULL,
	"certified_progress_pct" numeric(9, 6) DEFAULT '0' NOT NULL,
	"gross_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"dp_recoupment" numeric(18, 2) DEFAULT '0' NOT NULL,
	"retention_withheld" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"wht_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "claim_status" DEFAULT 'DRAFT' NOT NULL,
	"paid_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payment_claims_progress_range" CHECK ("payment_claims"."certified_progress_pct" >= 0 AND "payment_claims"."certified_progress_pct" <= 1),
	CONSTRAINT "payment_claims_amounts_nonneg" CHECK ("payment_claims"."gross_amount" >= 0 AND "payment_claims"."dp_recoupment" >= 0 AND "payment_claims"."retention_withheld" >= 0
          AND "payment_claims"."vat_amount" >= 0 AND "payment_claims"."wht_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"term_type" "term_type" DEFAULT 'PROGRESS' NOT NULL,
	"percent" numeric(9, 6),
	"amount" numeric(18, 2),
	"trigger_progress_pct" numeric(9, 6),
	"planned_date" date,
	"verification_days" integer DEFAULT 0 NOT NULL,
	"payment_lag_days" integer DEFAULT 0 NOT NULL,
	"dp_recoupment_percent" numeric(9, 6) DEFAULT '0' NOT NULL,
	"status" "payment_term_status" DEFAULT 'PLANNED' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "payment_terms_seq_positive" CHECK ("payment_terms"."seq" >= 1),
	CONSTRAINT "payment_terms_has_value" CHECK ("payment_terms"."percent" IS NOT NULL OR "payment_terms"."amount" IS NOT NULL),
	CONSTRAINT "payment_terms_ranges" CHECK (("payment_terms"."percent" IS NULL OR ("payment_terms"."percent" >= 0 AND "payment_terms"."percent" <= 1))
          AND ("payment_terms"."amount" IS NULL OR "payment_terms"."amount" >= 0)
          AND ("payment_terms"."trigger_progress_pct" IS NULL OR ("payment_terms"."trigger_progress_pct" >= 0 AND "payment_terms"."trigger_progress_pct" <= 1))
          AND "payment_terms"."dp_recoupment_percent" >= 0 AND "payment_terms"."dp_recoupment_percent" <= 1),
	CONSTRAINT "payment_terms_lag_nonneg" CHECK ("payment_terms"."verification_days" >= 0 AND "payment_terms"."payment_lag_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"project_id" uuid,
	"table_name" text NOT NULL,
	"record_id" uuid,
	"action" "audit_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"period_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"severity" "issue_severity" DEFAULT 'MEDIUM' NOT NULL,
	"status" "issue_status" DEFAULT 'OPEN' NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "report_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"report_type" "report_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid,
	"pdf_path" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_categories" ADD CONSTRAINT "resource_categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_categories" ADD CONSTRAINT "resource_categories_parent_id_resource_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."resource_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_categories" ADD CONSTRAINT "resource_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_categories" ADD CONSTRAINT "resource_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_prices" ADD CONSTRAINT "resource_prices_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_prices" ADD CONSTRAINT "resource_prices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_prices" ADD CONSTRAINT "resource_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_prices" ADD CONSTRAINT "resource_prices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_category_id_resource_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."resource_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_base_unit_id_units_id_fk" FOREIGN KEY ("base_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahsp_template_resources" ADD CONSTRAINT "ahsp_template_resources_template_id_ahsp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."ahsp_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahsp_template_resources" ADD CONSTRAINT "ahsp_template_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahsp_template_resources" ADD CONSTRAINT "ahsp_template_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahsp_template_resources" ADD CONSTRAINT "ahsp_template_resources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahsp_templates" ADD CONSTRAINT "ahsp_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahsp_templates" ADD CONSTRAINT "ahsp_templates_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahsp_templates" ADD CONSTRAINT "ahsp_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahsp_templates" ADD CONSTRAINT "ahsp_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_takeoffs" ADD CONSTRAINT "volume_takeoffs_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_takeoffs" ADD CONSTRAINT "volume_takeoffs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_takeoffs" ADD CONSTRAINT "volume_takeoffs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_groups" ADD CONSTRAINT "work_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_groups" ADD CONSTRAINT "work_groups_parent_id_work_groups_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_groups" ADD CONSTRAINT "work_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_groups" ADD CONSTRAINT "work_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_milestones" ADD CONSTRAINT "work_item_milestones_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_milestones" ADD CONSTRAINT "work_item_milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_milestones" ADD CONSTRAINT "work_item_milestones_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_resources" ADD CONSTRAINT "work_item_resources_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_resources" ADD CONSTRAINT "work_item_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_resources" ADD CONSTRAINT "work_item_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_resources" ADD CONSTRAINT "work_item_resources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_group_id_work_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."work_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_distributions" ADD CONSTRAINT "baseline_distributions_baseline_id_schedule_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."schedule_baselines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_distributions" ADD CONSTRAINT "baseline_distributions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_distributions" ADD CONSTRAINT "baseline_distributions_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_distributions" ADD CONSTRAINT "planned_distributions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_distributions" ADD CONSTRAINT "planned_distributions_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_distributions" ADD CONSTRAINT "planned_distributions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_distributions" ADD CONSTRAINT "planned_distributions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_baselined_by_users_id_fk" FOREIGN KEY ("baselined_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_schedules" ADD CONSTRAINT "work_item_schedules_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_schedules" ADD CONSTRAINT "work_item_schedules_predecessor_id_work_items_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_schedules" ADD CONSTRAINT "work_item_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_schedules" ADD CONSTRAINT "work_item_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD CONSTRAINT "progress_documents_progress_entry_id_progress_entries_id_fk" FOREIGN KEY ("progress_entry_id") REFERENCES "public"."progress_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD CONSTRAINT "progress_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_checklists" ADD CONSTRAINT "work_item_checklists_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_checklists" ADD CONSTRAINT "work_item_checklists_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_checklists" ADD CONSTRAINT "work_item_checklists_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_checklists" ADD CONSTRAINT "work_item_checklists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_checklists" ADD CONSTRAINT "work_item_checklists_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_purchase_item_id_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_advances" ADD CONSTRAINT "subcontract_advances_subcontract_id_subcontracts_id_fk" FOREIGN KEY ("subcontract_id") REFERENCES "public"."subcontracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_advances" ADD CONSTRAINT "subcontract_advances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_advances" ADD CONSTRAINT "subcontract_advances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_certificates" ADD CONSTRAINT "subcontract_certificates_subcontract_id_subcontracts_id_fk" FOREIGN KEY ("subcontract_id") REFERENCES "public"."subcontracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_certificates" ADD CONSTRAINT "subcontract_certificates_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_certificates" ADD CONSTRAINT "subcontract_certificates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_certificates" ADD CONSTRAINT "subcontract_certificates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_items" ADD CONSTRAINT "subcontract_items_subcontract_id_subcontracts_id_fk" FOREIGN KEY ("subcontract_id") REFERENCES "public"."subcontracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_items" ADD CONSTRAINT "subcontract_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_items" ADD CONSTRAINT "subcontract_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_items" ADD CONSTRAINT "subcontract_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontract_items" ADD CONSTRAINT "subcontract_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_account_id_cash_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("payment_term_id") REFERENCES "public"."payment_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_unique" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_code_unique" ON "projects" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_categories_org_code_unique" ON "resource_categories" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_prices_project_scope_unique" ON "resource_prices" USING btree ("resource_id","project_id","price_type","effective_from") WHERE "resource_prices"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_prices_org_scope_unique" ON "resource_prices" USING btree ("resource_id","price_type","effective_from") WHERE "resource_prices"."project_id" IS NULL;--> statement-breakpoint
CREATE INDEX "resource_prices_lookup_idx" ON "resource_prices" USING btree ("resource_id","price_type","project_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_org_code_unique" ON "resources" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "resources_org_type_idx" ON "resources" USING btree ("org_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_org_code_unique" ON "suppliers" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "units_org_code_unique" ON "units" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ahsp_template_resources_unique" ON "ahsp_template_resources" USING btree ("template_id","resource_id","role");--> statement-breakpoint
CREATE INDEX "ahsp_template_resources_template_idx" ON "ahsp_template_resources" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ahsp_templates_org_code_unique" ON "ahsp_templates" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "volume_takeoffs_work_item_idx" ON "volume_takeoffs" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_groups_project_code_unique" ON "work_groups" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "work_groups_project_idx" ON "work_groups" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_item_milestones_work_item_idx" ON "work_item_milestones" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_resources_unique" ON "work_item_resources" USING btree ("work_item_id","resource_id","role");--> statement-breakpoint
CREATE INDEX "work_item_resources_work_item_idx" ON "work_item_resources" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_resources_resource_idx" ON "work_item_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_project_code_unique" ON "work_items" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "work_items_project_idx" ON "work_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_items_group_idx" ON "work_items" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "baseline_distributions_unique" ON "baseline_distributions" USING btree ("baseline_id","work_item_id","period_id");--> statement-breakpoint
CREATE INDEX "baseline_distributions_baseline_idx" ON "baseline_distributions" USING btree ("baseline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_distributions_unique" ON "planned_distributions" USING btree ("work_item_id","period_id");--> statement-breakpoint
CREATE INDEX "planned_distributions_period_idx" ON "planned_distributions" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "schedule_baselines_project_idx" ON "schedule_baselines" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_baselines_one_active" ON "schedule_baselines" USING btree ("project_id") WHERE "schedule_baselines"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_periods_project_seq_unique" ON "schedule_periods" USING btree ("project_id","seq");--> statement-breakpoint
CREATE INDEX "schedule_periods_project_start_idx" ON "schedule_periods" USING btree ("project_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_schedules_work_item_unique" ON "work_item_schedules" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "progress_documents_entry_idx" ON "progress_documents" USING btree ("progress_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "progress_entries_item_period_unique" ON "progress_entries" USING btree ("work_item_id","period_id");--> statement-breakpoint
CREATE INDEX "progress_entries_project_period_idx" ON "progress_entries" USING btree ("project_id","period_id");--> statement-breakpoint
CREATE INDEX "progress_entries_status_idx" ON "progress_entries" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_checklists_item_period_unique" ON "work_item_checklists" USING btree ("work_item_id","period_id") WHERE "work_item_checklists"."period_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_checklists_work_item_idx" ON "work_item_checklists" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "material_transactions_balance_idx" ON "material_transactions" USING btree ("project_id","warehouse_id","resource_id","txn_date","created_at");--> statement-breakpoint
CREATE INDEX "material_transactions_work_item_idx" ON "material_transactions" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "material_transactions_purchase_item_idx" ON "material_transactions" USING btree ("purchase_item_id");--> statement-breakpoint
CREATE INDEX "purchase_items_purchase_idx" ON "purchase_items" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_items_resource_idx" ON "purchase_items" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "purchases_project_idx" ON "purchases" USING btree ("project_id","purchase_date");--> statement-breakpoint
CREATE INDEX "purchases_status_idx" ON "purchases" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_project_name_unique" ON "warehouses" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_one_default" ON "warehouses" USING btree ("project_id") WHERE "warehouses"."is_default";--> statement-breakpoint
CREATE INDEX "subcontract_advances_subcontract_idx" ON "subcontract_advances" USING btree ("subcontract_id","advance_date");--> statement-breakpoint
CREATE UNIQUE INDEX "subcontract_certificates_no_unique" ON "subcontract_certificates" USING btree ("subcontract_id","cert_no");--> statement-breakpoint
CREATE INDEX "subcontract_certificates_period_idx" ON "subcontract_certificates" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "subcontract_items_subcontract_idx" ON "subcontract_items" USING btree ("subcontract_id");--> statement-breakpoint
CREATE INDEX "subcontracts_project_idx" ON "subcontracts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_accounts_project_name_unique" ON "cash_accounts" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "cash_transactions_running_idx" ON "cash_transactions" USING btree ("project_id","account_id","txn_date","created_at");--> statement-breakpoint
CREATE INDEX "cash_transactions_source_idx" ON "cash_transactions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_claims_project_no_unique" ON "payment_claims" USING btree ("project_id","claim_no");--> statement-breakpoint
CREATE INDEX "payment_claims_term_idx" ON "payment_claims" USING btree ("payment_term_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_terms_project_seq_unique" ON "payment_terms" USING btree ("project_id","seq");--> statement-breakpoint
CREATE INDEX "audit_logs_project_idx" ON "audit_logs" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_record_idx" ON "audit_logs" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "issues_project_status_idx" ON "issues" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "report_snapshots_unique" ON "report_snapshots" USING btree ("project_id","period_id","report_type","generated_at");--> statement-breakpoint
CREATE INDEX "report_snapshots_project_idx" ON "report_snapshots" USING btree ("project_id","report_type");