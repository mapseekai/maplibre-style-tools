import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const mapLibreWorkerAssets = [
  'maplibre-gl-worker.mjs',
  'maplibre-gl-shared.mjs',
] as const;

const emitMapLibreWorker = (): Plugin => ({
  name: 'emit-maplibre-default-worker',
  apply: 'build',
  generateBundle() {
    for (const fileName of mapLibreWorkerAssets) {
      const sourceUrl = import.meta.resolve(`maplibre-gl/dist/${fileName}`);
      this.emitFile({
        type: 'asset',
        fileName: `assets/${fileName}`,
        source: readFileSync(fileURLToPath(sourceUrl)),
      });
    }
  },
});

export default defineConfig({
  plugins: [emitMapLibreWorker()],
  root: new URL('.', import.meta.url).pathname,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
