import { migrateToLatest } from '@hookyard/shared';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

const config = loadConfig();
const container = createContainer(config);
const app = buildApp(container);

if (process.env.MIGRATE_ON_START !== 'false') await migrateToLatest(container.db);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  container.logger.info({ signal }, 'encerrando API');
  await app.close();
  await container.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
