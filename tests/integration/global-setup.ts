import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { createDb, migrateToLatest } from '@hookyard/shared';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/**
 * Sobe Postgres e Redis reais com Testcontainers. Para rodar contra serviços já
 * existentes (ex.: sem Docker), defina TEST_DATABASE_URL e TEST_REDIS_URL.
 */
export default async function setup(project: TestProject) {
  const stops: Array<() => Promise<unknown>> = [];

  let databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    const pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    stops.push(() => pg.stop());
    databaseUrl = pg.getConnectionUri();
  }

  let redisUrl = process.env.TEST_REDIS_URL;
  if (!redisUrl) {
    const redis = await new RedisContainer('redis:7-alpine').start();
    stops.push(() => redis.stop());
    redisUrl = redis.getConnectionUrl();
  }

  const db = createDb(databaseUrl, 1);
  try {
    await migrateToLatest(db);
  } finally {
    await db.destroy();
  }

  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', redisUrl);

  return async () => {
    for (const stop of stops.reverse()) await stop();
  };
}
