import type { Migration } from 'kysely';
import * as m0001 from './0001_create_event.js';
import * as m0002 from './0002_create_event_attempt.js';

/** Migrations versionadas, registradas estaticamente (funciona com tsx, vitest e bundlers). */
export const migrations: Record<string, Migration> = {
  '0001_create_event': m0001,
  '0002_create_event_attempt': m0002,
};
