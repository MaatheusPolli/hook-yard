import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  QUEUE_PREFIX: z.string().optional(),
  MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(5),
  BACKOFF_BASE_MS: z.coerce.number().int().min(0).default(1_000),
  BACKOFF_FACTOR: z.coerce.number().min(1).default(4),
  BACKOFF_MAX_MS: z.coerce.number().int().min(0).default(15 * 60_000),
  BACKOFF_JITTER: z.coerce.number().min(0).max(1).default(0.2),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  WORKER_METRICS_PORT: z.coerce.number().int().min(0).default(9464),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(100).default(30_000),
  RECONCILE_MIN_AGE_MS: z.coerce.number().int().min(0).default(10_000),
  PROCESSOR: z.enum(['simulated', 'http']).default('simulated'),
  SIMULATED_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.3),
  SIMULATED_LATENCY_MS: z.coerce.number().int().min(0).default(200),
  PROCESSOR_HTTP_URL: z.url().optional(),
  PROCESSOR_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const config = schema.parse(env);
  if (config.PROCESSOR === 'http' && !config.PROCESSOR_HTTP_URL) {
    throw new Error('PROCESSOR=http exige PROCESSOR_HTTP_URL');
  }
  return config;
}
