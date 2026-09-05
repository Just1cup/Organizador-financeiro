import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { reconciliationScore, transactionFingerprint, TransactionInputSchema } from "@fluxo/shared";
import { requireAuth } from "./auth.js";
import { parseCsv } from "./csv.js";
import { pool, transaction } from "./db.js";
import { explainFinancialContext, ollamaStatus } from "./ollama.js";
import { config } from "./config.js";
import { currentMonthPeriod, type CurrentMonthPeriod } from "./recurring.js";
import {
  buildManualTransaction,
  insertManualTransaction,
  softDeleteTransaction,
  TransactionUpdateSchema
} from "./transaction-management.js";
import {
  createCategory,
  findMergeSuggestions,
  listCategoryTree,
  loadCategories,
  mergeCategories,
  previewCategory,
  resolveTransactionCategory
} from "./categories.js";

const cents = (value: unknown) => Number(value || 0);

async function autoReconcile(client: PoolClient): Promise<number> {
  const result = await client.query(`SELECT id,source,description,merchant,amount_cents,occurred_at,payment_method FROM transactions
    WHERE merged_into IS NULL AND deleted_at IS NULL AND occurred_at >= now() - interval '60 days'
    ORDER BY occurred_at DESC LIMIT 500 FOR UPDATE`);
  const rows = result.rows.map((row) => ({ ...row, amount_cents: cents(row.amount_cents), occurred_at: new Date(row.occurred_at).toISOString() }));
  const consumed = new Set<string>();
  let merged = 0;
  for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) {
    const a = rows[left]; const b = rows[right];
    if (a.source === b.source || consumed.has(a.id) || consumed.has(b.id)) continue;
    const score = reconciliationScore(
      { amountCents: a.amount_cents, occurredAt: a.occurred_at, paymentMethod: a.payment_method, description: a.description, merchant: a.merchant },
      { amountCents: b.amount_cents, occurredAt: b.occurred_at, paymentMethod: b.payment_method, description: b.description, merchant: b.merchant }
    );
    if (score < 90) continue;
    const primary = a.source === "whatsapp" ? b : a;
    const secondary = primary.id === a.id ? b : a;
    const changed = await client.query(`UPDATE transactions SET merged_into=$1,updated_at=now()
      WHERE id=$2 AND merged_into IS NULL AND deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM transactions WHERE id=$1 AND deleted_at IS NULL)`, [primary.id, secondary.id]);
    if (!changed.rowCount) continue;
    await client.query("INSERT INTO reconciliations(primary_transaction_id,secondary_transaction_id,score,status) VALUES($1,$2,$3,'automatic')", [primary.id, secondary.id, score]);
    consumed.add(primary.id); consumed.add(secondary.id); merged += 1;
  }
  return merged;
}

