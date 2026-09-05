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

type Logger = { info: (msg: string) => void; warn: (obj: unknown, msg: string) => void };

async function warmOne(model: string, timeout: number): Promise<void> {
  const response = await ollamaFetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: "oi", stream: false, keep_alive: 0, options: { num_predict: 1 } })
  }, timeout);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/**
 * Dispara uma geração mínima pra cada modelo assim que a API sobe, pra forçar o Ollama a
 * carregar os pesos e (na RX 6600, que roda via HSA_OVERRIDE_GFX_VERSION) compilar o cache
 * de kernels ROCm antes que um usuário real bata numa consulta e estoure o timeout de
 * ollamaFetch. Não bloqueia o startup — deve ser chamado sem `await`.
 */
export async function warmOllama(log: Logger): Promise<void> {
  const timeout = 180_000;
  for (const model of [config.OLLAMA_TEXT_MODEL, config.OLLAMA_VISION_MODEL]) {
    const start = Date.now();
    try {
      await warmOne(model, timeout);
      log.info(`Ollama aquecido (${model}) em ${Date.now() - start}ms`);
    } catch (error) {
      log.warn({ err: error }, `Falha ao aquecer o Ollama para ${model} — a primeira consulta real pode expirar`);
    }
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
