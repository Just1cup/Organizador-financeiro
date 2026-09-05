import { describe, expect, it } from "vitest";
import { parseMessage } from "./message.js";

const timestamp = 1_788_554_520;

describe("parseMessage", () => {
  it("interpreta a forma curta com o valor no final", () => {
    const transaction = parseMessage("Mercado 82,50", "short", timestamp);
    expect(transaction).toMatchObject({ description: "Mercado", amountCents: -8250 });
  });

  it("interpreta uma compra escrita em linguagem natural", () => {
    const transaction = parseMessage("Compra de 626,00 reais no Yakan Sushi - restaurante", "natural", timestamp);
    expect(transaction).toMatchObject({ description: "Yakan Sushi - restaurante", amountCents: -62600 });
  });

  it("mantém entradas positivas", () => {
    const transaction = parseMessage("Recebi freela 1.250,00", "income", timestamp);
    expect(transaction).toMatchObject({ description: "Recebi freela", amountCents: 125000, category: "Receitas" });
  });

  it("interpreta uma entrada escrita em linguagem natural", () => {
    const transaction = parseMessage("Recebi 1000 reais de pagamento", "natural-income", timestamp);
    expect(transaction).toMatchObject({ description: "pagamento", amountCents: 100000, category: "Receitas" });
  });

  it.each([
    ["Salário 3.700", 370000, "Salário"],
    ["Entrada de R$ 250,50 referente a reembolso", 25050, "reembolso"],
    ["Ganhei 80 reais por venda", 8000, "venda"],
    ["Caiu R$ 3.700 de salário", 370000, "salário"],
    ["Me pagaram 1.000 reais pelo projeto", 100000, "projeto"]
  ])("interpreta a variação de receita %s", (text, amountCents, description) => {
    expect(parseMessage(text, `income-${text}`, timestamp)).toMatchObject({ description, amountCents, category: "Receitas" });
  });

  it.each(["Recebi 1000 mensagens", "Recebi o código 123456", "Recebi -100 reais"])("não interpreta como receita: %s", (text) => {
    expect(parseMessage(text, `not-income-${text}`, timestamp)).toBeNull();
  });

  it("não interpreta uma conversa com número solto", () => {
    expect(parseMessage("Nos encontramos às 18 horas", "chat", timestamp)).toBeNull();
  });
});