async function financialContext(period: CurrentMonthPeriod = currentMonthPeriod(new Date(), config.APP_TIME_ZONE)): Promise<Record<string, unknown>> {
  const [summary, categories, recurrences] = await Promise.all([
    pool.query(`SELECT
      COALESCE(SUM(amount_cents) FILTER (WHERE amount_cents > 0),0) income_cents,
      COALESCE(ABS(SUM(amount_cents) FILTER (WHERE amount_cents < 0)),0) expense_cents,
      COALESCE(SUM(amount_cents),0) balance_cents
      FROM transactions WHERE merged_into IS NULL AND deleted_at IS NULL AND occurred_at >= $1 AND occurred_at <= $2`, [period.startAt, period.asOf]),
    pool.query(`SELECT category, ABS(SUM(amount_cents)) total_cents, COUNT(*) count
      FROM transactions WHERE merged_into IS NULL AND deleted_at IS NULL AND amount_cents < 0 AND occurred_at >= $1 AND occurred_at <= $2
      GROUP BY category ORDER BY total_cents DESC`, [period.startAt, period.asOf]),
    pool.query(`SELECT description, ABS(ROUND(AVG(amount_cents))) average_cents, COUNT(*) occurrences
      FROM transactions WHERE merged_into IS NULL AND deleted_at IS NULL AND amount_cents < 0
      GROUP BY description HAVING COUNT(*) >= 3 ORDER BY average_cents DESC LIMIT 10`)
  ]);
  return {
    month: period.month,
    summary: Object.fromEntries(Object.entries(summary.rows[0]).map(([key, value]) => [key, cents(value)])),
    categories: categories.rows.map((row) => ({ ...row, total_cents: cents(row.total_cents), count: cents(row.count) })),
    likely_recurrences: recurrences.rows.map((row) => ({ ...row, average_cents: cents(row.average_cents), occurrences: cents(row.occurrences) }))
  };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true, service: "fluxo-api" }));
  app.get("/ai/status", { preHandler: requireAuth }, ollamaStatus);

  async function whatsapp(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${config.WHATSAPP_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-internal-token": config.INTERNAL_TOKEN, ...init?.headers },
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw Object.assign(new Error(body.error || `Serviço WhatsApp respondeu HTTP ${response.status}`), { statusCode: response.status });
    return body;
  }

  app.get("/sources/whatsapp", { preHandler: requireAuth }, async (_request, reply) => {
    try { return await whatsapp("/status"); }
    catch (error) {
      app.log.error({ err: error }, "Não foi possível consultar o status do WhatsApp");
      return reply.send({
        state: "offline", qr: null, selected_chat: null, history_mode: null, import_state: "error",
        processed_count: 0, imported_count: 0, skipped_count: 0,
        import_error: error instanceof Error ? error.message : "Serviço WhatsApp indisponível"
      });
    }
  });
  app.get("/sources/whatsapp/chats", { preHandler: requireAuth }, async () => whatsapp("/chats"));
  app.post("/sources/whatsapp/select", { preHandler: requireAuth }, async (request) => {
    const body = z.object({ chat_id: z.string().min(3), history_mode: z.enum(["latest", "all"]) }).strict().parse(request.body);
    return whatsapp("/select", { method: "POST", body: JSON.stringify(body) });
  });

  app.post("/internal/transactions", async (request, reply) => {
    if (request.headers["x-internal-token"] !== config.INTERNAL_TOKEN) return reply.code(401).send({ error: "Token interno inválido" });
    const input = TransactionInputSchema.parse(request.body);
    if (input.source !== "whatsapp") return reply.code(400).send({ error: "A ingestão interna aceita apenas mensagens do WhatsApp" });
    const fingerprint = transactionFingerprint(input);
    const result = await transaction(async (client) => {
      const category = await resolveTransactionCategory(client, { description: input.description, merchant: input.merchant, category: input.category });
      const inserted = await client.query(`INSERT INTO transactions(source,external_id,fingerprint,description,merchant,amount_cents,occurred_at,payment_method,category,raw)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`,
        [input.source, input.externalId, fingerprint, input.description, input.merchant, input.amountCents, input.occurredAt, input.paymentMethod, category, input.raw]);
      if (inserted.rowCount) {
        await client.query("INSERT INTO audit_log(action,entity_type,entity_id,detail) VALUES('whatsapp_ingest','transaction',$1,$2)", [inserted.rows[0].id, { outcome: "inserted" }]);
        return { inserted: true, id: inserted.rows[0].id };
      }
      const existing = await client.query("SELECT id FROM transactions WHERE (source=$1 AND external_id=$2) OR fingerprint=$3 ORDER BY created_at LIMIT 1", [input.source, input.externalId, fingerprint]);
      return { inserted: false, id: existing.rows[0]?.id };
    });
    app.log.info({ inserted: result.inserted }, "Ingestão WhatsApp concluída");
    return reply.code(result.inserted ? 201 : 200).send(result);
  });

  app.get("/dashboard", { preHandler: requireAuth }, async () => {
    const period = currentMonthPeriod(new Date(), config.APP_TIME_ZONE);
    const [context, budgets, goals, recent, pending] = await Promise.all([
      financialContext(period),
      pool.query(`SELECT b.category, b.limit_cents, COALESCE(ABS(SUM(t.amount_cents)),0) spent_cents
        FROM budgets b LEFT JOIN transactions t ON t.category=b.category AND t.amount_cents < 0 AND t.merged_into IS NULL
        AND t.deleted_at IS NULL AND t.occurred_at >= $1 AND t.occurred_at <= $2
        GROUP BY b.category,b.limit_cents ORDER BY b.category`, [period.startAt, period.asOf]),
      pool.query("SELECT * FROM goals ORDER BY created_at DESC"),
      pool.query("SELECT id,source,external_id,description,merchant,amount_cents,occurred_at,payment_method,category FROM transactions WHERE merged_into IS NULL AND deleted_at IS NULL AND occurred_at <= $1 ORDER BY occurred_at DESC LIMIT 8", [period.asOf]),
      pool.query(`SELECT COUNT(*) count FROM transactions a
        JOIN transactions b ON a.id < b.id AND a.source <> b.source AND a.merged_into IS NULL AND b.merged_into IS NULL
        WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL AND ABS(a.amount_cents)=ABS(b.amount_cents)
        AND ABS(EXTRACT(EPOCH FROM (a.occurred_at-b.occurred_at))) <= 172800`)
    ]);
    return {
      ...context,
      budgets: budgets.rows.map((row) => ({ ...row, limit_cents: cents(row.limit_cents), spent_cents: cents(row.spent_cents) })),
      goals: goals.rows.map((row) => ({ ...row, target_cents: cents(row.target_cents), current_cents: cents(row.current_cents) })),
      recent: recent.rows.map((row) => ({ ...row, amount_cents: cents(row.amount_cents) })),
      pending_reconciliations: cents(pending.rows[0].count)
    };
  });

  app.get("/transactions", { preHandler: requireAuth }, async (request) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
    }).parse(request.query);
    const result = await pool.query(`SELECT id,source,external_id,description,merchant,amount_cents,occurred_at,payment_method,category
      FROM transactions WHERE merged_into IS NULL AND deleted_at IS NULL ORDER BY occurred_at DESC,id DESC LIMIT $1 OFFSET $2`, [query.limit, query.offset]);
    return result.rows.map((row) => ({ ...row, amount_cents: cents(row.amount_cents) }));
  });

  app.patch("/transactions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = TransactionUpdateSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const updated = await client.query(`UPDATE transactions
        SET description=COALESCE($2,description),category=COALESCE($3,category),updated_at=now()
        WHERE id=$1 AND deleted_at IS NULL
        RETURNING id,source,external_id,description,merchant,amount_cents,occurred_at,payment_method,category`, [id, input.description ?? null, input.category ?? null]);
      if (!updated.rowCount) return null;
      if (input.category) {
        await resolveTransactionCategory(client, { description: updated.rows[0].description, merchant: updated.rows[0].merchant, category: input.category });
      }
      await client.query("INSERT INTO audit_log(action,entity_type,entity_id,detail) VALUES('transaction_update','transaction',$1,$2)", [id, {
        actor_admin_id: request.adminId,
        fields: Object.keys(input)
      }]);
      return updated.rows[0];
    });
    if (!result) return reply.code(404).send({ error: "Lançamento não encontrado" });
    return { ...result, amount_cents: cents(result.amount_cents) };
  });

  app.post("/imports/csv", { preHandler: requireAuth }, async (request, reply) => {
    const part = await request.file({ limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
    if (!part) return reply.code(400).send({ error: "Envie um arquivo CSV" });
    const buffer = await part.toBuffer();
    const parsed = parseCsv(buffer, part.filename);
    const mode = z.object({ mode: z.enum(["preview", "commit"]).default("preview") }).parse(request.query).mode;
    if (mode === "preview") {
      const categories = await loadCategories(pool);
      const preview = parsed.rows.slice(0, 20).map((row) => ({ ...row, ...previewCategory(categories, row) }));
      return { filename: part.filename, source: parsed.source, file_hash: parsed.fileHash, total: parsed.rows.length, preview };
    }
    const result = await transaction(async (client) => {
      const existing = await client.query("SELECT id,row_count FROM imports WHERE file_hash=$1", [parsed.fileHash]);
      if (existing.rowCount) return { import_id: existing.rows[0].id, inserted: 0, duplicated: parsed.rows.length, idempotent: true };
      const imported = await client.query("INSERT INTO imports(filename,file_hash,source,row_count) VALUES($1,$2,$3,$4) RETURNING id", [part.filename, parsed.fileHash, parsed.source, parsed.rows.length]);
      let inserted = 0;
      for (const row of parsed.rows) {
        const category = await resolveTransactionCategory(client, { description: row.description, merchant: row.merchant, category: row.category });
        const fingerprint = transactionFingerprint(row);
        const saved = await client.query(`INSERT INTO transactions(import_id,source,external_id,fingerprint,description,merchant,amount_cents,occurred_at,payment_method,category,raw)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(fingerprint) DO NOTHING`,
          [imported.rows[0].id, row.source, row.externalId, fingerprint, row.description, row.merchant, row.amountCents, row.occurredAt, row.paymentMethod, category, row.raw]);
        inserted += saved.rowCount || 0;
      }
      const autoMerged = await autoReconcile(client);
      await client.query("INSERT INTO audit_log(action,entity_type,entity_id,detail) VALUES('import','import',$1,$2)", [imported.rows[0].id, { filename: part.filename, inserted, autoMerged }]);
      return { import_id: imported.rows[0].id, inserted, duplicated: parsed.rows.length - inserted, auto_merged: autoMerged, idempotent: false };
    });
    return reply.code(201).send(result);
  });

  app.post("/transactions", { preHandler: requireAuth }, async (request, reply) => {
    const input = buildManualTransaction(request.body);
    const result = await transaction(async (client) => {
      const category = await resolveTransactionCategory(client, { description: input.description, merchant: input.merchant, category: input.category });
      return insertManualTransaction(client, { ...input, category }, request.adminId!);
    });
    return reply.code(201).send({ ...result, amount_cents: cents(result.amount_cents) });
  });

  app.delete("/transactions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await transaction((client) => softDeleteTransaction(client, id, request.adminId!));
    if (!result) return reply.code(404).send({ error: "Lançamento não encontrado" });
    return { ok: true, id: result.id };
  });

  app.post("/transactions/bulk-delete", { preHandler: requireAuth }, async (request) => {
    const input = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict().parse(request.body);
    const deletedIds = await transaction(async (client) => {
      const ids: string[] = [];
      for (const id of input.ids) {
        const outcome = await softDeleteTransaction(client, id, request.adminId!);
        if (outcome) ids.push(outcome.id);
      }
      return ids;
    });
    return { ok: true, deleted: deletedIds.length, ids: deletedIds };
  });

  app.get("/reconciliations/candidates", { preHandler: requireAuth }, async () => {
    const result = await pool.query(`SELECT id,source,description,merchant,amount_cents,occurred_at,payment_method,category FROM transactions
      WHERE merged_into IS NULL AND deleted_at IS NULL AND occurred_at >= now() - interval '60 days' ORDER BY occurred_at DESC LIMIT 300`);
    const rows = result.rows.map((row) => ({ ...row, amount_cents: cents(row.amount_cents), occurred_at: new Date(row.occurred_at).toISOString() }));
    const candidates = [];
    for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) {
      if (rows[left].source === rows[right].source) continue;
      const score = reconciliationScore({ amountCents: rows[left].amount_cents, occurredAt: rows[left].occurred_at, paymentMethod: rows[left].payment_method, description: rows[left].description, merchant: rows[left].merchant }, { amountCents: rows[right].amount_cents, occurredAt: rows[right].occurred_at, paymentMethod: rows[right].payment_method, description: rows[right].description, merchant: rows[right].merchant });
      if (score >= 60) candidates.push({ id: `${rows[left].id}:${rows[right].id}`, score, left: rows[left], right: rows[right] });
    }
    return candidates.sort((a, b) => b.score - a.score).slice(0, 30);
  });

  app.post("/reconciliations", { preHandler: requireAuth }, async (request, reply) => {
    const input = z.object({
      primary_id: z.string().uuid(),
      secondary_id: z.string().uuid(),
      score: z.number().int().min(0).max(100).optional()
    }).refine((value) => value.primary_id !== value.secondary_id, "Escolha dois lançamentos diferentes").parse(request.body);
    const result = await transaction(async (client) => {
      const found = await client.query(`SELECT id,source,description,merchant,amount_cents,occurred_at,payment_method
        FROM transactions WHERE id=ANY($1::uuid[]) AND merged_into IS NULL AND deleted_at IS NULL FOR UPDATE`, [[input.primary_id, input.secondary_id]]);
      if (found.rowCount !== 2) throw Object.assign(new Error("Um dos lançamentos não está mais disponível"), { statusCode: 409 });
      const requestedPrimary = found.rows.find((row) => row.id === input.primary_id)!;
      const requestedSecondary = found.rows.find((row) => row.id === input.secondary_id)!;
      if (requestedPrimary.source === requestedSecondary.source) throw Object.assign(new Error("A conciliação exige duas fontes diferentes"), { statusCode: 400 });
      const score = reconciliationScore(
        { amountCents: cents(requestedPrimary.amount_cents), occurredAt: requestedPrimary.occurred_at, paymentMethod: requestedPrimary.payment_method, description: requestedPrimary.description, merchant: requestedPrimary.merchant },
        { amountCents: cents(requestedSecondary.amount_cents), occurredAt: requestedSecondary.occurred_at, paymentMethod: requestedSecondary.payment_method, description: requestedSecondary.description, merchant: requestedSecondary.merchant }
      );
      if (score < 60) throw Object.assign(new Error("Os lançamentos não atingem a confiança mínima de 60%"), { statusCode: 409 });
      const primary = requestedPrimary.source === "whatsapp" ? requestedSecondary : requestedPrimary;
      const secondary = primary.id === requestedPrimary.id ? requestedSecondary : requestedPrimary;
      const changed = await client.query("UPDATE transactions SET merged_into=$1,updated_at=now() WHERE id=$2 AND merged_into IS NULL AND deleted_at IS NULL", [primary.id, secondary.id]);
      if (!changed.rowCount) throw Object.assign(new Error("A conciliação foi alterada por outra operação"), { statusCode: 409 });
      const saved = await client.query("INSERT INTO reconciliations(primary_transaction_id,secondary_transaction_id,score) VALUES($1,$2,$3) RETURNING id", [primary.id, secondary.id, score]);
      await client.query("INSERT INTO audit_log(action,entity_type,entity_id,detail) VALUES('merge','reconciliation',$1,$2)", [saved.rows[0].id, { ...input, primary_id: primary.id, secondary_id: secondary.id, score }]);
      return saved.rows[0];
    });
    return reply.code(201).send(result);
  });

  app.get("/reconciliations", { preHandler: requireAuth }, async () => {
    const result = await pool.query(`SELECT r.id,r.score,r.status,r.created_at,
      p.description primary_description,s.description secondary_description
      FROM reconciliations r JOIN transactions p ON p.id=r.primary_transaction_id JOIN transactions s ON s.id=r.secondary_transaction_id
      ORDER BY r.created_at DESC LIMIT 50`);
    return result.rows;
  });

  app.delete("/reconciliations/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await transaction(async (client) => {
      const item = await client.query("SELECT secondary_transaction_id FROM reconciliations WHERE id=$1 AND status IN ('confirmed','automatic')", [id]);
      if (!item.rowCount) throw new Error("Conciliação não encontrada");
      await client.query("UPDATE transactions SET merged_into=NULL,updated_at=now() WHERE id=$1 AND deleted_at IS NULL", [item.rows[0].secondary_transaction_id]);
      await client.query("UPDATE reconciliations SET status='undone',undone_at=now() WHERE id=$1", [id]);
    });
    return { ok: true };
  });

  app.get("/categories", { preHandler: requireAuth }, async () => listCategoryTree(pool));

  app.post("/categories", { preHandler: requireAuth }, async (request, reply) => {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      parent_name: z.string().trim().min(1).max(120).optional()
    }).strict().parse(request.body);
    const result = await transaction((client) => createCategory(client, input));
    return reply.code(201).send(result);
  });

  app.get("/categories/merge-suggestions", { preHandler: requireAuth }, async () => findMergeSuggestions(pool));

  app.post("/categories/merge", { preHandler: requireAuth }, async (request) => {
    const input = z.object({
      into: z.string().trim().min(1),
      from: z.array(z.string().trim().min(1)).min(1)
    }).strict().parse(request.body);
    return transaction((client) => mergeCategories(client, input));
  });

  app.put("/budgets/:category", { preHandler: requireAuth }, async (request) => {
    const { category } = z.object({ category: z.string().min(1) }).parse(request.params);
    const { limit_cents } = z.object({ limit_cents: z.number().int().positive() }).parse(request.body);
    const month = `${currentMonthPeriod(new Date(), config.APP_TIME_ZONE).month}-01`;
    await pool.query(`INSERT INTO budgets(category,limit_cents,month) VALUES($1,$2,$3::date)
      ON CONFLICT(category) DO UPDATE SET limit_cents=$2,month=$3::date,updated_at=now()`, [category, limit_cents, month]);
    return { ok: true };
  });

  app.post("/goals", { preHandler: requireAuth }, async (request, reply) => {
    const input = z.object({ name: z.string().min(2), target_cents: z.number().int().positive(), current_cents: z.number().int().nonnegative().default(0), target_date: z.string().date().optional() }).parse(request.body);
    const result = await pool.query("INSERT INTO goals(name,target_cents,current_cents,target_date) VALUES($1,$2,$3,$4) RETURNING *", [input.name, input.target_cents, input.current_cents, input.target_date]);
    return reply.code(201).send(result.rows[0]);
  });

  app.post("/assistant", { preHandler: requireAuth }, async (request, reply) => {
    const { message } = z.object({ message: z.string().min(2).max(2000) }).parse(request.body);
    const context = await financialContext();
    try { return { answer: await explainFinancialContext(message, context), source: "ollama", context }; }
    catch (error) {
      request.log.warn({ error }, "Ollama indisponível; devolvendo resumo determinístico");
      const summary = context.summary as Record<string, number>;
      return reply.send({ answer: `Neste mês, suas entradas somam R$ ${(summary.income_cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} e suas saídas R$ ${(summary.expense_cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}. O Ollama está indisponível agora, então mostrei apenas os valores calculados pelo sistema.`, source: "deterministic", context });
    }
  });
}
