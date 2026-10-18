import { NotFoundError, UnauthorizedError, ValidationError, enqueueEvent, jobIdFor } from '@hookyard/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ApiContainer } from '../container.js';
import { SIGNATURE_HEADER, verifySignature } from '../middlewares/hmac.js';

const paramsSchema = z.object({ source: z.string().regex(/^[a-z0-9-]{1,64}$/, 'source inválida') });

/** Envelope mínimo exigido; o restante do corpo é guardado como payload. */
const bodySchema = z.looseObject({
  id: z.union([z.string().min(1).max(255), z.number()]).transform(String),
  type: z.string().min(1).max(255),
});

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export const webhookRoutes =
  (c: ApiContainer): FastifyPluginAsync =>
  async (app) => {
    // Parser encapsulado neste plugin: guarda o corpo cru para validar o HMAC.
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
      request.rawBody = body as Buffer;
      done(null, body);
    });

    app.post('/webhooks/:source', async (request, reply) => {
      const started = process.hrtime.bigint();
      const { source } = paramsSchema.parse(request.params);

      const secret = c.config.webhookSecrets[source];
      if (!secret) throw new NotFoundError(`Source desconhecida: ${source}`);

      const raw = request.rawBody ?? Buffer.alloc(0);
      if (!verifySignature(raw, request.headers[SIGNATURE_HEADER], secret)) {
        c.metrics.received.inc({ source, outcome: 'rejected' });
        throw new UnauthorizedError();
      }

      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new ValidationError('Corpo não é JSON válido');
      }
      const body = bodySchema.parse(json);

      // 1) Persistir ANTES de enfileirar: se a fila cair, o reconciliador recupera.
      const { event, created } = await c.repository.insertIfAbsent({
        source,
        eventId: body.id,
        type: body.type,
        payload: json,
      });

      if (!created) {
        c.metrics.received.inc({ source, outcome: 'duplicate' });
        request.log.info({ eventId: event.eventId, source, status: event.status }, 'webhook duplicado');
        const status = event.status === 'processed' ? 200 : 202;
        return reply.status(status).send({ id: event.id, status: event.status, duplicate: true });
      }

      // 2) Enfileirar. Falha aqui não perde o evento: ele fica `received` no banco.
      try {
        await enqueueEvent(c.queue, event.id, c.config.maxAttempts, jobIdFor(event));
      } catch (err) {
        request.log.warn({ err, eventId: event.eventId, source }, 'falha ao enfileirar; reconciliador irá reenfileirar');
      }

      c.metrics.received.inc({ source, outcome: 'accepted' });
      c.metrics.receiveDuration.observe({ source }, Number(process.hrtime.bigint() - started) / 1e9);
      request.log.info({ eventId: event.eventId, type: event.type, source }, 'webhook aceito');
      return reply.status(202).send({ id: event.id, status: event.status, duplicate: false });
    });
  };
