import Fastify, { LogController } from "fastify";
import QRCode from "qrcode";
import whatsapp, { type Message } from "whatsapp-web.js";
import type { TransactionInput } from "@fluxo/shared";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BOT_MESSAGE_PREFIX, belongsToSelectedChat, processMessage, selectInitialMessages, stableMessageId, type MessageEnvelope, type ProcessOutcome } from "./processor.js";

const { Client, LocalAuth } = whatsapp;
const API_ORIGIN = process.env.API_ORIGIN || "http://api:3000";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";
const DATA_DIR = process.env.WHATSAPP_DATA_DIR || "/app/data/session";
const PORT = Number(process.env.PORT || 3101);
const POLL_INTERVAL_MS = Math.max(1_000, Number(process.env.WHATSAPP_POLL_INTERVAL_MS || 3_000));
if (INTERNAL_TOKEN.length < 8) throw new Error("INTERNAL_TOKEN ausente ou muito curto");

type State = "starting" | "qr" | "authenticated" | "ready" | "disconnected" | "error";
type HistoryMode = "latest" | "all";
type ImportState = "idle" | "running" | "completed" | "error";
type PersistedSettings = { selectedChat?: string; historyMode?: HistoryMode; lastSeenTimestamp?: number };
type ImportProgress = {
  state: ImportState;
  processed: number;
  imported: number;
  duplicated: number;
  skipped: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};
type Diagnostics = {
  eventsSeen: number;
  pollsCompleted: number;
  messagesMatched: number;
  inserted: number;
  duplicated: number;
  unrecognized: number;
  processingErrors: number;
  confirmationsAccepted: number;
  confirmationAcks: number;
  confirmationErrors: number;
  lastEventAt: string | null;
  lastProcessedAt: string | null;
  lastConfirmationAt: string | null;
  lastConfirmationAck: number | null;
  lastOutcome: ProcessOutcome | "error" | null;
};

let state: State = "starting";
let qr: string | null = null;
const settingsPath = join(DATA_DIR, "fluxo-settings.json");
let selectedChat: string | null = null;
let historyMode: HistoryMode | null = null;
let lastSeenTimestamp = 0;
let lastError: string | null = null;
let selectionGeneration = 0;
let pollTimer: NodeJS.Timeout | null = null;
let pollRunning = false;
const processedIds = new Set<string>();
const processedOrder: string[] = [];
const inFlightIds = new Set<string>();
const importProgress: ImportProgress = { state: "idle", processed: 0, imported: 0, duplicated: 0, skipped: 0, error: null, startedAt: null, finishedAt: null };
const diagnostics: Diagnostics = { eventsSeen: 0, pollsCompleted: 0, messagesMatched: 0, inserted: 0, duplicated: 0, unrecognized: 0, processingErrors: 0, confirmationsAccepted: 0, confirmationAcks: 0, confirmationErrors: 0, lastEventAt: null, lastProcessedAt: null, lastConfirmationAt: null, lastConfirmationAck: null, lastOutcome: null };

type ChatOption = { id: string; name: string; selected: boolean };

await mkdir(DATA_DIR, { recursive: true });
const chromiumProfile = join(DATA_DIR, "session-fluxo-ai");
await Promise.all(["SingletonLock", "SingletonSocket", "SingletonCookie"].map((name) => rm(join(chromiumProfile, name), { force: true })));
try {
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as PersistedSettings;
  selectedChat = settings.selectedChat || null;
  historyMode = settings.historyMode === "all" ? "all" : selectedChat ? "latest" : null;
  lastSeenTimestamp = Number(settings.lastSeenTimestamp || 0);
} catch {
  selectedChat = null;
  historyMode = null;
  lastSeenTimestamp = 0;
}

const app = Fastify({ logger: true, logController: new LogController({ disableRequestLogging: true }) });
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: DATA_DIR, clientId: "fluxo-ai" }),
  puppeteer: { headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] }
});

