import { config } from "./config.js";

type OllamaStatus = { online: boolean; model: string; installed: boolean; error?: string };

async function ollamaFetch(path: string, init?: RequestInit, timeout = 120_000): Promise<Response> {
  return fetch(`${config.OLLAMA_BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeout) });
}

export async function ollamaStatus(): Promise<OllamaStatus> {
  try {
    const response = await ollamaFetch("/api/tags", undefined, 5_000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { models?: Array<{ name: string }> };
    const installed = data.models?.some(({ name }) => name === config.OLLAMA_TEXT_MODEL || name.startsWith(`${config.OLLAMA_TEXT_MODEL.split(":")[0]}:`)) ?? false;
    return { online: true, installed, model: config.OLLAMA_TEXT_MODEL };
  } catch (error) {
    return { online: false, installed: false, model: config.OLLAMA_TEXT_MODEL, error: error instanceof Error ? error.message : "Ollama indisponível" };
  }
}

export async function explainFinancialContext(question: string, context: unknown): Promise<string> {
  const response = await ollamaFetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.OLLAMA_TEXT_MODEL,
      stream: false,
      keep_alive: 0,
      options: { temperature: 0.2, num_ctx: 4096 },
      messages: [
        {
          role: "system",
          content: "Você é o GranaBot, assistente financeiro pessoal. Responda em português brasileiro, de forma clara e curta. Use somente os números calculados pelo backend no CONTEXTO. Não invente valores, não execute cálculos novos e não sugira investimentos específicos. Quando faltarem dados, diga isso explicitamente."
        },
        { role: "user", content: `PERGUNTA:\n${question}\n\nCONTEXTO CALCULADO PELO BACKEND:\n${JSON.stringify(context)}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`Ollama respondeu HTTP ${response.status}`);
  const body = await response.json() as { message?: { content?: string } };
  const content = body.message?.content?.trim();
  if (!content) throw new Error("O modelo retornou uma resposta vazia");
  return content;
}
