import { describe, expect, it } from 'vitest';
import { loadConfig, parseWebhookSecrets } from '@hookyard/api';
import { redisConnection, serializeError } from '@hookyard/shared';

describe('config da API', () => {
  it('lê segredos por source a partir de WEBHOOK_SECRET_*', () => {
    expect(
      parseWebhookSecrets({ WEBHOOK_SECRET_SHOPEE: 'a', WEBHOOK_SECRET_MERCADO_LIVRE: 'b', WEBHOOK_SECRET_: 'x', WEBHOOK_SECRET_VAZIO: '', OTHER: 'c' }),
    ).toEqual({ shopee: 'a', 'mercado-livre': 'b' });
  });

  it('valida variáveis obrigatórias e aplica padrões', () => {
    expect(() => loadConfig({})).toThrow();
    const config = loadConfig({ DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x', WEBHOOK_SECRET_SHOPEE: 's' });
    expect(config).toMatchObject({ port: 3000, maxAttempts: 5, webhookSecrets: { shopee: 's' } });
  });
});

describe('utilitários compartilhados', () => {
  it('converte REDIS_URL em opções de conexão', () => {
    expect(redisConnection('redis://user:p%40ss@cache:6380/2')).toMatchObject({
      host: 'cache',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      maxRetriesPerRequest: null,
    });
    expect(redisConnection('redis://localhost')).toMatchObject({ host: 'localhost', port: 6379, db: undefined, password: undefined });
  });

  it('serializa erros com stack e valores arbitrários', () => {
    expect(serializeError(new Error('x'))).toContain('Error: x');
    expect(serializeError('texto')).toBe('texto');
    const noStack = new Error('sem stack');
    noStack.stack = undefined;
    expect(serializeError(noStack)).toBe('Error: sem stack');
  });
});
