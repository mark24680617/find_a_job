import { Worker } from 'node:worker_threads'
import {
  ExtractError,
  MAX_EXTRACT_MS,
  MAX_PARSE_RSS_BYTES,
  MAX_RESUME_BULLETS,
  MAX_RESUME_CHARS,
  MAX_RESUME_LINES,
  MAX_RESUME_PAGES,
  NORMAL_PARSE_GROWTH_BYTES,
} from '@/lib/resume/bounds'
import { parseDateRange } from '@/lib/resume/dates'
import { detectLanguage, structure } from '@/lib/resume/structure'
import type { Extracted, StoredResume } from '@/lib/resume/types'

/**
 * The PDF reader. With `pdfWorker.mjs`, the thread it starts, the only code on this feature that
 * touches `pdfjs-dist`; and the only place the parser is configured, so there is one set of
 * hardening flags rather than one per caller — the worker is handed them in `workerData`.
 * Server-only by construction: nothing that renders imports this module.
 *
 * The flags are not defaults; they are Task A3's `HARDENING`, spread verbatim — the set A3's
 * zero-network run was measured under (docs/notes/deps.md, "The pdfjs spike"). `useWasm: false`,
 * with `wasmUrl` and `iccUrl` left unset, closes the parser's newest ways to reach for a file;
 * `standardFontDataUrl` and `cMapUrl` are unset and `useWorkerFetch` is false, so nothing it reads
 * can reach out; `enableXfa` is off because an XFA form is a scripting surface and a resume is
 * not one; `isImageDecoderSupported: false` keeps image decoding off the platform decoder;
 * `fontExtraProperties: true` is what A3 measured under; `verbosity: 0` keeps the parser's own
 * console warnings out of the server log. No eval option is passed, because 6.3.289 has none
 * (A3 Step 3). The defence against a crafted font is the pinned version, checked against the
 * pdf.js advisory list A3 recorded in deps.md on 2026-09-24: CVE-2024-4367 (patched 4.2.67) and
 * CVE-2026-16633 (patched 6.2.108) are both fixed at or below 6.3.289. (amended 2026-09-24, R10)
 *
 * Four invariants everything downstream rests on:
 *   • `lines` is in reading order — page ascending, then y descending (PDF user space counts up
 *     the page), then x ascending. Re-reading the same file yields the same order, which is what
 *     makes `b1 … bN` stable across uploads (spec §5.1).
 *   • A hidden run is stored with `size: 0` and `hiddenBy` naming why: `'size'` for a run under
 *     the legible floor, `'colour'` for a run filled white, read through `getOperatorList()` —
 *     the method Task A3's `colour` arm measured. `text` is the join of the runs with
 *     `size > 0`. `size === 0` is therefore the one test for "the reader never sees this", used
 *     by §6.1's hidden-text check and by §8's exclusion of hidden text from every model input
 *     alike; `hiddenBy` only tells §6.1's two rows apart. (R9) White counts as hidden unless the
 *     run sits on a known dark rectangle painted before it and nothing is painted over it
 *     (final review, extract-3; the walk is in `pdfWorker.mjs`).
 *   • Text drawn off the page box never arrives: pdfjs-dist 6.3.289 drops it before
 *     `getTextContent()` returns (Task A1, Task A3, deps.md, Open decision 5). The `offPage` term
 *     below is a defensive guard for a version that stops dropping it, not a path any fixture
 *     reaches. (R2)
 *   • Every entry's `from`/`to` is resolved here, once, through `parseDateRange` (Task C1),
 *     against the day `opts.now()` names — so the upload route and the smoke read the same dates.
 *     `structure()` leaves them null; a side that cannot be read stays null (D4). (R3)
 *
 * The bounds are checked in the order they become knowable: pages up front, then lines, then
 * characters, then bullets, with the deadline, the heap ceiling and the RSS watchdog over the
 * parse. The parse runs in `pdfWorker.mjs`, a worker thread (final review, extract-1): R14's
 * deadline used to be raced at the parser's own yield points in this process, and pdfjs builds a
 * page's whole operator list before it yields, so a page of a million rectangles ran the process
 * out of memory first. Now this thread's timer terminates the worker at MAX_EXTRACT_MS whether or
 * not pdfjs yields; a heap past WORKER_LIMITS kills the worker alone, and a parse that takes the
 * process's RSS past MAX_PARSE_RSS_BYTES gets it terminated from here — both refused with the
 * `memory` sentence. The injected clock is also read after the worker answers. A document past
 * two bounds is refused naming the first one reached, which is the one the reader can act on.
 */

