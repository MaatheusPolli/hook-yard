import {
  EventRepository,
  createDb,
  createEventQueue,
  createLogger,
  createMetrics,
  redisConnection,
  type Db,
  type EventQueue,
  type Logger,
  type Metrics,
} from '@hookyard/shared';
import type { ApiConfig } from './config.js';

export interface ApiContainer {
  config: ApiConfig;
  db: Db;
  repository: EventRepository;
  queue: EventQueue;
  metrics: Metrics;
  logger: Logger;
  close(): Promise<void>;
}

export function createContainer(config: ApiConfig, overrides: Partial<Pick<ApiContainer, 'logger' | 'metrics'>> = {}): ApiContainer {
  const db = createDb(config.databaseUrl);
  const queue = createEventQueue(redisConnection(config.redisUrl), config.queuePrefix);
  return {
    config,
    db,
    repository: new EventRepository(db),
    queue,
    metrics: overrides.metrics ?? createMetrics({ defaultMetrics: true }),
    logger: overrides.logger ?? createLogger('api'),
    async close() {
      await queue.close();
      await db.destroy();
    },
  };
}
