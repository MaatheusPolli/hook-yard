import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sign, verifySignature } from '@hookyard/api';

const secret = 's3cr3t';
const body = JSON.stringify({ id: 'evt_1', type: 'order.created' });

describe('HMAC', () => {
  it('gera assinatura sha256=<hex> compatível com HMAC-SHA256 padrão', () => {
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    expect(sign(body, secret)).toBe(`sha256=${expected}`);
  });

  it('aceita assinatura válida (string ou Buffer)', () => {
    expect(verifySignature(body, sign(body, secret), secret)).toBe(true);
    expect(verifySignature(Buffer.from(body), sign(body, secret), secret)).toBe(true);
  });

  it('rejeita assinatura com segredo errado', () => {
    expect(verifySignature(body, sign(body, 'outro'), secret)).toBe(false);
  });

  it('rejeita corpo adulterado', () => {
    expect(verifySignature(body + ' ', sign(body, secret), secret)).toBe(false);
  });

  it('rejeita assinatura ausente, múltipla ou com esquema errado', () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
    expect(verifySignature(body, [sign(body, secret)], secret)).toBe(false);
    expect(verifySignature(body, sign(body, secret).replace('sha256=', 'md5='), secret)).toBe(false);
  });

  it('rejeita hex truncado ou inválido sem lançar exceção', () => {
    expect(verifySignature(body, sign(body, secret).slice(0, 20), secret)).toBe(false);
    expect(verifySignature(body, 'sha256=zzzz', secret)).toBe(false);
  });
});
