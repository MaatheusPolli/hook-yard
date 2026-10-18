export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Assinatura inválida') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export function serializeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * Erro que não adianta tentar de novo (ex.: 4xx do ERP, payload inválido).
 * O worker move o evento direto para a DLQ.
 */
export class PermanentProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentProcessingError';
  }
}
