import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` exists to make a client import of a server module a BUILD error, and
      // `src/ai/jev.ts` opens with it for exactly that reason. Under vitest there is no such
      // build, and the real package throws on import, so it is aliased to an empty module here.
      // This changes nothing about `npm run build`, which is where the guard has to hold and
      // does — vitest.config.mts is not read by Next.
      'server-only': fileURLToPath(new URL('./tests/mocks/server-only.ts', import.meta.url)),
    },
  },
})
