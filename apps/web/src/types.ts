export type Summary = { income_cents: number; expense_cents: number; balance_cents: number };
export type Transaction = {
  id: string;
  source: string;
  external_id?: string | null;
  description: string;
  merchant?: string | null;
  amount_cents: number;
  occurred_at: string;
  payment_method: string;
  category: string;
};
export type TransactionKind = "income" | "expense";
export type PaymentMethod = "credit" | "debit" | "pix" | "cash" | "transfer" | "unknown";
export type ManualTransactionInput = {
  kind: TransactionKind;
  amount_cents: number;
  description: string;
  merchant?: string;
  occurred_at: string;
  category: string;
  payment_method: PaymentMethod;
};
export type Budget = { category: string; limit_cents: number; spent_cents: number };
export type Goal = { id: string; name: string; target_cents: number; current_cents: number; target_date?: string | null };
export type CategoryTotal = { category: string; total_cents: number; count: number };
export type DashboardData = {
  month: string;
  summary: Summary;
  categories: CategoryTotal[];
  likely_recurrences: Array<{ description: string; average_cents: number; occurrences: number }>;
  budgets: Budget[];
  goals: Goal[];
  recent: Transaction[];
  pending_reconciliations: number;
  is_current_month: boolean;
};
export type Category = { name: string; parent_name: string | null; keywords: string[]; is_system: boolean; transaction_count: number };
export type MergeSuggestion = { names: string[]; reason: string };
export type Candidate = { id: string; score: number; left: Transaction; right: Transaction };
export type ReconciliationRecord = {
  id: string;
  score: number;
  status: "confirmed" | "automatic" | "undone";
  created_at: string;
  primary_description: string;
  secondary_description: string;
};
export type AiStatus = { online: boolean; installed: boolean; model: string; error?: string };
