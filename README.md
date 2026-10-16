# HookYard

> Receptor de webhooks com fila, retry exponencial, dead-letter queue e painel de observabilidade.
> O "pÃ¡tio de manobras" entre o marketplace e o ERP.

Webhook de marketplace nÃ£o espera: se o endpoint demora ou cai, o evento Ã© perdido ou reenviado em duplicidade. IntegraÃ§Ãµes ingÃªnuas processam o pedido **dentro** do request HTTP â€” e quando o ERP fica lento, o marketplace recebe timeout e a operaÃ§Ã£o vira incidente.

O HookYard separa **receber** de **processar**:

1. `POST /webhooks/:source` valida a assinatura HMAC, grava o evento e responde `202` em milissegundos.
2. Um worker consome a fila e processa com retry exponencial + jitter; apÃ³s N tentativas, move para a DLQ.
3. IdempotÃªncia por `eventId`: reentrega do mesmo evento nÃ£o duplica efeito.
4. Um painel web lista eventos, status, tentativas e payload, e permite reprocessar itens da DLQ.

![Painel â€” lista de eventos](docs/painel-eventos.png)

## Arquitetura

```mermaid
flowchart LR
    MP[Marketplace] -- "POST /webhooks/:source<br/>x-hookyard-signature" --> API

    subgraph API [API Â· Fastify]
      direction TB
      H[1. valida HMAC] --> P[2. grava Event<br/>status=received] --> Q[3. enfileira job]
    end

    P -- INSERT ... ON CONFLICT --> PG[(PostgreSQL)]
    Q -- jobId = id+geraÃ§Ã£o --> R[(Redis Â· BullMQ)]
    API -- 202 Accepted --> MP

    R --> W[Worker]
    W -- "idempotÃªncia:<br/>jÃ¡ processed? pula" --> PG
    W -- EventProcessor --> ERP[ERP / simulador]
    W -- "falha â†’ backoff<br/>1s, 4s, 16s, 64s, 256s" --> R
    W -- "esgotou â†’ status=dead (DLQ)" --> PG

    REC[Reconciliador<br/>outbox] -- "received sem job?<br/>reenfileira" --> R
    REC --> PG

    UI[Painel React] -- /eventos, /metrics/summary,<br/>/eventos/:id/reprocessar --> API
    PROM[Prometheus] -. /metrics .-> API
    PROM -. :9464/metrics .-> W
```

Ciclo de vida de um evento:

```mermaid
stateDiagram-v2
    [*] --> received: POST /webhooks (202)
    received --> processing: worker pega o job
    processing --> processed: sucesso
    processing --> failed: erro, ainda hÃ¡ tentativas
    failed --> processing: apÃ³s backoff
    processing --> dead: esgotou tentativas / erro permanente (4xx)
    dead --> received: POST /eventos/:id/reprocessar
    processed --> [*]
```

### PadrÃµes aplicados

| PadrÃ£o | Onde | Por quÃª |
|---|---|---|
| **Persistir antes de enfileirar (outbox)** | `routes/webhooks.ts`, `worker/reconciler.ts` | Se o Redis estiver fora, o POST ainda responde 202 e o evento fica `received`. O reconciliador acha eventos `received` sem job e os reenfileira. |
| **Idempotency key no banco** | `UNIQUE (source, event_id)` + `INSERT â€¦ ON CONFLICT DO NOTHING` | RequisiÃ§Ãµes concorrentes com o mesmo `eventId` geram um Ãºnico registro (hÃ¡ teste com 10 POSTs em paralelo). |
| **IdempotÃªncia no consumo** | `markProcessing` sÃ³ transiciona a partir de `received/processing/failed` | Processamento *at-least-once* com efeito *exactly-once*: um job entregue duas vezes nÃ£o reprocessa evento `processed`. |
| **jobId determinÃ­stico** | `jobIdFor(event)` = `id` + `updated_at` | Enfileirar duas vezes o mesmo evento (API + reconciliador) nÃ£o duplica o job; reprocessar gera uma nova "geraÃ§Ã£o". |
| **Strategy de processador** | `EventProcessor` â†’ `SimulatedProcessor`, `HttpProcessor` | O worker nÃ£o sabe se fala com ERP real ou simulador. Facilita demo e teste. |
| **Backoff puro e testÃ¡vel** | `computeDelay(attempt, opts, random)` | FunÃ§Ã£o pura, RNG injetÃ¡vel â†’ testes determinÃ­sticos do jitter. |
| **Erros permanentes** | `PermanentProcessingError` (ex.: ERP responde 422) | NÃ£o adianta tentar 5x um payload invÃ¡lido: vai direto para a DLQ. |
| **Graceful shutdown** | `worker.close()` no SIGTERM | Para de pegar jobs novos e espera os em andamento terminarem. |

