import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";

describe("importação CSV", () => {
  it("reconhece um extrato Nubank em português", () => {
    const file = Buffer.from("Data,Descrição,Valor\n03/09/2026,Uber* Trip,-24.90\n04/09/2026,Salário,3500.00\n");
    const result = parseCsv(file, "nubank-setembro.csv");
    expect(result.source).toBe("nubank_csv");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].amountCents).toBe(-2490);
    // A categorização final (regra existente, aprendida ou nova categoria) é decidida no commit
    // pelo catálogo dinâmico em categories.ts, não pelo parser puro.
    expect(result.rows[0].category).toBeUndefined();
  });

  it("rejeita arquivos sem as colunas obrigatórias", () => {
    expect(() => parseCsv(Buffer.from("coisa;outra\na;b"), "invalido.csv")).toThrow(/colunas/i);
  });

  it("reconhece a fatura de cartão Nubank (date,title,amount) e inverte o sinal", () => {
    const file = Buffer.from('date,title,amount\n2026-08-07,Mais Q Make Maquiagem - Parcela 1/2,"82,50"\n2026-08-04,"IOF de ""Discord* Nitromonthly""","0,91"\n2026-08-03,Pagamento recebido,"- 2.490,27"\n');
    const result = parseCsv(file, "Nubank_2026-08-16.csv");
    expect(result.source).toBe("nubank_csv");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].amountCents).toBe(-8250);
    expect(result.rows[0].paymentMethod).toBe("credit");
    expect(result.rows[1].description).toBe('IOF de "Discord* Nitromonthly"');
    expect(result.rows.some((row) => /pagamento/i.test(row.description))).toBe(false);
  });
});
