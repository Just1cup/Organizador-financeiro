import { createHash } from "node:crypto";
import type { TransactionInput } from "@fluxo/shared";
import { parseMessage } from "./message.js";

export const BOT_MESSAGE_PREFIX = "Fluxo AI •";

export type MessageEnvelope = {
  id: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  from: string;
  to: string;
  chatId?: string;
};

export type ProcessOutcome = "outside_selection" | "bot_message" | "unrecognized" | "inserted" | "duplicate";

type MessageIdLike = { _serialized?: unknown; $1?: unknown; id?: unknown; remote?: unknown; fromMe?: unknown } | null | undefined;

function serializedWid(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const wid = value as { _serialized?: unknown; $1?: unknown };
  if (typeof wid._serialized === "string" && wid._serialized.trim()) return wid._serialized.trim();
  return typeof wid.$1 === "string" ? wid.$1.trim() : "";
}

export function stableMessageId(input: {
  id?: MessageIdLike;
  body?: unknown;
  timestamp?: unknown;
  from?: unknown;
  to?: unknown;
}): string {
  const serialized = typeof input.id?._serialized === "string" ? input.id._serialized.trim()
    : typeof input.id?.$1 === "string" ? input.id.$1.trim()
      : "";
  if (serialized) return serialized;

  const inner = typeof input.id?.id === "string" ? input.id.id.trim() : "";
  const remote = serializedWid(input.id?.remote);
  if (inner && remote) return `${Boolean(input.id?.fromMe)}_${remote}_${inner}`;
  if (inner) return `wa:${inner}`;

  const fallback = [input.timestamp, input.from, input.to, input.body].map((value) => String(value ?? "")).join("|");
  return `wa:fallback:${createHash("sha256").update(fallback).digest("hex")}`;
}

export function belongsToSelectedChat(message: MessageEnvelope, selectedChat: string): boolean {
  return message.chatId === selectedChat || message.from === selectedChat || message.to === selectedChat;
}

export function selectInitialMessages(messages: MessageEnvelope[], mode: "latest" | "all"): MessageEnvelope[] {
  const ordered = [...messages].sort((left, right) => left.timestamp - right.timestamp);
  return mode === "all" ? ordered : ordered.slice(-1);
}

export async function processMessage(
  message: MessageEnvelope,
  options: {
    selectedChat: string;
    ingest: (transaction: TransactionInput) => Promise<{ inserted: boolean }>;
    confirm?: (text: string) => Promise<void>;
  }
): Promise<ProcessOutcome> {
  if (!belongsToSelectedChat(message, options.selectedChat)) return "outside_selection";
  if (message.fromMe && message.body.trim().startsWith(BOT_MESSAGE_PREFIX)) return "bot_message";

  const transaction = parseMessage(message.body, message.id, message.timestamp);
  if (!transaction) return "unrecognized";

  const result = await options.ingest(transaction);
  if (!result.inserted) return "duplicate";

  if (options.confirm) {
    const value = (Math.abs(transaction.amountCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    await options.confirm(`${BOT_MESSAGE_PREFIX} ✓ Registrei ${transaction.description}: ${value}`);
  }
  return "inserted";
}
