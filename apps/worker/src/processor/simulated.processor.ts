import type { WebhookEvent } from '@hookyard/shared';
import type { EventProcessor, ProcessingContext } from './types.js';

export interface SimulatedOptions {
  /** Probabilidade de falha de cada tentativa (0..1). */
  failureRate: number;
  /** Latência simulada por tentativa, em ms. */
  latencyMs: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Diretivas opcionais no payload para demos reproduzíveis:
 * `{ "simulate": { "failAttempts": 2, "latencyMs": 50 } }` falha nas 2 primeiras
 * tentativas e sucede na 3ª; `{ "simulate": { "alwaysFail": true } }` vai para a DLQ.
 */
interface SimulateDirective {
  failAttempts?: number;
  alwaysFail?: boolean;
  latencyMs?: number;
}

export class SimulatedFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulatedFailure';
  }
}

function readDirective(payload: unknown): SimulateDirective | undefined {
  if (typeof payload !== 'object' || payload === null || !('simulate' in payload)) return undefined;
  const directive = (payload as { simulate: unknown }).simulate;
  return typeof directive === 'object' && directive !== null ? (directive as SimulateDirective) : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SimulatedProcessor implements EventProcessor {
  readonly name = 'simulated';
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: SimulatedOptions) {
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async process(event: WebhookEvent, { attempt }: ProcessingContext): Promise<void> {
    const directive = readDirective(event.payload);
    const latency = directive?.latencyMs ?? this.options.latencyMs;
    if (latency > 0) await this.sleep(latency);

    if (directive?.alwaysFail) {
      throw new SimulatedFailure(`ERP simulado recusou o evento ${event.eventId} (alwaysFail)`);
    }
    if (directive?.failAttempts !== undefined) {
      if (attempt <= directive.failAttempts) {
        throw new SimulatedFailure(`ERP simulado indisponível (tentativa ${attempt}/${directive.failAttempts} programada para falhar)`);
      }
      return;
    }
    if (this.random() < this.options.failureRate) {
      throw new SimulatedFailure('ERP simulado retornou 503 Service Unavailable');
    }
  }
}
