import { createServer } from 'node:http';
import {
  EventRepository,
  createDb,
  createEventQueue,
  createLogger,
  createMetrics,
  migrateToLatest,
  redisConnection,
} from '@hookyard/shared';
import { loadConfig } from './config.js';
import { createEventHandler } from './handlers/event.handler.js';
import { createProcessor } from './processor/index.js';
import { Reconciler } from './reconciler.js';
import { createEventWorker } from './worker.js';

const config = loadConfig();
const logger = createLogger('worker');
const metrics = createMetrics({ defaultMetrics: true });
const db = createDb(config.DATABASE_URL);
const repository = new EventRepository(db);
const connection = redisConnection(config.REDIS_URL);
const queue = createEventQueue(connection, config.QUEUE_PREFIX);

if (process.env.MIGRATE_ON_START !== 'false') await migrateToLatest(db);

const processor = createProcessor(config);
const worker = createEventWorker({
  connection,
  prefix: config.QUEUE_PREFIX,
  handler: createEventHandler({ repository, processor, metrics, logger }),
  logger,
  maxAttempts: config.MAX_ATTEMPTS,
  concurrency: config.WORKER_CONCURRENCY,
  backoff: {
    baseMs: config.BACKOFF_BASE_MS,
    factor: config.BACKOFF_FACTOR,
    maxMs: config.BACKOFF_MAX_MS,
    jitter: config.BACKOFF_JITTER,
  },
});

const reconciler = new Reconciler({
  repository,
  queue,
  logger,
  maxAttempts: config.MAX_ATTEMPTS,
  minAgeMs: config.RECONCILE_MIN_AGE_MS,
});
reconciler.start(config.RECONCILE_INTERVAL_MS);

const metricsServer = createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.setHeader('content-type', metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  } else if (req.url === '/health/live') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: worker.isRunning() ? 'ok' : 'stopping' }));
  } else {
    res.statusCode = 404;
    res.end();
  }
});
metricsServer.listen(config.WORKER_METRICS_PORT);

logger.info({ processor: processor.name, concurrency: config.WORKER_CONCURRENCY, maxAttempts: config.MAX_ATTEMPTS }, 'worker iniciado');

/**
 * Graceful shutdown: `worker.close()` para de buscar jobs novos e aguarda os que
 * estão em andamento terminarem antes de resolver. Só então fechamos as conexões.
 */
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'encerrando worker; aguardando jobs em andamento');
  await reconciler.stop();
  await worker.close();
  await queue.close();
  await db.destroy();
  metricsServer.close();
  logger.info('worker encerrado');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
