import { createHash } from "node:crypto";
import { z } from "zod";

export const SOURCES = ["whatsapp", "nubank_csv", "itau_csv", "generic_csv", "manual"] as const;
export const PAYMENT_METHODS = ["credit", "debit", "pix", "cash", "transfer", "unknown"] as const;

export const TransactionInputSchema = z.object({
  source: z.enum(SOURCES),
  externalId: z.string().min(1),
  description: z.string().min(1),
  merchant: z.string().optional(),
  amountCents: z.number().int().refine((value) => value !== 0, "O valor não pode ser zero"),
  occurredAt: z.string().datetime(),
  paymentMethod: z.enum(PAYMENT_METHODS).default("unknown"),
  category: z.string().trim().min(1).max(120).optional(),
  raw: z.record(z.unknown()).default({})
});
export type TransactionInput = z.infer<typeof TransactionInputSchema>;

export const ParsedMessageSchema = z.object({
  intent: z.enum(["transaction", "query", "correction", "unknown"]),
  description: z.string().default(""),
  merchant: z.string().nullable().default(null),
  amountCents: z.number().int().nullable().default(null),
  category: z.string().nullable().default(null),
  paymentMethod: z.enum(PAYMENT_METHODS).default("unknown"),
  confidence: z.number().min(0).max(1)
});
export type ParsedMessage = z.infer<typeof ParsedMessageSchema>;

export type ReconciliationCandidate = Pick<TransactionInput, "amountCents" | "occurredAt" | "paymentMethod"> & {
  merchant?: string;
  description: string;
};

export function parseBrlCents(input: string): number {
  const normalized = input.trim().replace(/R\$|\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error(`Valor inválido: ${input}`);
  return Math.round(value * 100);
}

export function normalizeMerchant(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(ltda|sa|pagamentos?|brasil|com|compra|debito|credito)\b/g, "")
    .replace(/[^a-z0-9]/g, "").replace(/\d{2,}$/g, "");
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}

export function merchantSimilarity(left: string, right: string): number {
  const a = normalizeMerchant(left);
  const b = normalizeMerchant(right);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const first = bigrams(a);
  const second = bigrams(b);
  const intersection = [...first].filter((item) => second.has(item)).length;
  return (2 * intersection) / Math.max(1, first.size + second.size);
}

export function reconciliationScore(left: ReconciliationCandidate, right: ReconciliationCandidate): number {
  const amountDifference = Math.abs(Math.abs(left.amountCents) - Math.abs(right.amountCents));
  const amountScore = amountDifference === 0 ? 45 : amountDifference <= 100 ? 40 : amountDifference <= 500 ? 25 : 0;
  const hours = Math.abs(Date.parse(left.occurredAt) - Date.parse(right.occurredAt)) / 3_600_000;
  const timeScore = hours <= 1 ? 25 : hours <= 24 ? 20 : hours <= 48 ? 12 : 0;
  const textScore = Math.round(merchantSimilarity(left.merchant || left.description, right.merchant || right.description) * 20);
  const methodScore = left.paymentMethod === right.paymentMethod || left.paymentMethod === "unknown" || right.paymentMethod === "unknown" ? 10 : 0;
  return Math.min(100, amountScore + timeScore + textScore + methodScore);
}

export function transactionFingerprint(input: TransactionInput): string {
  const stable = [input.source, input.externalId, input.amountCents, input.occurredAt, normalizeMerchant(input.merchant || input.description)].join("|");
  return createHash("sha256").update(stable).digest("hex");
}

export function categorize(description: string): string {
  const value = normalizeMerchant(description);
  const rules: Array<[RegExp, string]> = [
    [/(ifood|restaurante|mercado|assai|pao|food|cafe)/, "Alimentação"],
    [/(uber|posto|shell|combustivel|99app)/, "Transporte"],
    [/(netflix|spotify|prime|cinema|steam)/, "Lazer"],
    [/(smartfit|academia|farmacia|hospital)/, "Saúde"],
    [/(aluguel|condominio|energia|internet|agua)/, "Moradia"],
    [/(salario|freelance|rendimento)/, "Receitas"]
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] ?? "Outros";
}