type Line = StoredResume['lines'][number]
type HiddenBy = NonNullable<Line['hiddenBy']>

/**
 * Task A3's hardening, verbatim (`scripts/spike-pdfjs.ts` keeps its copy as the record of what
 * was measured). Declared `as const` rather than `Record<string, unknown>`, so the pinned
 * typings check every value where it is spread into `getDocument`. (R10)
 */
export const HARDENING = {
  enableXfa: false,
  disableFontFace: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  useWasm: false,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  fontExtraProperties: true,
  verbosity: 0,
} as const

/**
 * `maxImageSize` for `getDocument`: no image is decoded. `getOperatorList()` decodes every image
 * XObject on the page, unawaited — the op list resolves first — so the decode runs outside the
 * deadline race. The reader draws nothing, so it decodes nothing: pdfjs drops an image whose
 * w×h exceeds `maxImageSize` before decoding it and, under the default `ignoreErrors`
 * (`stopAtErrors` unset), warns and carries on, and `verbosity: 0` keeps that warning out of the
 * log. The controller's probe of 2026-09-24: one 8000×8000 Flate image in a 183 KB PDF took peak
 * RSS from 304 MB to ~675 MB some 3 s after the op list resolved; capped, it peaked at 308 MB
 * with the same text. Kept out of `HARDENING`, so A3's measured set stays verbatim (R10).
 */
const NO_IMAGES = 0

/** Under one point nobody is reading it. The geometry half of §8's hidden-text rule. */
const MIN_GLYPH_SIZE = 1

/** A run joins the line above when its baseline is within half that line's size of it. */
const LINE_Y_RATIO = 0.5

/** A gap wider than this fraction of the size is a word break the PDF drew rather than typed. */
const WORD_GAP_RATIO = 0.25

interface Run extends Line {
  width: number
  /** Why the reader never sees this run, or null when they do. */
  hide: HiddenBy | null
}

function closeLine(run: Run, parts: string[]): Line {
  const line: Line = {
    page: run.page,
    x: run.x,
    y: run.y,
    size: run.hide === null ? run.size : 0,
    font: run.font,
    text: parts.join('').trimEnd(),
  }
  // No `hiddenBy: undefined` key on a visible line: the field is present exactly when size is 0.
  return run.hide === null ? line : { ...line, hiddenBy: run.hide }
}

/**
 * Runs to lines: grouped into rows by baseline, each row read left to right, then folded together
 * while their hidden-ness agrees. A row is anchored on its top-most run, never its last, so rows
 * cannot chain down the page; and it is sorted by x before folding, so a run a fraction of a point
 * above its neighbour — a right-aligned date in its own box, a bullet glyph set in another font —
 * still reads in x order (spec §5.1).
 */
function toLines(runs: Run[]): Line[] {
  const sorted = [...runs].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const rows: Run[][] = []
  for (const run of sorted) {
    const row = rows[rows.length - 1]
    const top = row?.[0]
    const joins =
      top !== undefined &&
      top.page === run.page &&
      Math.abs(top.y - run.y) <= Math.max(top.size, MIN_GLYPH_SIZE) * LINE_Y_RATIO
    if (joins) row.push(run)
    else rows.push([run])
  }

  const lines: Line[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    let open: { run: Run; parts: string[]; right: number } | null = null
    for (const run of row) {
      if (open === null || open.run.hide !== run.hide) {
        if (open !== null) lines.push(closeLine(open.run, open.parts))
        open = { run, parts: [run.text], right: run.x + run.width }
        continue
      }
      const last = open.parts[open.parts.length - 1]
      if (run.x - open.right > run.size * WORD_GAP_RATIO && !/\s$/.test(last)) open.parts.push(' ')
      open.parts.push(run.text)
      open.right = run.x + run.width
    }
    if (open !== null) lines.push(closeLine(open.run, open.parts))
  }
  return lines
}

// ── The worker (final review, extract-1) ─────────────────────────────────────────────────

