import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";

const COOKIE = "fluxo_session";
const credentials = z.object({ password: z.string().min(8).max(200) });
const tokenHash = (token: string) => createHash("sha256").update(`${token}:${config.SESSION_SECRET}`).digest("hex");

async function issueSession(adminId: string, reply: FastifyReply): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions(admin_id, token_hash, expires_at) VALUES($1,$2,now() + interval '30 days')", [adminId, tokenHash(token)]);
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[COOKIE];
  if (!token) { await reply.code(401).send({ error: "Não autenticado" }); return; }
  const result = await pool.query("SELECT admin_id FROM sessions WHERE token_hash=$1 AND expires_at > now()", [tokenHash(token)]);
  if (!result.rowCount) { await reply.code(401).send({ error: "Sessão expirada" }); return; }
  request.adminId = result.rows[0].admin_id;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.get("/auth/status", async (request) => {
    const token = request.cookies[COOKIE];
    const [initialized, session] = await Promise.all([
      pool.query("SELECT EXISTS(SELECT 1 FROM admins) initialized"),
      token ? pool.query("SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at > now()) authenticated", [tokenHash(token)]) : Promise.resolve({ rows: [{ authenticated: false }] })
    ]);
    return { initialized: initialized.rows[0].initialized, authenticated: session.rows[0].authenticated };
  });

  app.post("/auth/bootstrap", async (request, reply) => {
    const existing = await pool.query("SELECT EXISTS(SELECT 1 FROM admins) initialized");
    if (existing.rows[0].initialized) return reply.code(409).send({ error: "Administrador já configurado" });
    const password = config.ADMIN_PASSWORD || credentials.parse(request.body).password;
    const result = await pool.query("INSERT INTO admins(password_hash) VALUES($1) RETURNING id", [await hash(password)]);
    await issueSession(result.rows[0].id, reply);
    return { ok: true };
  });

  app.post("/auth/login", async (request, reply) => {
    const { password } = credentials.parse(request.body);
    const result = await pool.query("SELECT id,password_hash FROM admins LIMIT 1");
    if (!result.rowCount || !(await verify(result.rows[0].password_hash, password))) return reply.code(401).send({ error: "Senha incorreta" });
    await issueSession(result.rows[0].id, reply);
    return { ok: true };
  });

  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies[COOKIE];
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(token)]);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async () => ({ authenticated: true }));
}

declare module "fastify" {
  interface FastifyRequest { adminId?: string }
}
