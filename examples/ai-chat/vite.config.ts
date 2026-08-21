import { defineConfig } from 'vite';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  // maplibre-gl derives its web worker URL from import.meta.url; the dep
  // optimizer output has no worker file next to it, so serve from source.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
});
