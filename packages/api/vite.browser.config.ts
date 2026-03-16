import path from 'path';

import { defineConfig } from 'vite';
import peggyLoader from 'vite-plugin-peggy-loader';

const distDir = path.resolve(__dirname, 'dist');

export default defineConfig({
  build: {
    target: 'esnext',
    outDir: distDir,
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, 'index.web.ts'),
      formats: ['es'],
      fileName: () => 'browser.js',
    },
    rollupOptions: {
      external: [
        // These are browser APIs provided by the environment
        /^node:/,
      ],
    },
  },
  plugins: [peggyLoader()],
  resolve: {
    // Default extensions — picks up browser implementations (index.ts)
    // instead of .api.ts (which resolves to Node.js/Electron code)
    extensions: ['.js', '.ts', '.tsx', '.json'],
  },
});