/**
 * The parse runs in `pdfWorker.mjs`, a `node:worker_threads` Worker, so that a document built to
 * exhaust memory exhausts the worker's heap and not the server's. Loaded by URL beside this file:
 * vitest and tsx read it from `src/`, and `next build` copies it into the server output with the
 * route that imports this module (checked with `npm run build`). `pdfjs-dist` stays a
 * `serverExternalPackages` entry, resolved from node_modules by the worker as by any server file.
 */
export const PDF_WORKER_URL = new URL('./pdfWorker.mjs', import.meta.url)

/**
 * The worker's V8 heap ceilings, measured in plain `node` on macOS on 2026-09-26 (RSS above a bare
 * process, which idles at ~44 MB):
 *   • ten dense pages (600 runs, ~47k characters): parsed in ~0.2 s at +93 MB — most of it the
 *     worker's own pdfjs import, the same ~50 MB deps.md's Peak RSS rows measured in-process;
 *   • a 26 KB page of 1M `re f` rectangles, and a 76 KB page of 1M text runs: refused with
 *     ERR_WORKER_OUT_OF_MEMORY within ~0.8 s, at +227 MB at worst. At 128 MB the same floods
 *     peaked at +326 MB.
 * What they bound is the worker's V8 heap and nothing else: the op list's objects, a flood of
 * text items. They do not bound what pdfjs holds outside that heap — a decoded stream is an
 * ArrayBuffer, so a ~128 KB page whose one Flate stream inflates to 128 MB parsed to the end at
 * +455 MB under these limits (re-review of the fix wave). And they are not the last word on the
 * heap either: a --max-old-space-size in NODE_OPTIONS or in the server's own argv is a V8 flag,
 * process-wide, and overrides resourceLimits (the rectangle flood then parsed at +767 MB); an
 * empty `execArgv` does not change that. `next dev` sets that flag; the deploy sets none.
 * The instance is bounded by the RSS watchdog in `runPdfWorker`: the main thread reads the
 * process's RSS every RSS_POLL_MS while a worker runs and terminates it once RSS is past
 * MAX_PARSE_RSS_BYTES and the parse has grown it by more than NORMAL_PARSE_GROWTH_BYTES,
 * whatever filled it. Past either, the upload is refused with the `memory` sentence. The heap
 * ceiling stays: it refuses the floods it sees at a lower RSS, and it kills only the worker.
 */
export const WORKER_LIMITS = { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 } as const

/** How often the watchdog reads RSS: ~5 MB of a stream inflating at the measured ~0.5 GB/s. */
const RSS_POLL_MS = 10

/** The process's resident set, read the one way `extractResume` reads it unless a test injects one. */
const processRss = (): number => process.memoryUsage.rss()

/** What the worker is started with. Exported so the hardening it carries is testable (R10). */
export function workerInput(bytes: Uint8Array) {
  return {
    // pdfjs takes ownership of what it is handed (deps.md), and this copy is transferred, so the
    // caller's `bytes` still read whole afterwards, for its size, its hash or a second parse.
    bytes: bytes.slice(),
    options: { ...HARDENING, maxImageSize: NO_IMAGES },
    minGlyphSize: MIN_GLYPH_SIZE,
    maxPages: MAX_RESUME_PAGES,
  }
}

type Parsed = { pages: number; runs: Run[] }

/**
 * One parse in one worker, or an `ExtractError` for the bound it hit: `'ms'` when the budget runs
 * out (the worker is terminated from here, on this thread's timer, whether or not pdfjs ever
 * yields), `'memory'` when its heap does or when the RSS watchdog fires (terminated from here
 * too), `'pages'` from the worker itself. A parser error, a crash or an exit without an
 * answer is a plain Error with fixed text — never the parser's message (spec §8).
 */
