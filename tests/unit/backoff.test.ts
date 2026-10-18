import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKOFF, computeDelay } from '@hookyard/shared';

const noJitter = () => 0.5; // random() = 0.5 → fator de jitter exatamente 1

describe('computeDelay', () => {
  it('segue a progressão 1s, 4s, 16s, 64s, 256s com os padrões', () => {
    const delays = [1, 2, 3, 4, 5].map((attempt) => computeDelay(attempt, {}, noJitter));
    expect(delays).toEqual([1_000, 4_000, 16_000, 64_000, 256_000]);
  });

  it('aplica jitter dentro de ±jitter usando RNG injetável', () => {
    expect(computeDelay(1, { jitter: 0.2 }, () => 0)).toBe(800);
    expect(computeDelay(1, { jitter: 0.2 }, () => 0.999_999)).toBe(1_200);
    expect(computeDelay(3, { jitter: 0.2 }, () => 0.25)).toBe(14_400);
  });

  it('é determinístico com o mesmo RNG', () => {
    const seq = [0.1, 0.7, 0.3];
    const run = () => {
      let i = 0;
      return [1, 2, 3].map((a) => computeDelay(a, {}, () => seq[i++]!));
    };
    expect(run()).toEqual(run());
  });

  it('respeita o teto maxMs antes de aplicar jitter', () => {
    expect(computeDelay(10, { maxMs: 5_000, jitter: 0 })).toBe(5_000);
    expect(computeDelay(10, { maxMs: 5_000, jitter: 0.1 }, () => 0)).toBe(4_500);
  });

  it('aceita base e fator customizados', () => {
    expect(computeDelay(3, { baseMs: 100, factor: 2, jitter: 0 })).toBe(400);
  });

  it('rejeita tentativas inválidas', () => {
    expect(() => computeDelay(0)).toThrow(RangeError);
    expect(() => computeDelay(1.5)).toThrow(RangeError);
  });

  it('usa Math.random por padrão e fica dentro do intervalo', () => {
    for (let i = 0; i < 50; i++) {
      const d = computeDelay(2);
      expect(d).toBeGreaterThanOrEqual(4_000 * (1 - DEFAULT_BACKOFF.jitter));
      expect(d).toBeLessThanOrEqual(4_000 * (1 + DEFAULT_BACKOFF.jitter));
    }
  });
});
