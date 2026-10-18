import { pingDb } from '@hookyard/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { ApiContainer } from '../container.js';

const CHECK_TIMEOUT_MS = 1_000;

function withTimeout<T>(promise: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout após ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const healthRoutes =
  (c: ApiContainer): FastifyPluginAsync =>
  async (app) => {
    /** Liveness: o processo está de pé. Não depende de infraestrutura externa. */
    app.get('/health/live', async () => ({ status: 'ok' }));

    /** Readiness: só aceita tráfego se banco e Redis responderem. */
    app.get('/health/ready', async (_request, reply) => {
      const checks = await Promise.allSettled([withTimeout(pingDb(c.db)), withTimeout(c.queue.getJobCounts('waiting'))]);
      const [db, redis] = checks.map((r) => (r.status === 'fulfilled' ? 'ok' : 'down'));
      const ready = db === 'ok' && redis === 'ok';
      return reply.status(ready ? 200 : 503).send({ status: ready ? 'ok' : 'unavailable', checks: { db, redis } });
    });
  };
