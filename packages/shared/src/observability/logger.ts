import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Logger estruturado. Campos que podem carregar dados sensíveis do marketplace
 * são removidos: logamos apenas identificadores (`eventId`, `type`, `source`).
 */
export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['payload', '*.payload', 'body', '*.body', 'req.headers.authorization', 'req.headers["x-hookyard-signature"]'],
      remove: true,
    },
    ...options,
  });
}

export type { Logger };
