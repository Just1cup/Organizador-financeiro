import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  createCategory,
  deriveCategoryName,
  findMergeSuggestions,
  matchCategory,
  mergeCategories,
  previewCategory,
  resolveTransactionCategory
} from "./categories.js";

describe("deriveCategoryName", () => {
  it("limpa código de parcela, asterisco e números longos de um nome de estabelecimento", () => {
    expect(deriveCategoryName("Mais Q Make Maquiagem - Parcela 1/2")).toBe("Mais Q Make Maquiagem");
    expect(deriveCategoryName("Tim*31992938051")).toBe("Tim");
    expect(deriveCategoryName("Wellhub")).toBe("Wellhub");
  });

  it("nunca retorna um nome vazio", () => {
    expect(deriveCategoryName("")).toBe("Outros");
  });
});

describe("matchCategory", () => {
  const categories = [
    { name: "Alimentação", parent_name: null, keywords: ["ifood", "restaurante"], is_system: true },
    { name: "Transporte", parent_name: null, keywords: ["uber"], is_system: true }
  ];

  it("encontra por correspondência exata ou por substring", () => {
    expect(matchCategory(categories, "ifood")).toBe("Alimentação");
    expect(matchCategory(categories, "ifoodbrasil")).toBe("Alimentação");
    expect(matchCategory(categories, "ubertrip")).toBe("Transporte");
  });

  it("não encontra nada para uma palavra desconhecida", () => {
    expect(matchCategory(categories, "netflix")).toBeUndefined();
  });
});

describe("previewCategory (sem acesso ao banco)", () => {
  const categories = [{ name: "Alimentação", parent_name: null, keywords: ["ifood"], is_system: true }];

  it("reaproveita uma categoria existente por palavra-chave", () => {
    expect(previewCategory(categories, { description: "Ifood", merchant: "Ifood" })).toEqual({ name: "Alimentação", is_new: false });
  });

  it("sinaliza uma categoria nova quando nada corresponde", () => {
    expect(previewCategory(categories, { description: "Wellhub", merchant: "Wellhub" })).toEqual({ name: "Wellhub", is_new: true });
  });

  it("respeita um hint explícito (ex.: coluna de categoria do banco)", () => {
    expect(previewCategory(categories, { description: "Compra", category: "Alimentação" })).toEqual({ name: "Alimentação", is_new: false });
    expect(previewCategory(categories, { description: "Compra", category: "Pet" })).toEqual({ name: "Pet", is_new: true });
  });
});

function client(rows: unknown[][]): PoolClient {
  const query = vi.fn();
  for (const result of rows) query.mockResolvedValueOnce({ rowCount: result.length, rows: result });
  return { query } as unknown as PoolClient;
}

describe("resolveTransactionCategory", () => {
  it("cria uma categoria nova quando nenhuma regra corresponde ao estabelecimento", async () => {
    const db = client([[], [], []]);
    const category = await resolveTransactionCategory(db, { description: "Wellhub", merchant: "Wellhub" });
    expect(category).toBe("Wellhub");
  });

  it("reaproveita uma categoria existente pelo hint explícito, ensinando a palavra-chave", async () => {
    const db = client([[{ name: "Casa", keywords: ["aluguel"] }], []]);
    const category = await resolveTransactionCategory(db, { description: "Condomínio setembro", merchant: "Condomínio", category: "Casa" });
    expect(category).toBe("Casa");
  });
});

describe("createCategory", () => {
  it("rejeita nome duplicado (case-insensitive)", async () => {
    const db = client([[{ name: "Pet" }]]);
    await expect(createCategory(db, { name: "pet" })).rejects.toThrow(/já existe/i);
  });

  it("rejeita categoria pai inexistente", async () => {
    const db = client([[], []]);
    await expect(createCategory(db, { name: "Ração", parent_name: "Inexistente" })).rejects.toThrow(/pai/i);
  });
});

describe("findMergeSuggestions", () => {
  it("agrupa categorias com palavras-chave em comum", async () => {
    const db = { query: vi.fn().mockResolvedValue({
      rowCount: 3,
      rows: [
        { name: "Wellhub", parent_name: null, keywords: ["wellhub"], is_system: false },
        { name: "Well Hub", parent_name: null, keywords: ["wellhub"], is_system: false },
        { name: "Transporte", parent_name: null, keywords: ["uber"], is_system: true }
      ]
    }) };
    const suggestions = await findMergeSuggestions(db);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].names.sort()).toEqual(["Well Hub", "Wellhub"]);
  });
});

describe("mergeCategories", () => {
  it("move lançamentos, funde palavras-chave e remove as categorias de origem", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ name: "Wellhub", keywords: ["wellhub"] }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ name: "Well Hub", keywords: ["well hub"] }] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const db = { query } as unknown as PoolClient;

    const result = await mergeCategories(db, { into: "Wellhub", from: ["Well Hub"] });
    expect(result).toEqual({ transactions_moved: 3, categories_removed: 1 });
    expect(String(query.mock.calls[2][0])).toContain("UPDATE transactions");
    expect(String(query.mock.calls[6][0])).toContain("DELETE FROM categories");
  });

  it("rejeita quando a origem é igual ao destino", async () => {
    const db = { query: vi.fn() } as unknown as PoolClient;
    await expect(mergeCategories(db, { into: "Casa", from: ["casa"] })).rejects.toThrow(/origem/i);
  });
});
