import { z } from "zod";

// Segredos de exemplo do template (.env.example / docker-compose.yml) nunca podem
// funcionar de verdade: se chegarem aqui sem terem sido sobrescritos, falhamos
// o boot em vez de subir com uma credencial pública e conhecida.
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "development-only-change-this-secret",
  "development-internal-token",
  "replace-with-at-least-32-random-characters",
  "replace-with-another-random-secret",
  "change-me"
]);
const notAPlaceholder = (label: string) => (value: string) => {
  if (KNOWN_PLACEHOLDER_SECRETS.has(value)) {
    throw new Error(`${label} ainda está com o valor de exemplo do template. Gere um segredo aleatório real (ex.: openssl rand -hex 32) e defina no seu .env.`);
  }
  return true;
};

export const config = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET deve ter ao menos 32 caracteres aleatórios").refine(notAPlaceholder("SESSION_SECRET")),
  ADMIN_PASSWORD: z.string().optional().default(""),
  OLLAMA_BASE_URL: z.string().url().default("http://ollama:11434"),
  OLLAMA_TEXT_MODEL: z.string().default("qwen3:8b"),
  OLLAMA_VISION_MODEL: z.string().default("qwen2.5vl:7b"),
  WHATSAPP_URL: z.string().url().default("http://whatsapp:3101"),
  INTERNAL_TOKEN: z.string().min(32, "INTERNAL_TOKEN deve ter ao menos 32 caracteres aleatórios").refine(notAPlaceholder("INTERNAL_TOKEN")),
  MONTHLY_SALARY_CENTS: z.coerce.number().int().positive("Defina MONTHLY_SALARY_CENTS no .env com o valor real do seu salário, em centavos"),
  APP_TIME_ZONE: z.string().min(1).default("America/Sao_Paulo"),
  APP_HOST: z.string().min(1).default("localhost"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000)
}).parse(process.env);
