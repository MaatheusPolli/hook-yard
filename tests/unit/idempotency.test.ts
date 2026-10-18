import { describe, expect, it } from 'vitest';
import { decideIdempotency, jobIdFor } from '@hookyard/shared';

describe('decideIdempotency', () => {
  it.each([
    ['received', 'process'],
    ['processing', 'process'],
    ['failed', 'process'],
    ['processed', 'skip'],
    ['dead', 'skip'],
    [undefined, 'skip'],
  ] as const)('status %s → %s', (status, expected) => {
    expect(decideIdempotency(status)).toBe(expected);
  });
});

describe('jobIdFor', () => {
  it('é estável para o mesmo evento na mesma geração e muda após reprocessar', () => {
    const id = '7c1d7a4e-1f0e-4a8b-9a39-2f7b0a6c1e11';
    const first = jobIdFor({ id, updatedAt: new Date(1_000) });
    expect(jobIdFor({ id, updatedAt: new Date(1_000) })).toBe(first);
    expect(jobIdFor({ id, updatedAt: new Date(2_000) })).not.toBe(first);
    expect(first).not.toContain(':'); // BullMQ não aceita ':' em jobIds customizados
  });
});
