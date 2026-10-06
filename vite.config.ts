import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The registration server (npm run server); the dev server and preview forward /api to it,
 * passing each visitor's address along (X-Forwarded-For) so rate limits apply per student.
 */
const api = { '/api': { target: 'http://127.0.0.1:8787', xfwd: true } };

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
  },
  server: { proxy: api },
  preview: { proxy: api },
  test: {
    css: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'site',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./src/test/polyfills.ts', './src/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          include: ['server/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
