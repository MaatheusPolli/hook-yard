import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('event')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('event_id', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .check(sql`status in ('received', 'processing', 'processed', 'failed', 'dead')`),
    )
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('received_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('processed_at', 'timestamptz')
    // Muda a cada transição de status; compõe o jobId e orienta o reconciliador.
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Idempotency key garantida pelo banco, não só pelo código.
    .addUniqueConstraint('event_source_event_id_key', ['source', 'event_id'])
    .execute();

  await sql`CREATE INDEX idx_event_status ON event (status, received_at DESC)`.execute(db);
  await sql`CREATE INDEX idx_event_received_at ON event (received_at DESC)`.execute(db);
  await sql`CREATE INDEX idx_event_orphans ON event (updated_at) WHERE status = 'received'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('event').execute();
}