client.on("qr", async (value) => { state = "qr"; qr = await QRCode.toDataURL(value, { width: 320, margin: 1 }); app.log.info("[whatsapp] QR pronto para pareamento"); });
client.on("authenticated", () => { state = "authenticated"; qr = null; app.log.info("[whatsapp] Sessão autenticada"); });
client.on("ready", () => {
  state = "ready";
  qr = null;
  lastError = null;
  app.log.info({ selectionConfigured: Boolean(selectedChat), historyMode }, "[whatsapp] Cliente pronto");
  if (selectedChat) void resumeMonitoring().catch(recordBackgroundError).finally(startPolling);
  else startPolling();
});
client.on("disconnected", (reason) => { state = "disconnected"; lastError = String(reason); stopPolling(); app.log.warn({ reason }, "[whatsapp] Desconectado"); });
client.on("auth_failure", (message) => { state = "error"; lastError = message; app.log.error({ message }, "[whatsapp] Falha de autenticação"); });

function finalizeChatOptions(options: ChatOption[]): ChatOption[] {
  const unique = new Map<string, ChatOption>();
  for (const option of options) if (option.id && !unique.has(option.id)) unique.set(option.id, option);
  return [...unique.values()]
    .sort((left, right) => Number(right.selected) - Number(left.selected) || left.name.localeCompare(right.name, "pt-BR"))
    .slice(0, 200);
}

async function listChatOptions(): Promise<ChatOption[]> {
  const collected: ChatOption[] = [];
  // getChats() depende de `_serialized`, removido pelo WhatsApp Web atual em
  // alguns modelos. A coleção raw mantém a listagem funcional nesse cenário.
  try {
    if (!client.pupPage) throw new Error("Página do WhatsApp indisponível");
    const rows = await client.pupPage.evaluate(() => {
      type RawChat = {
        id?: { _serialized?: string; user?: string; server?: string };
        formattedTitle?: string;
        name?: string;
        isGroup?: boolean;
        contact?: { name?: string; pushname?: string; formattedName?: string };
      };
      const wa = window as unknown as { require(name: string): { Chat: { getModelsArray(): RawChat[] } } };
      return wa.require("WAWebCollections").Chat.getModelsArray().map((chat) => {
        try {
          const id = chat.id?._serialized || "";
          return {
            id,
            name: chat.formattedTitle || chat.name || chat.contact?.name || chat.contact?.pushname || chat.contact?.formattedName || chat.id?.user || id,
            isGroup: Boolean(chat.isGroup || chat.id?.server === "g.us")
          };
        } catch { return null; }
      });
    });
    const options = rows.filter((row): row is NonNullable<typeof row> => Boolean(row?.id) && !row?.isGroup)
      .map((row) => ({ id: row.id, name: row.name, selected: row.id === selectedChat }));
    collected.push(...options);
  } catch (error) {
    app.log.warn({ error: redactedError(error) }, "[whatsapp] Coleção leve falhou; usando contatos");
  }

  try {
    const contacts = await client.getContacts();
    const options = contacts.filter((contact) => contact.isUser && contact.isWAContact && !contact.isMe && !contact.isGroup).map((contact) => ({
      id: contact.id._serialized,
      name: contact.name || contact.pushname || contact.shortName || contact.number,
      selected: contact.id._serialized === selectedChat
    }));
    collected.push(...options);
  } catch (error) {
    app.log.warn({ error: redactedError(error) }, "[whatsapp] Não foi possível complementar a lista com contatos");
  }

  const options = finalizeChatOptions(collected);
  if (options.length) return options;
  throw new Error("Não foi possível carregar as conversas. Aguarde alguns segundos e tente novamente.");
}

function redactedError(error: unknown): { name: string; message: string; stack?: string } {
  const source = error instanceof Error ? error : new Error(String(error));
  const redact = (value: string) => value
    .replace(/\b\d{5,}(?:@(?:c\.us|lid|g\.us))?/gi, "[identificador oculto]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[token oculto]");
  return { name: source.name, message: redact(source.message), stack: source.stack ? redact(source.stack) : undefined };
}

