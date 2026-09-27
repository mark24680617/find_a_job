/**
 * `extractResume` in a plain `node` process, as `next start` runs it: no tsx, no vitest, nothing
 * in execArgv, and this process's RSS as low as a server's before its first upload. The in-process
 * tests cannot show the RSS watchdog on a real document: a vitest fork carries whatever earlier
 * floods left behind, and a tsx loader in the worker was refused by the heap ceiling first
 * (re-review of the final review's fix wave).
 *
 *   node --no-warnings plainExtract.mjs <pdf path>
 *
 * Node strips the TypeScript itself; the one hook here maps the `@/` alias onto `src/`. Prints one
 * JSON line: the bound refused on (or `parsed`), the start and peak RSS in MB, and the seconds.
 */
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const src = new URL('../../../src/', import.meta.url)
registerHooks({
  resolve: (specifier, context, next) =>
    next(specifier.startsWith('@/') ? new URL(`${specifier.slice(2)}.ts`, src).href : specifier, context),
})
const { extractResume } = await import(new URL('lib/resume/extract.ts', src).href)

const MB = 1024 * 1024
const bytes = new Uint8Array(readFileSync(process.argv[2]))
const startRss = process.memoryUsage.rss()
let peakRss = startRss
const sample = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage.rss())
}, 5)
const started = Date.now()
const outcome = await extractResume(bytes, { now: () => Date.now() }).then(
  () => ({ parsed: true }),
  (error) => ({ bound: error.bound ?? null, message: error.message }),
)
clearInterval(sample)
console.log(
  JSON.stringify({
    ...outcome,
    startMb: Math.round(startRss / MB),
    peakMb: Math.round(Math.max(peakRss, process.memoryUsage.rss()) / MB),
    seconds: (Date.now() - started) / 1000,
  }),
)
