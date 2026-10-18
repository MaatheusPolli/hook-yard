import { ConflictError, EVENT_STATUSES, NotFoundError, enqueueEvent, jobIdFor} from '@hookyard/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ApiContainer } from '../container.js';

const listQuery = z.object({
  status: z.enum(EVENT_STATUSES).optional(),
  source: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParams = z.object({ id: z.uuid() });

export const eventoRoutes =
  (c: ApiContainer): FastifyPluginAsync =>
  async (app) => {
    app.get('/eventos', async (request) => {
      const query = listQuery.parse(request.query);
      const { items, total } = await c.repository.list(query);
      return { items: items, total, limit: query.limit, offset: query.offset };
    });

    app.get('/eventos/:id', async (request) => {
      const { id } = idParams.parse(request.params);
      const event = await c.repository.findById(id);
      if (!event) throw new NotFoundError('Evento não encontrado');
      const attempts = await c.repository.listAttempts(id);
      return { ...event, attemptHistory: attempts };
    });

    app.post('/eventos/:id/reprocessar', async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const current = await c.repository.findById(id);
      if (!current) throw new NotFoundError('Evento não encontrado');

      const event = await c.repository.resetForReprocess(id);
      if (!event) throw new ConflictError(`Apenas eventos na DLQ (dead) podem ser reprocessados; status atual: ${current.status}`);

      await enqueueEvent(c.queue, event.id, c.config.maxAttempts, jobIdFor(event));
      request.log.info({ eventId: event.eventId, source: event.source }, 'evento reenfileirado a partir da DLQ');
      return reply.status(202).send(event);
    });
  };
