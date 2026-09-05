import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { parseBrlCents, TransactionInputSchema, transactionFingerprint, type TransactionInput } from "@fluxo/shared";

const aliases = {
  date: ["date", "data", "data da compra", "data lancamento", "data de lançamento"],
  description: ["description", "title", "descrição", "descricao", "lançamento", "historico", "título"],
  amount: ["amount", "valor", "valor (r$)", "valor da compra"],
  category: ["category", "categoria"]
};

const invoicePaymentPattern = /^pagamento( recebido| em atraso)?$/i;

function decode(buffer: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return new TextDecoder("windows-1252").decode(buffer); }
}

function findColumn(headers: string[], names: string[]): string | undefined {
  return headers.find((header) => names.includes(header.trim().toLowerCase()));
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  const br = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(trimmed);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return new Date(`${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}T12:00:00-03:00`).toISOString();
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new Error(`Data inválida: ${value}`);
  return date.toISOString();
}

export function parseCsv(buffer: Buffer, filename: string): { fileHash: string; source: TransactionInput["source"]; rows: TransactionInput[] } {
  const text = decode(buffer).replace(/^\uFEFF/, "");
  const delimiter = text.split("\n", 1)[0].split(";").length > text.split("\n", 1)[0].split(",").length ? ";" : ",";
  const records = parse(text, { columns: true, skip_empty_lines: true, trim: true, delimiter, relax_column_count: true }) as Record<string, string>[];
  if (!records.length) throw new Error("O CSV não possui lançamentos");
  const headers = Object.keys(records[0]);
  const dateColumn = findColumn(headers, aliases.date);
  const descriptionColumn = findColumn(headers, aliases.description);
  const amountColumn = findColumn(headers, aliases.amount);
  const categoryColumn = findColumn(headers, aliases.category);
  if (!dateColumn || !descriptionColumn || !amountColumn) throw new Error("Não encontrei as colunas de data, descrição e valor");
  const lower = `${filename} ${headers.join(" ")}`.toLowerCase();
  const source = lower.includes("nubank") ? "nubank_csv" : lower.includes("itaú") || lower.includes("itau") ? "itau_csv" : "generic_csv";
  // Fatura de cartão Nubank: só tem date/title/amount; a fatura lista compras como
  // valor positivo e o pagamento da fatura como negativo — invertido em relação ao
  // restante do app (saída = negativo). O pagamento em si não é um lançamento real.
  const isNubankCardInvoice = source === "nubank_csv" && headers.length === 3 && dateColumn === "date" && descriptionColumn === "title" && amountColumn === "amount";
  const rows = records
    .filter((record) => !(isNubankCardInvoice && invoicePaymentPattern.test(record[descriptionColumn].trim())))
    .map((record, index) => {
      const parsedAmount = parseBrlCents(record[amountColumn]);
      const amountCents = isNubankCardInvoice ? -parsedAmount : parsedAmount;
      const description = record[descriptionColumn];
      const input = TransactionInputSchema.parse({
        source,
        externalId: `${createHash("sha256").update(JSON.stringify(record)).digest("hex").slice(0, 20)}-${index}`,
        description,
        merchant: description,
        amountCents,
        occurredAt: parseDate(record[dateColumn]),
        paymentMethod: isNubankCardInvoice || lower.includes("cartão") || lower.includes("cartao") ? "credit" : "unknown",
        category: record[categoryColumn || ""] || undefined,
        raw: record
      });
      return input;
    });
  return { fileHash: createHash("sha256").update(buffer).digest("hex"), source, rows };
}

export { transactionFingerprint };
