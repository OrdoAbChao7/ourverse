import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    restoreMocks: true,
    pool: 'forks',
    coverage: {
      reporter: ['text', 'json-summary'],
      include: ['src/domain/**', 'src/data/local/**', 'src/lib/**'],
    },
  },
});
