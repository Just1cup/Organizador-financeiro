import { z } from "zod";

export const config = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  ADMIN_PASSWORD: z.string().optional().default(""),
  OLLAMA_BASE_URL: z.string().url().default("http://ollama:11434"),
  OLLAMA_TEXT_MODEL: z.string().default("qwen3:8b"),
  OLLAMA_VISION_MODEL: z.string().default("qwen2.5vl:7b"),
  WHATSAPP_URL: z.string().url().default("http://whatsapp:3101"),
  INTERNAL_TOKEN: z.string().min(8),
  MONTHLY_SALARY_CENTS: z.coerce.number().int().positive().default(370_000),
  APP_TIME_ZONE: z.string().min(1).default("America/Sao_Paulo"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000)
}).parse(process.env);
