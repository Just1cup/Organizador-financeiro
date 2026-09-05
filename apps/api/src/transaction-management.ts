import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  PAYMENT_METHODS,
  TransactionInputSchema,
  transactionFingerprint,
  type TransactionInput
} from "@fluxo/shared";

const optionalText = (maximum: number) => z.preprocess(
  (value) => value === "" || value === null ? undefined : value,
  z.string().trim().min(1).max(maximum).optional()
);

export const ManualTransactionSchema = z.object({
  kind: z.enum(["income", "expense"]),
  amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  description: z.string().trim().min(1).max(240),
  merchant: optionalText(160),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  payment_method: z.enum(PAYMENT_METHODS).default("unknown"),
  category: optionalText(80)
}).strict();

export const TransactionUpdateSchema = z.object({
  description: z.string().trim().min(1).max(240).optional(),
  category: z.string().trim().min(1).max(80).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo para atualizar");

export type ManualTransactionOptions = {
  externalId?: string;
  now?: Date;
};

export function buildManualTransaction(body: unknown, options: ManualTransactionOptions = {}): TransactionInput {
  const parsed = ManualTransactionSchema.parse(body);
  const occurredAt = parsed.occurred_at ? new Date(parsed.occurred_at).toISOString() : (options.now ?? new Date()).toISOString();
  const description = parsed.description;
  return TransactionInputSchema.parse({
    source: "manual",
    externalId: options.externalId ?? `manual:${randomUUID()}`,
    description,
    merchant: parsed.merchant ?? description,
    amountCents: parsed.kind === "income" ? parsed.amount_cents : -parsed.amount_cents,
    occurredAt,
    paymentMethod: parsed.payment_method,
    category: parsed.kind === "income" ? "Receitas" : parsed.category,
    raw: { created_via: "dashboard" }
  });
}

export async function insertManualTransaction(client: PoolClient, input: TransactionInput, adminId: string): Promise<Record<string, unknown>> {
  if (input.source !== "manual" || !input.externalId.startsWith("manual:")) throw new Error("Origem manual inválida");
  const fingerprint = transactionFingerprint(input);
  const inserted = await client.query(`INSERT INTO transactions(source,external_id,fingerprint,description,merchant,amount_cents,occurred_at,payment_method,category,raw)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id,source,external_id,description,merchant,amount_cents,occurred_at,payment_method,category`, [
    input.source, input.externalId, fingerprint, input.description, input.merchant, input.amountCents,
    input.occurredAt, input.paymentMethod, input.category, input.raw
  ]);
  const row = inserted.rows[0];
  if (!row) throw new Error("O lançamento manual não foi inserido");
  await client.query("INSERT INTO audit_log(action,entity_type,entity_id,detail) VALUES('manual_create','transaction',$1,$2)", [row.id, {
    actor_admin_id: adminId,
    source: input.source,
    amount_cents: input.amountCents,
    occurred_at: input.occurredAt,
    category: input.category
  }]);
  return row;
}

export async function softDeleteTransaction(client: PoolClient, id: string, adminId: string): Promise<{ id: string } | null> {
  const found = await client.query(`SELECT id,source,description,amount_cents,occurred_at,category,merged_into
    FROM transactions WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
  if (!found.rowCount) return null;
  const row = found.rows[0];

  const reconciliations = await client.query(`UPDATE reconciliations SET status='undone',undone_at=COALESCE(undone_at,now())
    WHERE status IN ('confirmed','automatic') AND (primary_transaction_id=$1 OR secondary_transaction_id=$1)`, [id]);
  const dependents = await client.query("UPDATE transactions SET merged_into=NULL,updated_at=now() WHERE merged_into=$1 AND deleted_at IS NULL", [id]);
  const deleted = await client.query(`UPDATE transactions SET deleted_at=now(),merged_into=NULL,updated_at=now()
    WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]);
  if (!deleted.rowCount) throw new Error("O lançamento foi alterado durante a exclusão");

  await client.query("INSERT INTO audit_log(action,entity_type,entity_id,detail) VALUES('transaction_delete','transaction',$1,$2)", [id, {
    actor_admin_id: adminId,
    source: row.source,
    description: row.description,
    amount_cents: Number(row.amount_cents),
    occurred_at: row.occurred_at,
    category: row.category,
    previous_merged_into: row.merged_into,
    reconciliations_undone: reconciliations.rowCount ?? 0,
    dependents_unmerged: dependents.rowCount ?? 0
  }]);
  return { id };
}

export async function restoreTransaction(client: PoolClient, id: string, adminId: string): Promise<{ id: string } | null> {
  const restored = await client.query(`UPDATE transactions SET deleted_at=NULL,updated_at=now()
    WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id,source,description,amount_cents,occurred_at,category`, [id]);
  if (!restored.rowCount) return null;
  const row = restored.rows[0];
  await client.query("INSERT INTO audit_log(action,entity_type,entity_id,detail) VALUES('transaction_restore','transaction',$1,$2)", [id, {
    actor_admin_id: adminId,
    source: row.source,
    description: row.description,
    amount_cents: Number(row.amount_cents),
    occurred_at: row.occurred_at,
    category: row.category
  }]);
  return { id };
}
