import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('event_attempt')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('event_id', 'uuid', (col) => col.notNull().references('event.id').onDelete('cascade'))
    .addColumn('attempt', 'integer', (col) => col.notNull())
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    .addColumn('finished_at', 'timestamptz', (col) => col.notNull())
    .addColumn('duration_ms', 'integer', (col) => col.notNull())
    .addColumn('success', 'boolean', (col) => col.notNull())
    .addColumn('error', 'text')
    .execute();

  await sql`CREATE INDEX idx_event_attempt_event ON event_attempt (event_id, attempt)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('event_attempt').execute();
}