### Backoff exponencial com jitter

```
delay(n) = min(base Ã— fatorâ¿â»Â¹, teto) Ã— (1 Â± jitter)
```

Com os padrÃµes (`base=1s`, `fator=4`, `jitter=Â±20%`) as novas tentativas acontecem apÃ³s ~**1s, 4s, 16s, 64s, 256s**. O jitter evita a *thundering herd*: quando o ERP volta, milhares de eventos que falharam juntos nÃ£o tentam de novo no mesmo milissegundo. O cÃ¡lculo Ã© registrado no BullMQ como estratÃ©gia customizada (`settings.backoffStrategy`), entÃ£o o agendamento sobrevive a restart do worker.

## Rodando

Requisitos: Docker (com Compose) e, para desenvolvimento, Node 22 + pnpm 10.

```bash
docker compose up --build
```

| ServiÃ§o | URL |
|---|---|
| Painel | http://localhost:8080 |
| API | http://localhost:3000 |
| MÃ©tricas da API | http://localhost:3000/metrics |
| MÃ©tricas do worker | http://localhost:9464/metrics |

Gerando trÃ¡fego de demonstraÃ§Ã£o (assinado com os segredos de dev do compose):

```bash
pnpm install
pnpm demo                                  # 20 pedidos; ~30% falham na 1Âª tentativa (SIMULATED_FAILURE_RATE)
pnpm demo --scenario retry                 # falha 2x e sucede na 3Âª
pnpm demo --scenario dlq                   # sempre falha â†’ DLQ
pnpm demo --scenario dlq-then-recover      # esgota as 5 tentativas; "Reprocessar" no painel conclui na 6Âª
pnpm demo --duplicate --source shopee      # reenvia o mesmo eventId â†’ um Ãºnico registro
```

Enviando um webhook manualmente:

```bash
BODY='{"id":"pedido-123","type":"order.created","data":{"total":199.9}}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac dev-secret-mercadolivre | awk '{print $2}')"
curl -i localhost:3000/webhooks/mercadolivre -H 'content-type: application/json' -H "x-hookyard-signature: $SIG" -d "$BODY"
```

