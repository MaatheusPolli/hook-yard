import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/global-setup.ts'],
          // Todos os arquivos compartilham o mesmo Postgres: um único processo, arquivos em série.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**/*.ts', 'apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts'],
      exclude: [
        // Bootstraps de processo (cobertos pelo docker compose / smoke test, não por unit/integration).
        'apps/api/src/server.ts',
        'apps/worker/src/index.ts',
        'packages/shared/src/db/migrate.cli.ts',
        '**/index.ts',
        '**/lib.ts',
        '**/types.ts',
        '**/schema.ts',
      ],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
    },
  },
});
