import { describe, expect, it, vi } from "vitest";
import { currentMonthPeriod, ensureMonthlySalary, monthlySalaryOccurrence, monthPeriod, type Queryable } from "./recurring.js";

describe("monthPeriod", () => {
  it("usa o fim do próprio mês como asOf quando o mês já encerrou", () => {
    expect(monthPeriod("2026-07", "America/Sao_Paulo", new Date("2026-09-05T12:00:00.000Z"))).toEqual({
      month: "2026-07",
      startAt: "2026-07-01T03:00:00.000Z",
      endAt: "2026-08-01T03:00:00.000Z",
      asOf: "2026-08-01T03:00:00.000Z"
    });
  });

  it("trava asOf em now para o mês atual, sem contar lançamentos futuros", () => {
    const period = monthPeriod("2026-09", "America/Sao_Paulo", new Date("2026-09-05T12:00:00.000Z"));
    expect(period.asOf).toBe("2026-09-05T12:00:00.000Z");
  });

  it("rejeita um formato de mês inválido", () => {
    expect(() => monthPeriod("2026-13", "America/Sao_Paulo", new Date())).toThrow(/mês inválido/i);
    expect(() => monthPeriod("lixo", "America/Sao_Paulo", new Date())).toThrow(/mês inválido/i);
  });
});

describe("currentMonthPeriod", () => {
  it("respeita a virada local de São Paulo e fornece limites UTC", () => {
    expect(currentMonthPeriod(new Date("2026-10-01T01:30:00.000Z"), "America/Sao_Paulo")).toEqual({
      month: "2026-09",
      startAt: "2026-09-01T03:00:00.000Z",
      endAt: "2026-10-01T03:00:00.000Z",
      asOf: "2026-10-01T01:30:00.000Z"
    });
  });

  it("avança corretamente de dezembro para janeiro", () => {
    const period = currentMonthPeriod(new Date("2026-12-31T15:00:00.000Z"), "America/Sao_Paulo");
    expect(period.month).toBe("2026-12");
    expect(period.endAt).toBe("2027-01-01T03:00:00.000Z");
  });
});

describe("monthlySalaryOccurrence", () => {
  it("agenda no primeiro dia do mês em America/Sao_Paulo", () => {
    expect(monthlySalaryOccurrence(new Date("2026-09-04T18:00:00.000Z"), "America/Sao_Paulo")).toEqual({
      month: "2026-09",
      occurredAt: "2026-09-01T03:00:00.000Z"
    });
  });

  it("usa o mês local perto da virada em UTC", () => {
    expect(monthlySalaryOccurrence(new Date("2026-10-01T01:30:00.000Z"), "America/Sao_Paulo").month).toBe("2026-09");
  });
});

describe("ensureMonthlySalary", () => {
  it("insere R$ 3.700 com chave mensal idempotente", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: "transaction" }] });
    const result = await ensureMonthlySalary({ query } as Queryable, new Date("2026-09-04T18:00:00.000Z"), {
      amountCents: 370_000,
      timeZone: "America/Sao_Paulo"
    });
    expect(result).toEqual({ inserted: true, month: "2026-09" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT DO NOTHING"), expect.arrayContaining([
      "manual", "recurring:salary:2026-09", "Salário mensal", 370_000, "Receitas"
    ]));
  });

  it("não duplica o salário quando o mês já existe", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(ensureMonthlySalary({ query } as Queryable, new Date("2026-09-20T18:00:00.000Z"), {
      amountCents: 370_000,
      timeZone: "America/Sao_Paulo"
    })).resolves.toEqual({ inserted: false, month: "2026-09" });
  });
});
