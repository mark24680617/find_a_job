import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // An agent's git worktree under .claude/ holds a full copy of tests/, whose copies fail
    // against this checkout's React; they are not this checkout's tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
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
