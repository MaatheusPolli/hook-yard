import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

// BIGINT/COUNT(*) chegam como string; nossas contagens cabem em number.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export type Db = Kysely<Database>;

export function createDb(connectionString: string, max = 10): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
  });
}

export async function pingDb(db: Db): Promise<void> {
  await sql`select 1`.execute(db);
}
