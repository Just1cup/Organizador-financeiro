import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  buildManualTransaction,
  insertManualTransaction,
  restoreTransaction,
  softDeleteTransaction,
  TransactionUpdateSchema
} from "./transaction-management.js";

describe("buildManualTransaction", () => {
  it("cria despesa manual com sinal, categoria e origem controlados pelo servidor", () => {
    const result = buildManualTransaction({
      kind: "expense",
      amount_cents: 20_000,
      description: "  Ifood  ",
      occurred_at: "2026-09-04T18:30:00-03:00",
      payment_method: "pix"
    }, { externalId: "manual:test-expense" });

    expect(result).toMatchObject({
      source: "manual",
      externalId: "manual:test-expense",
      description: "Ifood",
      merchant: "Ifood",
      amountCents: -20_000,
      occurredAt: "2026-09-04T21:30:00.000Z",
      paymentMethod: "pix",
      raw: { created_via: "dashboard" }
    });
    // A categoria de uma despesa sem hint explícito só é resolvida no insert (catálogo dinâmico em categories.ts), não aqui.
    expect(result.category).toBeUndefined();
  });

  it("cria receita positiva e força a categoria Receitas", () => {
    const result = buildManualTransaction({
      kind: "income",
      amount_cents: 100_000,
      description: "Pagamento",
      category: "Outros"
    }, { externalId: "manual:test-income", now: new Date("2026-09-04T21:00:00.000Z") });

    expect(result.amountCents).toBe(100_000);
    expect(result.category).toBe("Receitas");
    expect(result.occurredAt).toBe("2026-09-04T21:00:00.000Z");
  });

  it.each([
    { kind: "expense", amount_cents: 0, description: "Zero" },
    { kind: "expense", amount_cents: -100, description: "Negativo" },
    { kind: "expense", amount_cents: 10.5, description: "Decimal" },
    { kind: "expense", amount_cents: 100, description: "  " },
    { kind: "expense", amount_cents: 100, description: "Teste", occurred_at: "ontem" },
    { kind: "expense", amount_cents: 100, description: "Teste", source: "whatsapp" }
  ])("rejeita payload manual inválido ou com campos internos: %o", (body) => {
    expect(() => buildManualTransaction(body)).toThrow();
  });
});

describe("TransactionUpdateSchema", () => {
  it("normaliza campos editáveis e rejeita corpo vazio ou campos internos", () => {
    expect(TransactionUpdateSchema.parse({ description: "  Mercado  " })).toEqual({ description: "Mercado" });
    expect(() => TransactionUpdateSchema.parse({})).toThrow();
    expect(() => TransactionUpdateSchema.parse({ category: "Casa", amount_cents: 1 })).toThrow();
  });
});

describe("mutações auditáveis de lançamentos", () => {
  it("insere o lançamento manual e a auditoria usando o mesmo cliente", async () => {
    const row = {
      id: "20384125-793f-42a3-b62e-dc54cadbf310",
      source: "manual",
      description: "Ifood",
      amount_cents: "-20000"
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [row] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const input = buildManualTransaction({ kind: "expense", amount_cents: 20_000, description: "Ifood" }, {
      externalId: "manual:test-audit",
      now: new Date("2026-09-04T21:00:00.000Z")
    });

    await expect(insertManualTransaction({ query } as unknown as PoolClient, input, "admin-1")).resolves.toBe(row);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0][0])).toContain("INSERT INTO transactions");
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(["manual", "manual:test-audit", -20_000]));
    expect(String(query.mock.calls[1][0])).toContain("'manual_create'");
    expect(query.mock.calls[1][1]?.[1]).toMatchObject({ actor_admin_id: "admin-1", amount_cents: -20_000 });
  });

  it("faz soft delete, desfaz vínculos e registra snapshot sem raw", async () => {
    const id = "20384125-793f-42a3-b62e-dc54cadbf310";
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        id, source: "whatsapp", description: "Ifood", amount_cents: "-20000",
        occurred_at: "2026-09-04T21:00:00.000Z", category: "Alimentação", merged_into: null
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await expect(softDeleteTransaction({ query } as unknown as PoolClient, id, "admin-1")).resolves.toEqual({ id });
    const statements = query.mock.calls.map((call) => String(call[0]));
    expect(statements).toHaveLength(5);
    expect(statements[0]).toContain("FOR UPDATE");
    expect(statements[1]).toContain("status='undone'");
    expect(statements[2]).toContain("merged_into=NULL");
    expect(statements[3]).toContain("deleted_at=now()");
    expect(statements.every((statement) => !/^\s*DELETE\s/i.test(statement))).toBe(true);
    expect(statements[4]).toContain("'transaction_delete'");
    const detail = query.mock.calls[4][1]?.[1] as Record<string, unknown>;
    expect(detail).toMatchObject({
      actor_admin_id: "admin-1",
      amount_cents: -20_000,
      reconciliations_undone: 1,
      dependents_unmerged: 2
    });
    expect(detail).not.toHaveProperty("raw");
  });

  it("não altera nem audita um lançamento ausente ou já excluído", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(softDeleteTransaction(
      { query } as unknown as PoolClient,
      "20384125-793f-42a3-b62e-dc54cadbf310",
      "admin-1"
    )).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("restoreTransaction", () => {
  it("limpa deleted_at e audita a restauração", async () => {
    const id = "20384125-793f-42a3-b62e-dc54cadbf310";
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        id, source: "nubank_csv", description: "Wellhub", amount_cents: "-3670",
        occurred_at: "2026-08-05T00:00:00.000Z", category: "Lazer"
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await expect(restoreTransaction({ query } as unknown as PoolClient, id, "admin-1")).resolves.toEqual({ id });
    expect(String(query.mock.calls[0][0])).toContain("deleted_at=NULL");
    expect(String(query.mock.calls[1][0])).toContain("'transaction_restore'");
    expect(query.mock.calls[1][1]?.[1]).toMatchObject({ actor_admin_id: "admin-1", amount_cents: -3670 });
  });

  it("não faz nada e não audita um lançamento que já está ativo", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(restoreTransaction(
      { query } as unknown as PoolClient,
      "20384125-793f-42a3-b62e-dc54cadbf310",
      "admin-1"
    )).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
