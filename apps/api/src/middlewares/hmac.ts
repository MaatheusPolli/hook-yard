import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-hookyard-signature';
const SCHEME = 'sha256=';

export function sign(body: string | Buffer, secret: string): string {
  return SCHEME + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Valida `x-hookyard-signature: sha256=<hex>` sobre o corpo cru da requisição.
 * Comparação em tempo constante para não vazar informação por timing.
 */
export function verifySignature(body: string | Buffer, header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== 'string' || !header.startsWith(SCHEME)) return false;
  const received = Buffer.from(header.slice(SCHEME.length), 'hex');
  const expected = Buffer.from(sign(body, secret).slice(SCHEME.length), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