export function runPdfWorker(
  input: ReturnType<typeof workerInput>,
  budgetMs: number,
  url: URL = PDF_WORKER_URL,
  rss: () => number = processRss,
): Promise<Parsed> {
  if (budgetMs <= 0) return Promise.reject(new ExtractError('ms'))
  return new Promise<Parsed>((resolve, reject) => {
    const startRss = rss()
    const worker = new Worker(url, {
      workerData: input,
      transferList: [input.bytes.buffer as ArrayBuffer],
      resourceLimits: WORKER_LIMITS,
      // None of this process's flags: a worker inherits them by default, and under tsx they load
      // its loader into the worker's heap, which alone fills it (re-review of 410570c). The worker
      // imports only node:worker_threads and pdfjs-dist, and needs no flag of ours.
      execArgv: [],
    })
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(watchdog)
      fn()
      void worker.terminate()
    }
    const timer = setTimeout(() => settle(() => reject(new ExtractError('ms'))), budgetMs)
    // Past the cap AND grown by more than any resume grows it: a process left high by an earlier
    // refused parse still reads the next ordinary resume (bounds.ts, MAX_PARSE_RSS_BYTES).
    const watchdog = setInterval(() => {
      const now = rss()
      if (now > MAX_PARSE_RSS_BYTES && now - startRss > NORMAL_PARSE_GROWTH_BYTES) {
        settle(() => reject(new ExtractError('memory')))
      }
    }, RSS_POLL_MS)
    worker.once('message', (out: Partial<Parsed> & { bound?: 'pages'; unreadable?: true }) =>
      settle(() => {
        if (out.bound === 'pages') reject(new ExtractError('pages'))
        else if (out.runs !== undefined && out.pages !== undefined) resolve({ pages: out.pages, runs: out.runs })
        else reject(new Error('unreadable'))
      }),
    )
    worker.once('error', (error: Error & { code?: string }) =>
      settle(() =>
        reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new ExtractError('memory') : new Error('unreadable')),
      ),
    )
    worker.once('exit', () => settle(() => reject(new Error('unreadable'))))
  })
}

/**
 * One parse at a time in this process. The heap ceiling bounds one worker; without this, four
 * uploads in parallel would be four ceilings side by side in one 512 Mi instance. A parse waits
 * for the one ahead of it, and its own MAX_EXTRACT_MS starts when its worker does, so a slow
 * document delays the next upload rather than refusing it — up to MAX_PARSE_QUEUE of them, which
 * the upload route checks against `parseQueueDepth()` before it spends a permit.
 */
let tail: Promise<unknown> = Promise.resolve()
let depth = 0
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  depth += 1
  const run = tail.then(work, work).finally(() => {
    depth -= 1
  })
  tail = run.catch(() => {})
  return run
}

/** The parses waiting or running in this process, the one in progress included. */
export function parseQueueDepth(): number {
  return depth
}

/**
 * `opts.now` is injected so the deadline and the day the dates resolve against are testable
 * without a clock — the same seam `sampleWorld` uses for `now`; `opts.rss`, the process RSS the
 * watchdog reads, likewise, and it defaults to the real one. Throws `ExtractError` on any bound;
 * anything else it throws carries fixed text and no document content.
 */
export async function extractResume(
  bytes: Uint8Array,
  opts: { now: () => number; rss?: () => number },
): Promise<Extracted> {
  // `YYYY-MM-DD`, the `today` `parseDateRange` reads 'Present' against (R3).
  const today = new Date(opts.now()).toISOString().slice(0, 10)
  const input = workerInput(bytes)

  const { pages, runs } = await oneAtATime(async () => {
    const deadline = opts.now() + MAX_EXTRACT_MS
    const parsed = await runPdfWorker(input, deadline - opts.now(), PDF_WORKER_URL, opts.rss)
    // The injected clock is read once more after the worker answers, so a clock that has run
    // past the deadline refuses even a parse the real timer let finish.
    if (opts.now() > deadline) throw new ExtractError('ms')
    return parsed
  })

  const lines = toLines(runs)
  if (lines.length > MAX_RESUME_LINES) throw new ExtractError('lines')
  const text = lines
    .filter((line) => line.size > 0)
    .map((line) => line.text)
    .join('\n')
  // Hidden runs are stored in `lines` with their full text, so they count toward the
  // document's size even though they stay out of `text`.
  const allChars = lines.reduce((n, line) => n + line.text.length, 0)
  if (text.length > MAX_RESUME_CHARS || allChars > MAX_RESUME_CHARS) throw new ExtractError('chars')

  const structured = structure(lines)
  // (final review, extract-4) The pages, lines and chars bounds leave room for thousands of
  // one-point bullets, and Diagnose judges every visible one: the count is bounded here too.
  if (structured.bullets.length > MAX_RESUME_BULLETS) throw new ExtractError('bullets')
  return {
    text,
    lines,
    ...structured,
    entries: structured.entries.map((entry) => ({
      ...entry,
      ...parseDateRange(entry.fromRaw, entry.toRaw, today),
    })),
    language: detectLanguage(text),
    pages,
  }
}
