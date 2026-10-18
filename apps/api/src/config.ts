import { z } from 'zod';

const SECRET_PREFIX = 'WEBHOOK_SECRET_';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(5),
  QUEUE_PREFIX: z.string().optional(),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1024 * 1024),
});

export interface ApiConfig {
  port: number;
  host: string;
  databaseUrl: string;
  redisUrl: string;
  maxAttempts: number;
  queuePrefix?: string;
  bodyLimit: number;
  /** Segredo HMAC por source (chave em minúsculas). */
  webhookSecrets: Record<string, string>;
}

/** Lê `WEBHOOK_SECRET_<SOURCE>`; `WEBHOOK_SECRET_MERCADO_LIVRE` → source `mercado-livre`. */
export function parseWebhookSecrets(env: NodeJS.ProcessEnv): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(SECRET_PREFIX) || !value) continue;
    const source = key.slice(SECRET_PREFIX.length).toLowerCase().replaceAll('_', '-');
    if (source) secrets[source] = value;
  }
  return secrets;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = schema.parse(env);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    maxAttempts: parsed.MAX_ATTEMPTS,
    queuePrefix: parsed.QUEUE_PREFIX,
    bodyLimit: parsed.BODY_LIMIT_BYTES,
    webhookSecrets: parseWebhookSecrets(env),
  };
}
