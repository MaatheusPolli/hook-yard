import { AppError, ValidationError } from '@hookyard/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Requisição inválida', details: error.issues });
  }
  if (error instanceof ValidationError) {
    return reply.status(400).send({ error: error.code, message: error.message, details: error.details });
  }
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (statusCode < 500) {
    return reply.status(statusCode).send({ error: 'BAD_REQUEST', message: error.message });
  }
  request.log.error({ err: error }, 'erro não tratado');
  return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Erro interno' });
}
