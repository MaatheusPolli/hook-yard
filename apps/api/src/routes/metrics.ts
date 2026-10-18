import type { FastifyPluginAsync } from 'fastify';
import type { ApiContainer } from '../container.js';

export async function collectSummary(c: ApiContainer) {
  const [stats, queue] = await Promise.all([
    c.repository.stats(),
    c.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized'),
  ]);
  return { events: stats, queue };
}

export const metricsRoutes =
  (c: ApiContainer): FastifyPluginAsync =>
  async (app) => {
    /** Formato Prometheus. Gauges de estado são atualizados no momento do scrape. */
    app.get('/metrics', async (_request, reply) => {
      const { events, queue } = await collectSummary(c);
      for (const [status, count] of Object.entries(events.byStatus)) c.metrics.eventsByStatus.set({ status }, count);
      for (const [state, count] of Object.entries(queue)) c.metrics.queueSize.set({ state }, count);
      reply.header('content-type', c.metrics.registry.contentType);
      return c.metrics.registry.metrics();
    });

    /** Resumo em JSON para o painel. */
    app.get('/metrics/summary', async () => collectSummary(c));
  };
