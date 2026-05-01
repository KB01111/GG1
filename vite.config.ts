import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import sveltePreprocess from 'svelte-preprocess';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte({ preprocess: sveltePreprocess() })],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
