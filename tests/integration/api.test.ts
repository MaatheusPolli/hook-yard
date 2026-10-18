import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createHarness, orderPayload, scriptedProcessor, waitFor, type Harness } from '../helpers/harness.js';

describe('API de consulta, métricas e health', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness({ maxAttempts: 1 });
  });
  afterEach(async () => {
    await h.close();
  });

  async function seed() {
    h.config.webhookSecrets.shopee = 'segredo-shopee';
    const { processor } = scriptedProcessor({ failTimes: 1 }); // 1ª de cada evento falha → dead (maxAttempts=1)
    const a = (await h.postWebhook(orderPayload('a'))).json().id as string;
    h.startWorker({ processor });
    await waitFor(async () => (await h.repository.findById(a))?.status === 'dead');
    const b = (await h.postWebhook(orderPayload('b'), { source: 'shopee', secret: 'segredo-shopee' })).json().id as string;
    await waitFor(async () => (await h.repository.findById(b))?.status === 'dead');
    return { a, b };
  }

  it('GET /eventos filtra por status, source e período, com paginação', async () => {
    const { a, b } = await seed();
    await sql`update event set received_at = '2020-01-01T00:00:00Z' where id = ${a}`.execute(h.container.db);

    const all = (await h.app.inject({ url: '/eventos' })).json();
    expect(all.total).toBe(2);
    expect(all.items[0].id).toBe(b); // mais recente primeiro

    expect((await h.app.inject({ url: '/eventos?source=shopee' })).json().items.map((e: { id: string }) => e.id)).toEqual([b]);
    expect((await h.app.inject({ url: '/eventos?status=processed' })).json().total).toBe(0);
    expect((await h.app.inject({ url: '/eventos?to=2021-01-01T00:00:00Z' })).json().items.map((e: { id: string }) => e.id)).toEqual([a]);
    expect((await h.app.inject({ url: '/eventos?from=2021-01-01T00:00:00Z' })).json().items.map((e: { id: string }) => e.id)).toEqual([b]);

    const page = (await h.app.inject({ url: '/eventos?limit=1&offset=1' })).json();
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(page.items.map((e: { id: string }) => e.id)).toEqual([a]);

    expect((await h.app.inject({ url: '/eventos?status=invalido' })).statusCode).toBe(400);
  });

  it('GET /eventos/:id traz payload e histórico de tentativas; 404 se não existe', async () => {
    const { a } = await seed();
    const detail = (await h.app.inject({ url: `/eventos/${a}` })).json();
    expect(detail).toMatchObject({ id: a, eventId: 'a', status: 'dead', payload: { id: 'a', type: 'order.created' } });
    expect(detail.attemptHistory).toHaveLength(1);
    expect(detail.attemptHistory[0]).toMatchObject({ attempt: 1, success: false });

    expect((await h.app.inject({ url: '/eventos/00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
  });

  it('GET /metrics expõe contadores, fila e eventos por status no formato Prometheus', async () => {
    const { a } = await seed();
    // Reprocessa e deixa suceder para ter latência de processamento.
    await h.app.inject({ method: 'POST', url: `/eventos/${a}/reprocessar` });
    await waitFor(async () => (await h.repository.findById(a))?.status === 'processed');

    const res = await h.app.inject({ url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const text = res.body;
    expect(text).toContain('hookyard_webhooks_received_total{source="marketplace",outcome="accepted"} 1');
    expect(text).toContain('hookyard_events_processed_total{source="marketplace"} 1');
    expect(text).toContain('hookyard_event_attempts_failed_total{source="marketplace"} 1');
    expect(text).toContain('hookyard_events_dead_total{source="shopee"} 1');
    expect(text).toContain('hookyard_events{status="dead"} 1');
    expect(text).toContain('hookyard_events{status="processed"} 1');
    expect(text).toMatch(/hookyard_queue_jobs\{state="waiting"\} 0/);
    expect(text).toContain('hookyard_webhook_receive_duration_seconds_bucket');
    expect(text).toContain('hookyard_event_processing_duration_seconds_bucket');
  });

  it('GET /metrics/summary devolve contagens, latência e fila em JSON', async () => {
    await seed();
    const summary = (await h.app.inject({ url: '/metrics/summary' })).json();
    expect(summary.events).toMatchObject({ total: 2, byStatus: { dead: 2, processed: 0, received: 0 }, latencyMs: { avg: null, p95: null } });
    expect(summary.queue).toMatchObject({ waiting: 0, active: 0, failed: 2 });
  });

  it('health: live sempre 200; ready 200 com dependências ok e 503 sem Redis', async () => {
    expect((await h.app.inject({ url: '/health/live' })).json()).toEqual({ status: 'ok' });
    const ready = await h.app.inject({ url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });

    await h.queue.close();
    const down = await h.app.inject({ url: '/health/ready' });
    expect(down.statusCode).toBe(503);
    expect(down.json().checks).toEqual({ db: 'ok', redis: 'down' });
  });

  it('erros não tratados viram 500 sem vazar detalhes', async () => {
    const original = h.repository.list.bind(h.repository);
    h.repository.list = async () => {
      throw new Error('segredo interno');
    };
    const res = await h.app.inject({ url: '/eventos' });
    h.repository.list = original;
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'INTERNAL_ERROR', message: 'Erro interno' });
  });
});
