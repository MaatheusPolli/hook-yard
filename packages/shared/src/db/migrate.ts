import { Migrator, type MigrationResultSet } from 'kysely';
import type { Db } from './client.js';
import { migrations } from './migrations/index.js';

export async function migrateToLatest(db: Db): Promise<MigrationResultSet> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
  return result;
}
