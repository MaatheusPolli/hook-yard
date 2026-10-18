import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobIdFor } from '@hookyard/shared';
import { createHarness, orderPayload, scriptedProcessor, waitFor, type Harness } from '../helpers/harness.js';

describe('POST /webhooks/:source', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('responde 202 rapidamente, persiste o evento e enfileira o job', async () => {
    const payload = orderPayload('pedido-123');
    const started = performance.now();
    const res = await h.postWebhook(payload);
    const elapsed = performance.now() - started;

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'received', duplicate: false });
    // Medição real de p95 fica no teste de carga (k6); aqui garantimos a ordem de grandeza.
    expect(elapsed).toBeLessThan(250);

    const event = await h.repository.findById(res.json().id);
    expect(event).toMatchObject({ source: 'marketplace', eventId: 'pedido-123', type: 'order.created', status: 'received', attempts: 0 });
    expect(event!.payload).toEqual(payload);

    const job = await h.queue.getJob(jobIdFor(event!));
    expect(job?.data).toEqual({ eventId: event!.id });
    expect(job?.opts.attempts).toBe(h.config.maxAttempts);
  });

  it('aceita id numérico no envelope', async () => {
    const res = await h.postWebhook({ id: 42, type: 'order.paid' });
    expect(res.statusCode).toBe(202);
    expect((await h.repository.findById(res.json().id))?.eventId).toBe('42');
  });

  it('rejeita assinatura inválida ou ausente com 401 sem persistir nada', async () => {
    expect((await h.postWebhook(orderPayload(), { secret: 'errado' })).statusCode).toBe(401);
    expect((await h.postWebhook(orderPayload(), { signature: null })).statusCode).toBe(401);
    expect((await h.repository.list()).total).toBe(0);
  });

  it('responde 404 para source sem segredo configurado', async () => {
    const res = await h.postWebhook(orderPayload(), { source: 'desconhecido' });
    expect(res.statusCode).toBe(404);
  });

  it('responde 400 para JSON inválido, envelope incompleto ou source malformada', async () => {
    expect((await h.postWebhook('{nao-e-json')).statusCode).toBe(400);
    const missing = await h.postWebhook({ type: 'order.created' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe('VALIDATION_ERROR');
    expect((await h.postWebhook(orderPayload(), { source: 'MAIUSCULA' })).statusCode).toBe(400);
  });

  it('duplicado ainda pendente: 202 sem criar segundo registro', async () => {
    const payload = orderPayload('dup-1');
    const first = await h.postWebhook(payload);
    const second = await h.postWebhook(payload);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toMatchObject({ id: first.json().id, duplicate: true });
    expect((await h.repository.list()).total).toBe(1);
  });

  it('duplicado já processado: 200 e o processador não roda de novo', async () => {
    const { processor, calls } = scriptedProcessor();
    h.startWorker({ processor });
    const payload = orderPayload('dup-2');
    const { id } = (await h.postWebhook(payload)).json();
    await waitFor(async () => (await h.repository.findById(id))?.status === 'processed');

    const again = await h.postWebhook(payload);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id, status: 'processed', duplicate: true });

    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toHaveLength(1);
    expect((await h.repository.list()).total).toBe(1);
  });

  it('requisições concorrentes com o mesmo eventId geram um único registro', async () => {
    const payload = orderPayload('race-1');
    const responses = await Promise.all(Array.from({ length: 10 }, () => h.postWebhook(payload)));
    expect(responses.every((r) => r.statusCode === 202)).toBe(true);
    expect(responses.filter((r) => r.json().duplicate === false)).toHaveLength(1);
    expect((await h.repository.list()).total).toBe(1);
  });

  it('mesmo eventId em sources diferentes são eventos distintos', async () => {
    h.config.webhookSecrets.shopee = 'outro-segredo';
    const payload = orderPayload('shared-id');
    expect((await h.postWebhook(payload)).statusCode).toBe(202);
    expect((await h.postWebhook(payload, { source: 'shopee', secret: 'outro-segredo' })).json().duplicate).toBe(false);
    expect((await h.repository.list()).total).toBe(2);
  });

  it('persiste mesmo com a fila fora do ar (outbox): responde 202 e o evento fica received', async () => {
    await h.queue.close();
    const res = await h.postWebhook(orderPayload('fila-fora'));
    expect(res.statusCode).toBe(202);
    expect(await h.repository.findById(res.json().id)).toMatchObject({ status: 'received' });
  });
});
