import { enqueueEvent, jobIdFor, type EventQueue, type EventRepository, type Logger } from '@hookyard/shared';

export interface ReconcilerDeps {
  repository: EventRepository;
  queue: EventQueue;
  logger: Logger;
  maxAttempts: number;
  /** Idade mínima de um evento `received` para ser considerado órfão. */
  minAgeMs: number;
  now?: () => Date;
}

/**
 * Lado "relay" do transactional outbox: se a API gravou o evento mas não conseguiu
 * enfileirar (Redis fora, processo morto entre os dois passos), o evento fica
 * `received` sem job. O reconciliador encontra esses órfãos e os reenfileira.
 */
export class Reconciler {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;

  constructor(private readonly deps: ReconcilerDeps) {}

  async runOnce(): Promise<number> {
    const now = this.deps.now?.() ?? new Date();
    const stale = await this.deps.repository.findStaleReceived(new Date(now.getTime() - this.deps.minAgeMs));
    let requeued = 0;
    for (const event of stale) {
      const jobId = jobIdFor(event);
      if (await this.deps.queue.getJob(jobId)) continue; // job existe: só está na fila
      await enqueueEvent(this.deps.queue, event.id, this.deps.maxAttempts, jobId);
      requeued++;
      this.deps.logger.warn({ eventId: event.eventId, source: event.source }, 'evento órfão reenfileirado');
    }
    return requeued;
  }

  start(intervalMs: number): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.runOnce()
        .catch((err) => {
          this.deps.logger.error({ err }, 'falha no reconciliador');
          return 0;
        })
        .finally(() => {
          this.running = undefined;
        });
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }
}