### Desenvolvimento local

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm install
pnpm migrate
pnpm dev:api      # :3000
pnpm dev:worker   # :9464
pnpm dev:web      # :5173 (proxy /api â†’ :3000)
```

### ConfiguraÃ§Ã£o

| VariÃ¡vel | PadrÃ£o | DescriÃ§Ã£o |
|---|---|---|
| `WEBHOOK_SECRET_<SOURCE>` | â€” | Segredo HMAC por source. `WEBHOOK_SECRET_MERCADO_LIVRE` habilita `/webhooks/mercado-livre`. |
| `MAX_ATTEMPTS` | `5` | Tentativas antes da DLQ. |
| `BACKOFF_BASE_MS` / `BACKOFF_FACTOR` / `BACKOFF_JITTER` / `BACKOFF_MAX_MS` | `1000` / `4` / `0.2` / `900000` | ParÃ¢metros do backoff. |
| `WORKER_CONCURRENCY` | `5` | Jobs simultÃ¢neos por worker. |
| `RECONCILE_INTERVAL_MS` / `RECONCILE_MIN_AGE_MS` | `30000` / `10000` | FrequÃªncia do reconciliador e idade mÃ­nima de um Ã³rfÃ£o. |
| `PROCESSOR` | `simulated` | `simulated` ou `http`. |
| `SIMULATED_FAILURE_RATE` / `SIMULATED_LATENCY_MS` | `0.3` / `200` | Comportamento do ERP simulado. |
| `PROCESSOR_HTTP_URL` / `PROCESSOR_HTTP_TIMEOUT_MS` | â€” / `5000` | Destino do `HttpProcessor` (envia `idempotency-key`). 5xx/408/429 â†’ retry; demais 4xx â†’ DLQ. |

O payload pode trazer `"simulate": { "failAttempts": 2 }`, `{ "alwaysFail": true }` ou `{ "latencyMs": 3000 }` para demos reproduzÃ­veis com o processador simulado.

## API

| MÃ©todo | Rota | DescriÃ§Ã£o |
|---|---|---|
| `POST` | `/webhooks/:source` | Recebe o webhook. Corpo JSON com `id` e `type` (o resto vira payload). Header `x-hookyard-signature: sha256=<hmac hex do corpo cru>`. **202** aceito Â· **200** duplicado jÃ¡ processado Â· **401** assinatura invÃ¡lida Â· **404** source desconhecida Â· **400** corpo invÃ¡lido. |
| `GET` | `/eventos` | Lista com filtros `status`, `source`, `from`, `to` (ISO 8601), `limit`, `offset`. |
| `GET` | `/eventos/:id` | Detalhe com payload e `attemptHistory` (inÃ­cio, duraÃ§Ã£o, erro de cada tentativa). |
| `POST` | `/eventos/:id/reprocessar` | Reenfileira item da DLQ. **409** se o evento nÃ£o estÃ¡ `dead`. |
| `GET` | `/metrics` | Prometheus: recebidos, processados, falhas, DLQ, tamanho da fila, eventos por status, histogramas de latÃªncia. |
| `GET` | `/metrics/summary` | Resumo JSON usado pelo painel. |
| `GET` | `/health/live` Â· `/health/ready` | Liveness (processo de pÃ©) e readiness (Postgres + Redis respondendo, com timeout). |

## Testes

```bash
pnpm test             # unit + integraÃ§Ã£o (Testcontainers sobe Postgres e Redis)
pnpm test:coverage    # com relatÃ³rio de cobertura (limite: 85%)
pnpm test:unit        # sem Docker
```

Sem Docker disponÃ­vel, aponte para serviÃ§os existentes com `TEST_DATABASE_URL` e `TEST_REDIS_URL`.

Os testes provam o comportamento **sob falha**, nÃ£o sÃ³ no caminho feliz:

| Arquivo | O que prova |
|---|---|
| `unit/backoff.test.ts` | ProgressÃ£o 1sâ†’256s, jitter com RNG fixo, teto, entradas invÃ¡lidas. |
| `unit/hmac.test.ts` | Assinatura vÃ¡lida / invÃ¡lida / ausente / adulterada / truncada. |
| `unit/idempotency.test.ts`, `unit/event-handler.test.ts` | DecisÃ£o de idempotÃªncia, retry vs. DLQ, erro permanente, mÃ©tricas. |
| `integration/receive.test.ts` | 202 rÃ¡pido e evento persistido antes do job; duplicado nÃ£o cria registro nem reprocessa; 10 POSTs concorrentes â†’ 1 registro; Redis fora â†’ ainda 202. |
| `integration/retry.test.ts` | Processador falha 2x e sucede na 3Âª, com intervalos â‰¥ delays calculados. |
| `integration/dlq.test.ts` | Esgota tentativas â†’ `dead` com stack; aparece em `/eventos?status=dead`; 4xx vai direto. |
| `integration/reprocess.test.ts` | DLQ â†’ reprocessar â†’ `processed`; 409/404/400. |
| `integration/reconciler.test.ts` | Evento `received` sem job Ã© reenfileirado; nÃ£o duplica job existente. |
| `integration/shutdown.test.ts` | Fechar o worker durante um job lento espera a conclusÃ£o. |
| `integration/api.test.ts` | Filtros, paginaÃ§Ã£o, `/metrics`, health checks, erro 500 sem vazar detalhes. |

Resultado atual: **74 testes**, cobertura de **~93% de linhas**.

### Carga (k6)

```bash
docker compose up -d
pnpm load    # 500 req/s por 30s contra POST /webhooks/mercadolivre
```

Resultado com o stack do `docker compose` (API, worker, Postgres e Redis na mesma mÃ¡quina de 4 vCPUs, worker processando em paralelo):

| MÃ©trica | Valor |
|---|---|
| Taxa | 500 req/s por 30 s (15.001 requisiÃ§Ãµes) |
| Respostas 202 | 100% |
| Mediana | 2,96 ms |
| **p95** | **7,96 ms** (meta: < 50 ms) |
| p99 | 36,5 ms |

## Painel

| DLQ com histÃ³rico de tentativas e stack | Retry que sucedeu na 3Âª tentativa |
|---|---|
| ![DLQ](docs/painel-dlq.png) | ![Retry](docs/painel-retry.png) |

## Estrutura

```
hook-yard/
â”œâ”€â”€ docker-compose.yml         postgres + redis + api + worker + web
â”œâ”€â”€ Dockerfile                 imagem da API e do worker
â”œâ”€â”€ packages/shared/src/
â”‚   â”œâ”€â”€ domain/                event, status, errors, decisÃ£o de idempotÃªncia
â”‚   â”œâ”€â”€ queue/                 fila BullMQ e backoff (funÃ§Ã£o pura)
â”‚   â”œâ”€â”€ db/                    Kysely, migrations versionadas, EventRepository
â”‚   â””â”€â”€ observability/         pino (sem payload nos logs) e prom-client
â”œâ”€â”€ apps/api/src/
â”‚   â”œâ”€â”€ server.ts  app.ts  container.ts  config.ts
â”‚   â”œâ”€â”€ routes/                webhooks, eventos, metrics, health
â”‚   â””â”€â”€ middlewares/           hmac, error-handler
â”œâ”€â”€ apps/worker/src/
â”‚   â”œâ”€â”€ index.ts               bootstrap, /metrics e graceful shutdown
â”‚   â”œâ”€â”€ worker.ts              adaptador BullMQ (retry â†’ backoff, dead â†’ falha final)
â”‚   â”œâ”€â”€ handlers/              event.handler (independente da fila)
â”‚   â”œâ”€â”€ processor/             EventProcessor, simulado e HTTP
â”‚   â””â”€â”€ reconciler.ts          outbox: reenfileira Ã³rfÃ£os
â”œâ”€â”€ apps/web/src/              React + Vite + TanStack Query
â”œâ”€â”€ scripts/send-webhook.ts    gerador de trÃ¡fego para demo
â””â”€â”€ tests/                     unit, integration (Testcontainers), load (k6)
```

## DecisÃµes e trade-offs

- **O repositÃ³rio de eventos vive em `packages/shared`** (e nÃ£o em `apps/api`), porque API e worker o usam.
- **Tabela `event_attempt`** alÃ©m do schema original: o painel mostra o histÃ³rico de cada tentativa (inÃ­cio, duraÃ§Ã£o, erro) e o intervalo real de backoff entre elas.
- **Coluna `updated_at`** em `event`: compÃµe o `jobId` (dedup de enfileiramento por geraÃ§Ã£o) e alimenta o Ã­ndice parcial do reconciliador.
- **O job carrega sÃ³ o id do evento**, nunca o payload: o banco Ã© a fonte da verdade e o Redis nÃ£o guarda dado sensÃ­vel.
- **Logs** incluem apenas `eventId`, `type` e `source`; `payload`/`body` sÃ£o removidos pelo `redact` do pino.
- **Tentativas acumulam** entre reprocessamentos (a 6Âª tentativa aparece como 6Âª no histÃ³rico), mas o limite de tentativas vale por rodada de fila.
- **TypeScript executado com `tsx`** tambÃ©m em produÃ§Ã£o, para manter o monorepo sem etapa de build dos pacotes internos.

## Definition of Done

- [x] p95 do `POST /webhooks` < 50 ms sob 500 req/s (7,96 ms â€” ver [Carga](#carga-k6)).
- [x] Testes provando retry, DLQ, idempotÃªncia e reprocessamento.
- [x] `docker compose up` sobe tudo e o painel funciona.
- [x] CI com Testcontainers (`.github/workflows/ci.yml`).
- [ ] Post no LinkedIn com o diagrama do fluxo â€” rascunho em [`docs/post-linkedin.md`](docs/post-linkedin.md).

## LicenÃ§a

MIT


## Licença

### Uso Pessoal
Este projeto é licenciado sob a **Licença MIT** para uso pessoal, educacional e não comercial.

### Uso Comercial
Se você deseja usar este projeto comercialmente, deve obter uma licença comercial do autor.

**Uso comercial inclui:**
- Incorporar em um produto comercial
- Oferecer como serviço
- Usar em atividades com fins lucrativos
- Implantação empresarial

**Para obter uma licença comercial:**
Email: ma.polli@hotmail.com
