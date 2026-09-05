import type { PoolClient } from "pg";
import { merchantSimilarity, normalizeMerchant } from "@fluxo/shared";

type Queryable = { query(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: any[] }> };

export type CategoryRow = { name: string; parent_name: string | null; keywords: string[]; is_system: boolean };
export type CategoryTreeRow = CategoryRow & { transaction_count: number };
export type MergeSuggestion = { names: string[]; reason: string };

const MIN_KEYWORD_LENGTH = 3;
const FALLBACK_NAME = "Outros";

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function deriveCategoryName(raw: string): string {
  let value = raw.split("*")[0];
  value = value.replace(/-\s*parcela\s*\d+\/\d+/i, "");
  value = value.replace(/\d{4,}/g, "");
  value = value.replace(/["'`]/g, "");
  value = value.replace(/\s{2,}/g, " ").trim();
  if (!value) value = raw.trim();
  value = value.slice(0, 60).trim();
  if (!value) return FALLBACK_NAME;
  return value.split(" ").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function keywordFor(value: string): string | undefined {
  const normalized = normalizeMerchant(value);
  return normalized.length >= MIN_KEYWORD_LENGTH ? normalized : undefined;
}

export function matchCategory(categories: CategoryRow[], keyword: string): string | undefined {
  if (!keyword) return undefined;
  const candidates = categories.flatMap((category) => category.keywords.map((word) => ({ name: category.name, word })));
  const exact = candidates.find((candidate) => candidate.word === keyword);
  if (exact) return exact.name;
  const contained = candidates
    .filter((candidate) => keyword.includes(candidate.word) || candidate.word.includes(keyword))
    .sort((a, b) => b.word.length - a.word.length)[0];
  return contained?.name;
}

export async function loadCategories(queryable: Queryable): Promise<CategoryRow[]> {
  const result = await queryable.query("SELECT name, parent_name, keywords, is_system FROM categories");
  return result.rows;
}

export async function ensureCategory(client: PoolClient, name: string, parentName: string | undefined, keyword: string | undefined): Promise<string> {
  const trimmed = name.trim().slice(0, 120) || FALLBACK_NAME;
  const existing = await client.query("SELECT name, keywords FROM categories WHERE lower(name)=lower($1)", [trimmed]);
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (keyword && !row.keywords.includes(keyword)) {
      await client.query("UPDATE categories SET keywords=array_append(keywords,$2),updated_at=now() WHERE name=$1", [row.name, keyword]);
    }
    return row.name;
  }
  await client.query(
    "INSERT INTO categories(name,parent_name,keywords) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING",
    [trimmed, parentName ?? null, keyword ? [keyword] : []]
  );
  return trimmed;
}

export async function resolveTransactionCategory(client: PoolClient, input: { description: string; merchant?: string; category?: string }): Promise<string> {
  const keyword = keywordFor(input.merchant || input.description);
  const explicit = input.category?.trim();
  if (explicit) return ensureCategory(client, explicit, undefined, keyword);
  const categories = await loadCategories(client);
  const matched = matchCategory(categories, normalizeMerchant(input.merchant || input.description));
  if (matched) return matched;
  return ensureCategory(client, deriveCategoryName(input.merchant || input.description), undefined, keyword);
}

export function previewCategory(categories: CategoryRow[], input: { description: string; merchant?: string; category?: string }): { name: string; is_new: boolean } {
  const explicit = input.category?.trim();
  if (explicit) {
    const exists = categories.some((category) => category.name.toLowerCase() === explicit.toLowerCase());
    return { name: explicit, is_new: !exists };
  }
  const matched = matchCategory(categories, normalizeMerchant(input.merchant || input.description));
  if (matched) return { name: matched, is_new: false };
  return { name: deriveCategoryName(input.merchant || input.description), is_new: true };
}

export async function listCategoryTree(queryable: Queryable): Promise<CategoryTreeRow[]> {
  const result = await queryable.query(`
    SELECT c.name, c.parent_name, c.is_system, c.keywords,
      COUNT(t.id) FILTER (WHERE t.deleted_at IS NULL) transaction_count
    FROM categories c LEFT JOIN transactions t ON t.category = c.name
    GROUP BY c.name, c.parent_name, c.is_system, c.keywords
    ORDER BY c.name`);
  return result.rows.map((row) => ({ ...row, transaction_count: Number(row.transaction_count) }));
}

export async function createCategory(client: PoolClient, input: { name: string; parent_name?: string }): Promise<CategoryRow> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw httpError("Informe um nome para a categoria", 400);
  const existing = await client.query("SELECT name FROM categories WHERE lower(name)=lower($1)", [name]);
  if (existing.rowCount) throw httpError("Já existe uma categoria com esse nome", 409);
  let parentName: string | null = null;
  if (input.parent_name) {
    const parent = await client.query("SELECT name FROM categories WHERE lower(name)=lower($1)", [input.parent_name]);
    if (!parent.rowCount) throw httpError("Categoria pai não encontrada", 404);
    parentName = parent.rows[0].name;
  }
  const inserted = await client.query(
    "INSERT INTO categories(name,parent_name) VALUES ($1,$2) RETURNING name,parent_name,keywords,is_system",
    [name, parentName]
  );
  return inserted.rows[0];
}

export async function findMergeSuggestions(queryable: Queryable): Promise<MergeSuggestion[]> {
  const categories = await loadCategories(queryable);
  const groups: MergeSuggestion[] = [];
  const consumed = new Set<string>();
  for (let left = 0; left < categories.length; left += 1) {
    if (consumed.has(categories[left].name)) continue;
    const group = [categories[left].name];
    for (let right = left + 1; right < categories.length; right += 1) {
      if (consumed.has(categories[right].name)) continue;
      const similar = merchantSimilarity(categories[left].name, categories[right].name) >= 0.5;
      const sharedKeyword = categories[left].keywords.some((word) => categories[right].keywords.includes(word));
      if (similar || sharedKeyword) { group.push(categories[right].name); consumed.add(categories[right].name); }
    }
    if (group.length > 1) { consumed.add(categories[left].name); groups.push({ names: group, reason: "Nomes ou palavras-chave parecidos" }); }
  }
  return groups;
}

export async function mergeCategories(client: PoolClient, input: { into: string; from: string[] }): Promise<{ transactions_moved: number; categories_removed: number }> {
  const into = input.into.trim();
  const from = [...new Set(input.from.map((name) => name.trim()))].filter((name) => name.toLowerCase() !== into.toLowerCase());
  if (!from.length) throw httpError("Selecione ao menos uma categoria de origem diferente do destino", 400);
  const target = await client.query("SELECT name,keywords FROM categories WHERE name=$1 FOR UPDATE", [into]);
  if (!target.rowCount) throw httpError("Categoria de destino não encontrada", 404);
  const sources = await client.query("SELECT name,keywords FROM categories WHERE name = ANY($1::text[]) FOR UPDATE", [from]);
  if (!sources.rowCount) throw httpError("Nenhuma categoria de origem encontrada", 404);
  const foundNames = sources.rows.map((row) => row.name);
  const mergedKeywords = new Set<string>(target.rows[0].keywords);
  for (const row of sources.rows) for (const keyword of row.keywords) mergedKeywords.add(keyword);
  const moved = await client.query("UPDATE transactions SET category=$1,updated_at=now() WHERE category = ANY($2::text[])", [into, foundNames]);
  await client.query("UPDATE categories SET parent_name=$1 WHERE parent_name = ANY($2::text[])", [into, foundNames]);
  await client.query("DELETE FROM budgets WHERE category = ANY($1::text[])", [foundNames]);
  await client.query("UPDATE categories SET keywords=$2,updated_at=now() WHERE name=$1", [into, [...mergedKeywords]]);
  await client.query("DELETE FROM categories WHERE name = ANY($1::text[])", [foundNames]);
  await client.query("INSERT INTO audit_log(action,entity_type,entity_id,detail) VALUES('category_merge','category',$1,$2)", [into, { from: foundNames, transactions_moved: moved.rowCount ?? 0 }]);
  return { transactions_moved: moved.rowCount ?? 0, categories_removed: foundNames.length };
}
