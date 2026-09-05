import { describe, expect, it, vi } from "vitest";
import { BOT_MESSAGE_PREFIX, belongsToSelectedChat, processMessage, selectInitialMessages, stableMessageId, type MessageEnvelope } from "./processor.js";

const selectedChat = "selected@lid";
const base: MessageEnvelope = {
  id: "wa:message-1",
  body: "Mercado 82,50",
  timestamp: 1_788_554_520,
  fromMe: true,
  from: "me@lid",
  to: selectedChat
};

describe("stableMessageId", () => {
  it("usa o ID interno quando _serialized não existe", () => {
    expect(stableMessageId({ id: { id: "ABC123" } })).toBe("wa:ABC123");
  });

  it("reconstrói o ID completo usado pelo WhatsApp Web atual", () => {
    expect(stableMessageId({ id: { fromMe: true, remote: "selected@lid", id: "ABC123" } })).toBe("true_selected@lid_ABC123");
  });

  it("gera fallback determinístico quando a biblioteca não fornece ID", () => {
    const input = { body: "Mercado 82,50", timestamp: 10, from: "a", to: "b" };
    expect(stableMessageId(input)).toBe(stableMessageId(input));
    expect(stableMessageId(input)).toMatch(/^wa:fallback:[a-f0-9]{64}$/);
  });
});

describe("seleção de conversa e histórico", () => {
  it("aceita mensagem enviada pelo usuário para a conversa selecionada", () => {
    expect(belongsToSelectedChat(base, selectedChat)).toBe(true);
  });

  it("ignora conversa diferente", () => {
    expect(belongsToSelectedChat({ ...base, to: "other@lid" }, selectedChat)).toBe(false);
  });

  it("seleciona só a última mensagem quando solicitado", () => {
    const messages = [{ ...base, id: "2", timestamp: 2 }, { ...base, id: "1", timestamp: 1 }];
    expect(selectInitialMessages(messages, "latest").map((item) => item.id)).toEqual(["2"]);
    expect(selectInitialMessages(messages, "all").map((item) => item.id)).toEqual(["1", "2"]);
  });
});

describe("processMessage", () => {
  it("insere e confirma uma mensagem financeira enviada pelo usuário", async () => {
    const ingest = vi.fn().mockResolvedValue({ inserted: true });
    const confirm = vi.fn().mockResolvedValue(undefined);
    await expect(processMessage(base, { selectedChat, ingest, confirm })).resolves.toBe("inserted");
    expect(ingest).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("✓ Registrei"));
  });

  it("insere e confirma uma receita em linguagem natural", async () => {
    const ingest = vi.fn().mockResolvedValue({ inserted: true });
    const confirm = vi.fn().mockResolvedValue(undefined);
    await expect(processMessage({ ...base, id: "income", body: "Recebi 1000 reais de pagamento" }, { selectedChat, ingest, confirm })).resolves.toBe("inserted");
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 100000, category: "Receitas" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("R$"));
  });

  it("não confirma novamente uma transação duplicada", async () => {
    const confirm = vi.fn();
    await expect(processMessage(base, { selectedChat, ingest: vi.fn().mockResolvedValue({ inserted: false }), confirm })).resolves.toBe("duplicate");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("não reprocessa mensagens emitidas pelo próprio bot", async () => {
    const ingest = vi.fn();
    await expect(processMessage({ ...base, body: `${BOT_MESSAGE_PREFIX} ✓ Registrei algo: R$ 10,00` }, { selectedChat, ingest })).resolves.toBe("bot_message");
    expect(ingest).not.toHaveBeenCalled();
  });
});