function errorMessage(error: unknown): string {
  return redactedError(error).message.slice(0, 500);
}

function recordBackgroundError(error: unknown): void {
  lastError = errorMessage(error);
  diagnostics.processingErrors += 1;
  diagnostics.lastOutcome = "error";
  app.log.error({ error: redactedError(error) }, "[whatsapp] Falha em tarefa de segundo plano");
}

async function persistSettings(): Promise<void> {
  await writeFile(settingsPath, JSON.stringify({ selectedChat, historyMode, lastSeenTimestamp }), { encoding: "utf8", mode: 0o600 });
}

function rememberProcessed(id: string): void {
  if (processedIds.has(id)) return;
  processedIds.add(id);
  processedOrder.push(id);
  if (processedOrder.length > 5_000) {
    const oldest = processedOrder.shift();
    if (oldest) processedIds.delete(oldest);
  }
}

function forgetProcessed(id: string): void {
  processedIds.delete(id);
  for (let index = processedOrder.length - 1; index >= 0; index -= 1) {
    if (processedOrder[index] === id) processedOrder.splice(index, 1);
  }
}

function envelopeFromClient(message: Message): MessageEnvelope {
  const id = message.id as unknown as { _serialized?: string; $1?: string; id?: string; remote?: unknown; fromMe?: boolean };
  return {
    id: stableMessageId({ id, body: message.body, timestamp: message.timestamp, from: message.from, to: message.to }),
    body: typeof message.body === "string" ? message.body : "",
    timestamp: Number(message.timestamp || Math.floor(Date.now() / 1_000)),
    fromMe: Boolean(message.fromMe),
    from: String(message.from || ""),
    to: String(message.to || "")
  };
}

async function fetchChatMessages(loadAll: boolean, loadEarlierRounds = loadAll ? 1_000 : 0): Promise<MessageEnvelope[]> {
  if (!selectedChat || !client.pupPage) return [];
  const chatId = selectedChat;
  const rows = await client.pupPage.evaluate(async ({ requestedChat, shouldLoadAll, earlierRounds }) => {
    type RawMessage = {
      id?: { _serialized?: string; $1?: string; id?: string; remote?: unknown; fromMe?: boolean };
      body?: string;
      t?: number;
      timestamp?: number;
      from?: unknown;
      to?: unknown;
      isNotification?: boolean;
    };
    type RawChat = { msgs: { getModelsArray(): RawMessage[] } };
    type Runtime = {
      WWebJS: { getChat(id: string, options: { getAsModel: false }): Promise<RawChat | null> };
      require(name: string): { loadEarlierMsgs(options: { chat: RawChat }): Promise<RawMessage[] | null> };
    };
    const runtime = window as unknown as Runtime;
    const chat = await runtime.WWebJS.getChat(requestedChat, { getAsModel: false });
    if (!chat) throw new Error("Conversa autorizada não encontrada na sessão do WhatsApp");

    if (earlierRounds > 0) {
      const loader = runtime.require("WAWebChatLoadMessages");
      for (let round = 0; round < earlierRounds; round += 1) {
        const before = chat.msgs.getModelsArray().length;
        const loaded = await loader.loadEarlierMsgs({ chat });
        const after = chat.msgs.getModelsArray().length;
        if (!loaded?.length || after <= before) break;
        if (shouldLoadAll && round === earlierRounds - 1) throw new Error("Histórico excedeu o limite operacional de carregamento");
      }
    }

    const serializeWid = (value: unknown): string => {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object") return "";
      const wid = value as { _serialized?: string; $1?: string };
      return wid._serialized || wid.$1 || "";
    };
    const messages = chat.msgs.getModelsArray()
      .filter((message) => !message.isNotification)
      .sort((left, right) => Number(left.t || left.timestamp || 0) - Number(right.t || right.timestamp || 0));
    const selected = shouldLoadAll ? messages : messages.slice(-100);
    return selected.map((message) => ({
      id: {
        _serialized: message.id?._serialized,
        $1: message.id?.$1,
        id: message.id?.id,
        remote: serializeWid(message.id?.remote),
        fromMe: Boolean(message.id?.fromMe)
      },
      body: typeof message.body === "string" ? message.body : "",
      timestamp: Number(message.t || message.timestamp || 0),
      fromMe: Boolean(message.id?.fromMe),
      from: serializeWid(message.from),
      to: serializeWid(message.to)
    }));
  }, { requestedChat: chatId, shouldLoadAll: loadAll, earlierRounds: loadEarlierRounds });

  return rows.map((row) => ({
    id: stableMessageId({ id: row.id, body: row.body, timestamp: row.timestamp, from: row.from, to: row.to }),
    body: row.body,
    timestamp: row.timestamp,
    fromMe: row.fromMe,
    from: row.from,
    to: row.to,
    chatId
  }));
}

