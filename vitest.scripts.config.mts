import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.spec.ts', 'src/**/*.spec.ts'],
    exclude: ['scripts/shared/scratch/**', '**/node_modules/**', '**/*.data.spec.ts'],
    setupFiles: ['scripts/shared/testing/isolated-workspace.setup.ts'],
    environment: 'node',
  },
});
