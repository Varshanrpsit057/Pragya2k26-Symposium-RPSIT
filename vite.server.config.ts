import { defineConfig } from 'vite';

/**
 * Bundles the registration server (server/node.ts) and the Google setup command
 * (server/setup.ts) for Node into dist-server/. Packages such as pdf-lib stay in
 * node_modules. Used by npm run server and npm run google:setup.
 */
export default defineConfig({
  publicDir: false,
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist-server',
    emptyOutDir: true,
    rollupOptions: {
      input: { node: 'server/node.ts', setup: 'server/setup.ts' },
    },
  },
});
