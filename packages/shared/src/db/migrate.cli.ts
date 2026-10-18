import { createDb } from './client.js';
import { migrateToLatest } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido');
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const { results } = await migrateToLatest(db);
  for (const r of results ?? []) console.log(`${r.status}: ${r.migrationName}`);
  if (!results?.length) console.log('Nenhuma migration pendente');
} finally {
  await db.destroy();
}