async function ingestTransaction(transaction: TransactionInput): Promise<{ inserted: boolean }> {
  const response = await fetch(`${API_ORIGIN}/internal/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": INTERNAL_TOKEN },
    body: JSON.stringify(transaction),
    signal: AbortSignal.timeout(10_000)
  });
  const result = await response.json().catch(() => ({})) as { inserted?: boolean; error?: string };
  if (!response.ok) throw new Error(result.error || `API respondeu HTTP ${response.status}`);
  return { inserted: Boolean(result.inserted) };
}

async function sendConfirmation(text: string): Promise<void> {
  if (!selectedChat) return;
  try {
    await client.sendMessage(selectedChat, text, { waitUntilMsgSent: true });
    diagnostics.confirmationsAccepted += 1;
    diagnostics.lastConfirmationAt = new Date().toISOString();
    app.log.info("[whatsapp] Confirmação enviada");
  } catch (error) {
    diagnostics.confirmationErrors += 1;
    app.log.error({ error: redactedError(error) }, "[whatsapp] Transação salva, mas a confirmação falhou");
  }
}

async function handleEnvelope(message: MessageEnvelope, origin: "event" | "poll" | "history", confirm: boolean): Promise<ProcessOutcome | "already_seen"> {
  if (processedIds.has(message.id) || inFlightIds.has(message.id)) return "already_seen";
  const activeChat = selectedChat;
  if (!activeChat) return "outside_selection";
  inFlightIds.add(message.id);

  try {
    const outcome = await processMessage(message, {
      selectedChat: activeChat,
      ingest: ingestTransaction,
      confirm: confirm ? sendConfirmation : undefined
    });
    diagnostics.lastOutcome = outcome;
    diagnostics.lastProcessedAt = new Date().toISOString();
    if (outcome !== "outside_selection") {
      diagnostics.messagesMatched += 1;
      rememberProcessed(message.id);
      lastSeenTimestamp = Math.max(lastSeenTimestamp, message.timestamp);
    }
    if (outcome === "inserted") diagnostics.inserted += 1;
    if (outcome === "duplicate") diagnostics.duplicated += 1;
    if (outcome === "unrecognized") diagnostics.unrecognized += 1;
    app.log.info({ origin, fromMe: message.fromMe, outcome }, "[whatsapp] Etapa de processamento concluída");
    return outcome;
  } catch (error) {
    throw error;
  } finally {
    inFlightIds.delete(message.id);
  }
}

function resetImportProgress(): void {
  Object.assign(importProgress, { state: "running", processed: 0, imported: 0, duplicated: 0, skipped: 0, error: null, startedAt: new Date().toISOString(), finishedAt: null });
}

async function runInitialImport(mode: HistoryMode, generation: number): Promise<void> {
  resetImportProgress();
  app.log.info({ mode }, "[whatsapp] Leitura inicial iniciada");
  try {
    const available = await fetchChatMessages(mode === "all");
    if (generation !== selectionGeneration) return;
    const selected = selectInitialMessages(available, mode);
    const selectedIds = new Set(selected.map((message) => message.id));
    for (const message of available) if (!selectedIds.has(message.id)) rememberProcessed(message.id);

    for (const message of selected) {
      if (generation !== selectionGeneration) return;
      const outcome = await handleEnvelope(message, "history", false);
      importProgress.processed += 1;
      if (outcome === "inserted") importProgress.imported += 1;
      else if (outcome === "duplicate" || outcome === "already_seen") importProgress.duplicated += 1;
      else importProgress.skipped += 1;
    }
    if (available.length) lastSeenTimestamp = Math.max(lastSeenTimestamp, ...available.map((message) => message.timestamp));
    await persistSettings();
    lastError = null;
    importProgress.state = "completed";
    importProgress.finishedAt = new Date().toISOString();
    app.log.info({ mode, processed: importProgress.processed, imported: importProgress.imported, duplicated: importProgress.duplicated, skipped: importProgress.skipped }, "[whatsapp] Leitura inicial concluída");
    await sendConfirmation(`${BOT_MESSAGE_PREFIX} leitura concluída: ${importProgress.imported} lançamento(s) novo(s), ${importProgress.duplicated} já existente(s) e ${importProgress.skipped} mensagem(ns) ignorada(s).`);
  } catch (error) {
    diagnostics.processingErrors += 1;
    diagnostics.lastOutcome = "error";
    importProgress.state = "error";
    importProgress.error = errorMessage(error);
    importProgress.finishedAt = new Date().toISOString();
    app.log.error({ mode, error: redactedError(error) }, "[whatsapp] Leitura inicial falhou");
  }
}

async function resumeMonitoring(): Promise<void> {
  if (!selectedChat) return;
  const available = await fetchChatMessages(false);
  const candidates = lastSeenTimestamp > 0
    ? available.filter((message) => message.timestamp >= lastSeenTimestamp)
    : selectInitialMessages(available, "latest");
  const candidateIds = new Set(candidates.map((message) => message.id));
  for (const message of available) if (!candidateIds.has(message.id)) rememberProcessed(message.id);
  for (const message of candidates) await handleEnvelope(message, "poll", true);
  if (available.length) lastSeenTimestamp = Math.max(lastSeenTimestamp, ...available.map((message) => message.timestamp));
  await persistSettings();
  lastError = null;
  app.log.info({ candidates: candidates.length }, "[whatsapp] Monitoramento retomado");
}

async function pollSelectedConversation(): Promise<void> {
  if (pollRunning || state !== "ready" || !selectedChat || importProgress.state === "running") return;
  pollRunning = true;
  try {
    const messages = await fetchChatMessages(false);
    for (const message of messages) {
      if (!processedIds.has(message.id) && message.timestamp >= lastSeenTimestamp) await handleEnvelope(message, "poll", true);
    }
    if (messages.length) lastSeenTimestamp = Math.max(lastSeenTimestamp, ...messages.map((message) => message.timestamp));
    diagnostics.pollsCompleted += 1;
    await persistSettings();
    lastError = null;
  } catch (error) {
    recordBackgroundError(error);
  } finally {
    pollRunning = false;
  }
}

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => { void pollSelectedConversation(); }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

client.on("message_create", (message) => {
  diagnostics.eventsSeen += 1;
  diagnostics.lastEventAt = new Date().toISOString();
  const envelope = envelopeFromClient(message);
  app.log.info({ fromMe: envelope.fromMe, selectionConfigured: Boolean(selectedChat) }, "[whatsapp] Evento message_create recebido");
  void handleEnvelope(envelope, "event", true)
    .then(() => persistSettings())
    .catch(recordBackgroundError);
});

client.on("message_ack", (message, ack) => {
  const envelope = envelopeFromClient(message);
  if (!selectedChat || !envelope.fromMe || !envelope.body.trim().startsWith(BOT_MESSAGE_PREFIX) || !belongsToSelectedChat(envelope, selectedChat)) return;
  diagnostics.confirmationAcks += 1;
  diagnostics.lastConfirmationAck = Number(ack);
  diagnostics.lastConfirmationAt = new Date().toISOString();
  app.log.info({ ack: Number(ack) }, "[whatsapp] ACK da confirmação recebido");
});

app.addHook("onRequest", async (request, reply) => { if (request.headers["x-internal-token"] !== INTERNAL_TOKEN) { await reply.code(401).send({ error: "Não autorizado" }); } });
app.get("/status", async () => ({
  state,
  qr,
  selected_chat: selectedChat,
  history_mode: historyMode,
  error: lastError,
  import_state: importProgress.state,
  processed_count: importProgress.processed,
  imported_count: importProgress.imported,
  duplicated_count: importProgress.duplicated,
  skipped_count: importProgress.skipped,
  import_error: importProgress.error,
  import_started_at: importProgress.startedAt,
  import_finished_at: importProgress.finishedAt,
  diagnostics
}));
app.get("/chats", async (_request, reply) => {
  if (state !== "ready") return reply.code(409).send({ error: "WhatsApp ainda não está pronto" });
  return listChatOptions();
});
app.post("/retry-message", async (request, reply) => {
  const body = request.body as { text?: unknown };
  if (typeof body?.text !== "string" || !body.text.trim() || body.text.length > 2_000) {
    return reply.code(400).send({ error: "text deve ser uma mensagem não vazia de até 2.000 caracteres" });
  }
  if (state !== "ready" || !selectedChat) return reply.code(409).send({ error: "Conversa autorizada ainda não está pronta" });

  const normalizeText = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  const expected = normalizeText(body.text);
  const messages = await fetchChatMessages(false, 10);
  const message = messages.filter((candidate) => normalizeText(candidate.body) === expected).at(-1);
  if (!message) return reply.code(404).send({ error: "Mensagem não encontrada entre as mensagens recentes da conversa autorizada" });

  forgetProcessed(message.id);
  const outcome = await handleEnvelope(message, "poll", true);
  await persistSettings();
  app.log.info({ outcome }, "[whatsapp] Reprocessamento manual concluído");
  return { outcome };
});
app.post("/select", async (request, reply) => {
  const body = request.body as { chat_id?: string; history_mode?: HistoryMode };
  if (!body.chat_id) return reply.code(400).send({ error: "chat_id obrigatório" });
  if (body.history_mode !== "latest" && body.history_mode !== "all") return reply.code(400).send({ error: "history_mode deve ser latest ou all" });
  if (state !== "ready") return reply.code(409).send({ error: "WhatsApp ainda não está pronto" });
  const chats = await listChatOptions();
  if (!chats.some((chat) => chat.id === body.chat_id)) return reply.code(400).send({ error: "A conversa escolhida não pertence à sessão conectada" });

  selectionGeneration += 1;
  selectedChat = body.chat_id;
  historyMode = body.history_mode;
  lastSeenTimestamp = 0;
  processedIds.clear();
  processedOrder.length = 0;
  inFlightIds.clear();
  await persistSettings();
  app.log.info({ historyMode }, "[whatsapp] Conversa autorizada; leitura agendada");
  void runInitialImport(historyMode, selectionGeneration);
  return reply.code(202).send({ ok: true, selected_chat: selectedChat, history_mode: historyMode, import_state: "running" });
});

await app.listen({ host: "0.0.0.0", port: PORT });
client.initialize().catch((error) => { state = "error"; lastError = errorMessage(error); app.log.error({ error: redactedError(error) }, "[whatsapp] Falha ao iniciar"); });

process.on("unhandledRejection", (error) => { app.log.error({ error: redactedError(error) }, "[whatsapp] Promise rejeitada sem tratamento"); });
process.on("uncaughtExceptionMonitor", (error) => { app.log.fatal({ error: redactedError(error) }, "[whatsapp] Exceção não capturada"); });

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => { stopPolling(); await client.destroy(); await app.close(); process.exit(0); });
