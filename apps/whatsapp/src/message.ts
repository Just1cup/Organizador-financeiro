import { parseBrlCents, TransactionInputSchema } from "@fluxo/shared";

const amount = "(-?\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?|-?\\d+(?:[.,]\\d{1,2})?)";
const naturalExpense = new RegExp(`^(?:compra|gasto|paguei|despesa)\\s+(?:de\\s+)?(?:R\\$\\s*)?${amount}\\s*(?:reais?)?\\s+(?:no|na|em|para)\\s+(.+)$`, "i");
const naturalIncome = new RegExp(`^(recebi|entrada|entrou|caiu|depositaram|me\\s+pagaram|sal[aá]rio|rendimento|ganhei|freela|freelance)\\s+(?:de\\s+)?(?:R\\$\\s*)?${amount}\\s*(?:reais?)?(?:\\s+(?:de|do|da|por|pelo|pela|com|como|referente\\s+a)\\s+(.+))?$`, "i");
const trailingAmount = new RegExp(`^(.*?)[\\s:]+(?:R\\$\\s*)?${amount}\\s*$`, "i");

export function parseMessage(text: string, messageId: string, timestamp: number) {
  const normalized = text.trim();
  const cleaned = normalized.replace(/^[-+]?\s*/, "");
  const naturalMatch = naturalExpense.exec(cleaned);
  const incomeMatch = naturalMatch ? null : naturalIncome.exec(cleaned);
  const trailingMatch = naturalMatch || incomeMatch ? null : trailingAmount.exec(cleaned);

  const description = (naturalMatch?.[2] || incomeMatch?.[3] || incomeMatch?.[1] || trailingMatch?.[1] || "").trim();
  const amountText = naturalMatch?.[1] || incomeMatch?.[2] || trailingMatch?.[2];
  if (!description || !amountText) return null;

  const trailingIncomeHint = Boolean(trailingMatch) && /^(sal[aá]rio|recebi|entrada|freela|freelance|rendimento)/i.test(description);
  const explicitMoneyNotation = /R\$|reais?|[.,]/i.test(normalized) || normalized.startsWith("+");
  if (trailingIncomeHint && !explicitMoneyNotation) return null;

  const income = Boolean(incomeMatch) || (!naturalMatch && (trailingIncomeHint || normalized.startsWith("+")));
  const parsedCents = parseBrlCents(amountText);
  if (parsedCents === 0 || (income && parsedCents < 0)) return null;
  const absolute = Math.abs(parsedCents);
  return TransactionInputSchema.parse({
    source: "whatsapp",
    externalId: messageId,
    description,
    merchant: description,
    amountCents: income ? absolute : -absolute,
    occurredAt: new Date(timestamp * 1000).toISOString(),
    paymentMethod: /pix/i.test(text) ? "pix" : "unknown",
    category: income ? "Receitas" : undefined,
    raw: { text }
  });
}
