import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The registration API's address, baked into the website at build time:
 * VITE_API_URL if set, otherwise the API this branch's Amplify backend just deployed
 * (amplify_outputs.json, written by `ampx pipeline-deploy` or `ampx sandbox`).
 * Empty: the site calls /api on its own address (the dev server forwards it, see below).
 * Only the public API address goes here; never a secret.
 */
function apiUrl(): string {
  if (process.env.VITE_API_URL) return process.env.VITE_API_URL.replace(/\/+$/, '');
  const outputs = resolve(import.meta.dirname, 'amplify_outputs.json');
  if (!existsSync(outputs)) return '';
  const { custom } = JSON.parse(readFileSync(outputs, 'utf8')) as { custom?: { apiUrl?: string } };
  return (custom?.apiUrl ?? '').replace(/\/+$/, '');
}

/** While developing without a deployed API, /api can be forwarded to one (e.g. a sandbox). */
const devProxy = process.env.DEV_API_PROXY ? { '/api': { target: process.env.DEV_API_PROXY, changeOrigin: true } } : undefined;

/**
 * /landing/admin → /landing/admin/ in the dev server and preview, as Amplify Hosting does for
 * a folder. Only these local servers: the public site itself never mentions the admin path.
 */
const adminFolderRedirect = (): Plugin => {
  const redirect: Connect.NextHandleFunction = (request, response, next) => {
    const [path, query] = (request.url ?? '').split('?');
    if (path !== '/landing/admin') return next();
    response.statusCode = 301;
    response.setHeader('Location', `/landing/admin/${query ? `?${query}` : ''}`);
    response.end();
  };
  return {
    name: 'admin-folder-redirect',
    configureServer: (server) => void server.middlewares.use(redirect),
    configurePreviewServer: (server) => void server.middlewares.use(redirect),
  };
};

export default defineConfig({
  plugins: [react(), adminFolderRedirect()],
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl()),
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      // The public site, and the admin dashboard at /landing/admin/ (never linked from the site).
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'landing/admin/index.html'),
      },
    },
  },
  server: { proxy: devProxy },
  preview: { proxy: devProxy },
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
          // Rendering the whole page in jsdom takes several seconds while every file runs at once.
          testTimeout: 20_000,
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
