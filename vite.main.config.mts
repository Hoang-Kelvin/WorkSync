import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // SQLite is built into Electron's Node.js, so it is never bundled.
      external: ['node:sqlite'],
    },
  },
});
