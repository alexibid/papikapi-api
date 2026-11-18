import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.data.spec.ts'],
    exclude: ['scripts/shared/scratch/**', '**/node_modules/**'],
    environment: 'node',
  },
});
