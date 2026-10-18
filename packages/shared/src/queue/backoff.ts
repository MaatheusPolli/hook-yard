export interface BackoffOptions {
  /** Delay da primeira nova tentativa, em ms. */
  baseMs: number;
  /** Multiplicador por tentativa (4 → 1s, 4s, 16s, 64s, 256s). */
  factor: number;
  /** Teto do delay, em ms. */
  maxMs: number;
  /** Fração de jitter (0.2 → ±20%). */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 1_000,
  factor: 4,
  maxMs: 15 * 60_000,
  jitter: 0.2,
};

/**
 * Delay antes da nova tentativa após a falha de número `attempt` (1-based).
 * Função pura: o gerador aleatório é injetável para testes determinísticos.
 */
export function computeDelay(
  attempt: number,
  options: Partial<BackoffOptions> = {},
  random: () => number = Math.random,
): number {
  const { baseMs, factor, maxMs, jitter } = { ...DEFAULT_BACKOFF, ...options };
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt deve ser inteiro >= 1, recebido ${attempt}`);
  }
  const exponential = Math.min(baseMs * factor ** (attempt - 1), maxMs);
  // random() ∈ [0, 1) → fator ∈ [1 - jitter, 1 + jitter)
  const jitterFactor = 1 + jitter * (random() * 2 - 1);
  return Math.max(0, Math.round(exponential * jitterFactor));
}
