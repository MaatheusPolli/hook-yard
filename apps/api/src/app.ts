import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { ApiContainer } from './container.js';
import { errorHandler } from './middlewares/error-handler.js';
import { eventoRoutes } from './routes/eventos.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { webhookRoutes } from './routes/webhooks.js';

export function buildApp(c: ApiContainer): FastifyInstance {
  const app = Fastify({
    loggerInstance: c.logger as FastifyBaseLogger,
    bodyLimit: c.config.bodyLimit,
    // Não logar cada request (payload e latência já vão para métricas).
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.setErrorHandler(errorHandler);
  app.register(webhookRoutes(c));
  app.register(eventoRoutes(c));
  app.register(metricsRoutes(c));
  app.register(healthRoutes(c));
  return app;
}
