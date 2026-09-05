import { describe, expect, it } from "vitest";
import { categorize, merchantSimilarity, parseBrlCents, reconciliationScore } from "./index.js";

describe("domínio financeiro", () => {
  it("converte valores brasileiros em centavos", () => {
    expect(parseBrlCents("R$ 1.842,50")).toBe(184250);
    expect(parseBrlCents("-24,90")).toBe(-2490);
  });

  it("normaliza estabelecimentos", () => {
    expect(merchantSimilarity("Uber* Trip 1234", "UBER")).toBe(1);
  });

  it("pontua uma conciliação forte", () => {
    expect(reconciliationScore(
      { amountCents: -2490, occurredAt: "2026-09-03T22:15:00.000Z", paymentMethod: "unknown", description: "Uber" },
      { amountCents: -2490, occurredAt: "2026-09-03T22:20:00.000Z", paymentMethod: "credit", description: "Uber Trip" }
    )).toBeGreaterThanOrEqual(90);
  });

  it("categoriza descrições comuns", () => {
    expect(categorize("POSTO SHELL")).toBe("Transporte");
  });
});
