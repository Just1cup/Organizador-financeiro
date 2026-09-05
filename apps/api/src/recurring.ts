import { transactionFingerprint, TransactionInputSchema } from "@fluxo/shared";

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type Queryable = { query(text: string, values?: unknown[]): Promise<QueryResult> };

export type MonthlySalaryOptions = {
  amountCents: number;
  timeZone: string;
  description?: string;
};

export type CurrentMonthPeriod = {
  month: string;
  startAt: string;
  endAt: string;
  asOf: string;
};

function zonedParts(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function zonedDateToUtc(year: number, month: number, day: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    utc += target - represented;
  }
  return new Date(utc);
}

export function currentMonthPeriod(now: Date, timeZone: string): CurrentMonthPeriod {
  const parts = zonedParts(now, timeZone);
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
  return {
    month: `${parts.year}-${String(parts.month).padStart(2, "0")}`,
    startAt: zonedDateToUtc(parts.year, parts.month, 1, timeZone).toISOString(),
    endAt: zonedDateToUtc(nextYear, nextMonth, 1, timeZone).toISOString(),
    asOf: now.toISOString()
  };
}

export function monthlySalaryOccurrence(now: Date, timeZone: string): { month: string; occurredAt: string } {
  const period = currentMonthPeriod(now, timeZone);
  return { month: period.month, occurredAt: period.startAt };
}

export async function ensureMonthlySalary(db: Queryable, now: Date, options: MonthlySalaryOptions): Promise<{ inserted: boolean; month: string }> {
  if (!Number.isInteger(options.amountCents) || options.amountCents <= 0) throw new Error("Valor mensal do salário deve ser positivo e estar em centavos");
  const { month, occurredAt } = monthlySalaryOccurrence(now, options.timeZone);
  const description = options.description?.trim() || "Salário mensal";
  const input = TransactionInputSchema.parse({
    source: "manual",
    externalId: `recurring:salary:${month}`,
    description,
    merchant: description,
    amountCents: options.amountCents,
    occurredAt,
    paymentMethod: "transfer",
    category: "Receitas",
    raw: { recurring: "monthly_salary", month, timeZone: options.timeZone }
  });
  const fingerprint = transactionFingerprint(input);
  const result = await db.query(`WITH inserted AS (
      INSERT INTO transactions(source,external_id,fingerprint,description,merchant,amount_cents,occurred_at,payment_method,category,raw)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE EXISTS(SELECT 1 FROM admins)
      ON CONFLICT DO NOTHING RETURNING id
    ), audited AS (
      INSERT INTO audit_log(action,entity_type,entity_id,detail)
      SELECT 'monthly_salary','transaction',id,$11 FROM inserted
    )
    SELECT id FROM inserted`, [
    input.source, input.externalId, fingerprint, input.description, input.merchant, input.amountCents,
    input.occurredAt, input.paymentMethod, input.category, input.raw, { month, amount_cents: options.amountCents }
  ]);
  return { inserted: Boolean(result.rowCount), month };
}
