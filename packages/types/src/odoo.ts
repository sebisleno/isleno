/**
 * Types for Odoo API data models
 */

// Base Odoo record structure
export interface OdooRecord {
  id: number;
}

// res.partner (Suppliers/Vendors)
export interface OdooSupplier extends OdooRecord {
  name: string;
  x_studio_accounting_code?: [number, string];
}

// account.analytic.account (Projects/Departments)
export interface OdooProject extends OdooRecord {
  name: string;
  code?: string;
  plan_id: [number, string];
}

// account.account (Spend Categories/Accounts)
export interface OdooSpendCategory extends OdooRecord {
  name: string;
  code: string;
}

// ir.attachment (File Attachments)
export interface OdooAttachment extends OdooRecord {
  name: string;
  mimetype: string;
  datas?: string;
  res_model?: string;
  res_id?: number;
}

// account.move (Invoices)
export interface OdooInvoice extends OdooRecord {
  name?: string;
  partner_id?: [number, string];
  invoice_date?: string;
  invoice_date_due?: string;
  amount_untaxed?: number;
  amount_total?: number;
  amount_tax?: number;
  currency_id?: [number, string];
  x_studio_project_manager_review_status?: string;
  state?: string;
  x_studio_is_over_budget?: boolean;
  x_studio_amount_over_budget?: number;
  x_studio_is_over_project_dept_budget?: boolean;
  x_studio_amount_over_project_dept_budget?: number;
  x_studio_cfo_sign_off?: boolean;
  x_studio_ceo_sign_off?: boolean;
  x_studio_project_manager_1?: string;
  invoice_line_ids?: number[];
  line_ids?: number[];
  move_type?: string;
  ref?: string;
  department_name?: string; // Added by our API
  attachments?: OdooInvoiceAttachment[];
}

// account.move.line (Invoice Line Items)
export interface OdooInvoiceLineItem extends OdooRecord {
  move_id?: number;
  account_id?: [number, string];
  analytic_distribution?: Record<string, number>;
  price_unit?: number;
  quantity?: number;
  price_subtotal?: number;
  price_total?: number;
  name?: string;
  product_id?: [number, string];
}

// Invoice-specific attachment interface
export interface OdooInvoiceAttachment extends OdooRecord {
  name: string;
  mimetype: string;
  datas?: string;
}

// User Profile data from Supabase (related to Odoo integration)
export interface OdooUserProfile {
  id: string;
  full_name?: string;
  job_title?: string;
  department_id?: string;
  odoo_group_id?: number;
  invoice_approval_alias?: string;
  departments?: {
    department_id: string;
    department_name: string;
    odoo_group_id: number;
  };
}

// Generic Odoo API response structure
export interface OdooApiResponse<T> {
  data: T[];
  total?: number;
  error?: string;
}

// Odoo search/read parameters
export interface OdooSearchParams {
  fields?: string[];
  limit?: number;
  offset?: number;
  order?: string;
}

// Odoo domain filter structure
export type OdooDomain = Array<[string, string, any] | string>;

// account.report.budget (Budget Reports)
export interface OdooBudget extends OdooRecord {
  name: string;
  display_name: string;
  company_id: [number, string];
  item_ids: number[]; // Array of budget line item IDs
  sequence: number;
  create_date: string;
  create_uid: [number, string];
  write_date: string;
  write_uid: [number, string];
}

// account.report.budget.item (Budget Line Items)
export interface OdooBudgetLineItem extends OdooRecord {
  budget_id: [number, string]; // Budget ID and name tuple
  account_id: [number, string]; // Account ID and name tuple
  amount: number; // The budget amount for this line item
  date: string; // The date for this budget line item
  display_name: string;
  create_uid: [number, string];
  create_date: string;
  write_uid: [number, string];
  write_date: string;
}

// Budget impact calculation for session management
export interface BudgetImpact {
  budgetId: number;
  projectId?: number;
  departmentId?: number;
  currentBudget: number;
  currentSpent: number;
  currentRemaining: number;
  invoiceAmount: number;
  projectedSpent: number;
  projectedRemaining: number;
  percentageUsed: number;
  projectedPercentageUsed: number;
  isOverBudget: boolean;
  willBeOverBudget: boolean;
  currency: string;
  isMockData?: boolean; // Indicates if this is mock data for development
}

// Session-based budget tracking (no database storage)
export interface SessionBudgetState {
  sessionId: string;
  approvedInvoices: Array<{
    invoiceId: number;
    amount: number;
    projectId?: number;
    departmentId?: number;
    timestamp: Date;
  }>;
  budgetImpacts: Map<number, BudgetImpact>; // Key: project/department ID
}

// Pagination information for API responses
export interface PaginationInfo {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
