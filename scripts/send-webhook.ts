/**
 * Envia webhooks assinados para a API — útil para demo e testes manuais.
 *
 *   pnpm demo                                   # 20 pedidos aleatórios
 *   pnpm demo --count 5 --source shopee
 *   pnpm demo --scenario retry                  # falha 2x e sucede na 3ª
 *   pnpm demo --scenario dlq                    # sempre falha → DLQ
 *   pnpm demo --scenario dlq-then-recover       # esgota 5 tentativas; reprocessar funciona
 *   pnpm demo --duplicate                       # reenvia o mesmo eventId (idempotência)
 */
import { createHmac, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.API_URL ?? 'http://localhost:3000' },
    source: { type: 'string', default: 'mercadolivre' },
    secret: { type: 'string' },
    count: { type: 'string', default: '20' },
    scenario: { type: 'string', default: 'random' },
    duplicate: { type: 'boolean', default: false },
  },
});

const source = values.source!;
const secret = values.secret ?? process.env[`WEBHOOK_SECRET_${source.toUpperCase().replaceAll('-', '_')}`] ?? `dev-secret-${source}`;

const simulate: Record<string, unknown> | undefined = {
  random: undefined,
  retry: { failAttempts: 2 },
  dlq: { alwaysFail: true },
  'dlq-then-recover': { failAttempts: 5 },
}[values.scenario!];

const types = ['order.created', 'order.paid', 'order.shipped', 'order.cancelled'];

async function send(body: object) {
  const raw = JSON.stringify(body);
  const signature = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  const res = await fetch(`${values.url}/webhooks/${source}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hookyard-signature': signature },
    body: raw,
  });
  console.log(res.status, await res.text());
}

for (let i = 0; i < Number(values.count); i++) {
  const id = `${source}-${randomUUID().slice(0, 8)}`;
  const body = {
    id,
    type: types[i % types.length],
    data: { orderId: id, total: Number((Math.random() * 500).toFixed(2)), buyer: { nickname: `comprador${i}` } },
    ...(simulate && { simulate }),
  };
  await send(body);
  if (values.duplicate) await send(body);
}
