import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The app code imports through the `@/*` alias from tsconfig.json (app/page.tsx, app/api/brief).
  // Vitest does not read tsconfig paths on its own, so a tested file behind that alias fails to
  // resolve. This mirrors the alias to the project root, the same mapping tsconfig declares.
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
  },
});
