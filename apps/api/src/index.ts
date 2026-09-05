import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { registerAuth } from "./auth.js";
import { registerRoutes } from "./routes.js";
import { ensureMonthlySalary } from "./recurring.js";
import { warmOllama } from "./ollama.js";

const allowedOrigins = [`https://${config.APP_HOST}`, `http://${config.APP_HOST}`];

// Confiamos apenas no hop imediato (o Caddy), nunca no X-Forwarded-For inteiro. Com
// `trustProxy: true`, o proxy-addr aceitaria a entrada mais à esquerda do header — controlada
// pelo cliente —, e bastaria rotacioná-la para trocar de bucket a cada request e anular o
// rate limit de 5/min do /auth/login. Confiando só no hop 0, request.ip é sempre o valor que
// o Caddy anexa: o IP real de quem conectou.
const app = Fastify({
  logger: true,
  bodyLimit: 26 * 1024 * 1024,
  trustProxy: (_address: string, hop: number) => hop === 0
});
await app.register(cookie);
await app.register(cors, { origin: allowedOrigins, credentials: true });
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
await app.register(multipart);
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: "Dados inválidos", details: error.flatten() });
  app.log.error(error);
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
  const message = statusCode < 500 && error instanceof Error ? error.message : "Erro interno";
  return reply.code(statusCode).send({ error: message });
});

await migrate();
await registerAuth(app);
await registerRoutes(app);
await app.listen({ host: "0.0.0.0", port: config.PORT });
void warmOllama(app.log);

const ensureRecurringIncome = async () => {
  try {
    const result = await ensureMonthlySalary(pool, new Date(), {
      amountCents: config.MONTHLY_SALARY_CENTS,
      timeZone: config.APP_TIME_ZONE
    });
    if (result.inserted) app.log.info({ month: result.month, amountCents: config.MONTHLY_SALARY_CENTS }, "Salário mensal registrado");
  } catch (error) {
    app.log.error({ err: error }, "Não foi possível registrar o salário mensal");
  }
};
await ensureRecurringIncome();
const recurringTimer = setInterval(() => { void ensureRecurringIncome(); }, 5 * 60 * 1_000);
recurringTimer.unref();

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, async () => {
  clearInterval(recurringTimer);
  await app.close();
  await pool.end();
  process.exit(0);
});
