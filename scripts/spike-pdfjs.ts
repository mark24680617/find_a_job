/**
 * The pdfjs-dist spike (spec §9.3, §9.4). Seven questions, each its own mode so one can be re-run:
 *
 *   npx tsx scripts/spike-pdfjs.ts build   <dir>    # write the fixture PDFs, then stop
 *   npx tsx scripts/spike-pdfjs.ts text    <dir>
 *   npx tsx scripts/spike-pdfjs.ts colour  <dir>
 *   npx tsx scripts/spike-pdfjs.ts tounicode <dir>
 *   npx tsx scripts/spike-pdfjs.ts network <dir>
 *   npx tsx scripts/spike-pdfjs.ts timer   <dir>    # does a 1 ms timer fire mid-page? (R14)
 *   NODE_OPTIONS=--max-old-space-size=512 npx tsx scripts/spike-pdfjs.ts rss <dir>
 *   npx tsx scripts/spike-pdfjs.ts all     <dir>
 *
 * `rss` is a mode of its own and reads the fixtures off disk on purpose: building a 6 MB PDF in
 * the same process as the extraction measures pdf-lib's memory as well as pdfjs's, and the whole
 * question (§12 item 7) is whether extraction fits in the service's 512 Mi.
 *
 * No API key and no network: this run must make no request at all, and the `network` mode proves
 * it by replacing `fetch` with something that throws. No top-level await — tsx compiles this to
 * CJS, where it is a syntax error.
 *
 * Other scripts import `extractWithPdfjs` (A5, and Step 7's throwaway route), so the entry point
 * at the bottom runs `main()` only when this file is the one tsx was asked to run (R1).
 *
 * Task B4 spreads `HARDENING` verbatim — `getDocument({ data, ...HARDENING })` — so the extractor
 * runs under exactly the flags measured here (R10), and ports the fill-colour walk the `colour`
 * mode records: ops to items, in order (R9).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLEAN_EN, densePdf, HIDDEN_EN, ligatureCmapPdf, paddedPdf, renderFixture,
} from '../tests/fixtures/resumes'

/**
 * The options spec §9.4 asks for, as the pinned version actually spells them. `isEvalSupported`
 * is NOT here: 6.3.289's DocumentInitParameters has no such key (measured 2026-09-21), so
 * passing it would read as a defence and be nothing. `cMapUrl`, `standardFontDataUrl`, `iccUrl`
 * and `wasmUrl` are all left unset and `useWorkerFetch`/`useWasm` are off, so there is no URL for
 * the parser to reach for. Task B4 spreads this object verbatim and writes no options of its own
 * (R10).
 */
export const HARDENING: Record<string, unknown> = {
  enableXfa: false,
  disableFontFace: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  useWasm: false,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  fontExtraProperties: true,
  verbosity: 0,
}

export interface ExtractedItem { text: string; x: number; y: number; height: number; fontName: string }
export interface ExtractedPage { page: number; items: ExtractedItem[] }

/** Only what this spike calls, declared here so no `any` reaches the file. */
interface TextItemLike { str?: string; height?: number; fontName?: string; transform?: number[] }
interface PageLike {
  getTextContent(): Promise<{ items: TextItemLike[] }>
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>
  commonObjs: { has(name: string): boolean; get(name: string): unknown }
  cleanup(): void
}
interface DocLike { numPages: number; getPage(n: number): Promise<PageLike> }
interface TaskLike { promise: Promise<DocLike>; destroy(): Promise<void> }
interface PdfjsLike {
  getDocument(options: Record<string, unknown>): TaskLike
  OPS: Record<string, number>
}

const loadPdfjs = async (): Promise<PdfjsLike> =>
  (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLike

const open = (pdfjs: PdfjsLike, bytes: Uint8Array): TaskLike =>
  pdfjs.getDocument({ data: bytes, ...HARDENING })

export async function extractWithPdfjs(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const pdfjs = await loadPdfjs()
  const task = open(pdfjs, bytes)
  const doc = await task.promise
  const pages: ExtractedPage[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    pages.push({
      page: n,
      items: content.items
        .filter((i): i is TextItemLike & { str: string } => typeof i.str === 'string' && i.str !== '')
        .map((i) => ({
          text: i.str,
          x: i.transform?.[4] ?? 0,
          y: i.transform?.[5] ?? 0,
          height: i.height ?? 0,
          fontName: i.fontName ?? '',
        })),
    })
    page.cleanup()
  }
  await task.destroy()
  return pages
}

const FIXTURES = {
  hidden: 'hidden.pdf',
  clean: 'clean.pdf',
  dense: 'dense.pdf',
  padded: 'padded.pdf',
  ligMapped: 'ligature-mapped.pdf',
  ligLost: 'ligature-lost.pdf',
} as const

async function build(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, FIXTURES.hidden), await renderFixture(HIDDEN_EN))
  writeFileSync(join(dir, FIXTURES.clean), await renderFixture(CLEAN_EN))
  writeFileSync(join(dir, FIXTURES.dense), await densePdf(10))
  writeFileSync(join(dir, FIXTURES.padded), await paddedPdf(CLEAN_EN, 5_900_000))
  writeFileSync(join(dir, FIXTURES.ligMapped), ligatureCmapPdf({ mapFfi: true }))
  writeFileSync(join(dir, FIXTURES.ligLost), ligatureCmapPdf({ mapFfi: false }))
  console.log(`wrote ${Object.keys(FIXTURES).length} fixtures to ${dir}`)
}

const read = (dir: string, name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, name)))

async function text(dir: string): Promise<void> {
  const pages = await extractWithPdfjs(read(dir, FIXTURES.hidden))
  const got = pages.flatMap((p) => p.items.map((i) => i.text))
  console.log(`pages ${pages.length}, items ${got.length}`)
  for (const item of pages[0].items) {
    console.log(`  ${JSON.stringify(item.text)}  x ${item.x.toFixed(0)} y ${item.y.toFixed(0)} h ${item.height}`)
  }
  for (const line of HIDDEN_EN.pages.flat()) {
    console.log(`${got.includes(line.text) ? 'reached  ' : 'LOST     '} ${line.ink.padEnd(8)} ${line.text.slice(0, 48)}`)
  }
}

/** The operators that draw text. Each draws one run, in content-stream order. */
const SHOW_TEXT = new Set(['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'])

/** `setFillRGBColor` carries a hex string on 6.3.289 (`["#ffffff"]`); older builds carried [r,g,b]. */
const colourOf = (args: unknown[]): string =>
  typeof args[0] === 'string' ? args[0].toLowerCase() : JSON.stringify(args)

const WHITE = /^#ffffff$|^\[1,1,1\]$/

/**
 * Fill colour, and which text item it painted — the correlation Task B4 ports (R9). Walk the
 * page's operator list keeping the current fill colour (a stack across `save`/`restore`, since
 * pdf-lib wraps every drawText in q … Q), note the colour at each text-showing op, and pair the
 * n-th text-showing op with the n-th non-empty `getTextContent()` item. The run prints whether
 * that pairing held on this fixture: as many ops as items, and the one item paired white is
 * HIDDEN_EN's white line. B4 cannot port a pairing this run did not see.
 */
async function colour(dir: string): Promise<void> {
  const pdfjs = await loadPdfjs()
  const task = open(pdfjs, read(dir, FIXTURES.hidden))
  const doc = await task.promise
  const page = await doc.getPage(1)
  const ops = await page.getOperatorList()
  const name = new Map(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]))
  const fills = new Map<string, number>()
  const stack: string[] = []
  let current = '#000000'
  const shownIn: string[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = name.get(ops.fnArray[i]) ?? String(ops.fnArray[i])
    if (op === 'save') stack.push(current)
    else if (op === 'restore') current = stack.pop() ?? current
    else if (op === 'setFillRGBColor') current = colourOf(ops.argsArray[i])
    else if (SHOW_TEXT.has(op)) shownIn.push(current)
    if (!/Fill/i.test(op)) continue
    const key = `${op} ${JSON.stringify(ops.argsArray[i])}`
    fills.set(key, (fills.get(key) ?? 0) + 1)
  }
  for (const [key, n] of fills) console.log(`  ${n} x ${key}`)
  const white = [...fills.keys()].some((k) => /#ffffff|\[1,1,1\]/i.test(k))
  console.log(`fill colour reachable: ${fills.size > 0}; white fill seen: ${white}`)

  const items = (await page.getTextContent()).items
    .filter((i): i is TextItemLike & { str: string } => typeof i.str === 'string' && i.str !== '')
  console.log(`\ntext-showing ops ${shownIn.length}, non-empty text items ${items.length}`)
  items.forEach((item, n) => console.log(`  ${(shownIn[n] ?? 'UNPAIRED').padEnd(9)} ${JSON.stringify(item.str)}`))
  const whiteLine = HIDDEN_EN.pages.flat().find((l) => l.ink === 'white')?.text
  const pairedWhite = items.filter((_, n) => WHITE.test(shownIn[n] ?? '')).map((i) => i.str)
  const holds = shownIn.length === items.length && pairedWhite.length === 1 && pairedWhite[0] === whiteLine
  console.log(`op-to-item correlation holds: ${holds}`)
  await task.destroy()
}

async function tounicode(dir: string): Promise<void> {
  const pdfjs = await loadPdfjs()
  for (const file of [FIXTURES.ligMapped, FIXTURES.ligLost, FIXTURES.clean]) {
    const task = open(pdfjs, read(dir, file))
    const doc = await task.promise
    const page = await doc.getPage(1)
    const ops = await page.getOperatorList()
    const setFont = pdfjs.OPS.setFont
    const fonts = new Set<string>()
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === setFont) {
        const first = ops.argsArray[i][0]
        if (typeof first === 'string') fonts.add(first)
      }
    }
    for (const font of fonts) {
      const object = page.commonObjs.has(font) ? page.commonObjs.get(font) : null
      const record = typeof object === 'object' && object !== null ? (object as Record<string, unknown>) : null
      const toUnicode = record?.toUnicode
      const map = typeof toUnicode === 'object' && toUnicode !== null
        ? (toUnicode as Record<string, unknown>)._map
        : undefined
      console.log(`${file}  font ${font}  toUnicode ${toUnicode ? 'present' : 'ABSENT'}` +
        `  entries ${Array.isArray(map) ? map.filter(Boolean).length : 'n/a'}`)
    }
    await task.destroy()
  }
}

async function network(dir: string): Promise<void> {
  let reached = 0
  const original = globalThis.fetch
  globalThis.fetch = ((): never => {
    reached += 1
    throw new Error('the parser reached the network')
  }) as unknown as typeof fetch
  try {
    const pages = await extractWithPdfjs(read(dir, FIXTURES.dense))
    console.log(`extracted ${pages.length} pages with fetch disabled; fetch calls: ${reached}`)
  } finally {
    globalThis.fetch = original
  }
}

/**
 * Whether a timer can fire while pdfjs parses one page (R14). pdfjs runs in this process with no
 * worker, so Task B4's race of `getDocument().promise`, `getPage()` and `getTextContent()` against
 * the 20 s budget can only fire if the parser yields to the event loop mid-parse. If no tick lands
 * during the dense fixture's first page, B4 moves extraction to a `worker_thread` it terminates
 * at the deadline instead.
 */
async function timer(dir: string): Promise<void> {
  const pdfjs = await loadPdfjs()
  const task = open(pdfjs, read(dir, FIXTURES.dense))
  let ticks = 0
  const ticker = setInterval(() => { ticks += 1 }, 1)
  try {
    const doc = await task.promise
    const opened = ticks
    const started = Date.now()
    const page = await doc.getPage(1)
    await page.getTextContent()
    const during = ticks - opened
    console.log(`getDocument: ${opened} ticks; page 1 getPage + getTextContent: ${during} ticks in ${Date.now() - started} ms`)
    console.log(`a 1 ms timer fires during a single-page parse: ${during > 0}`)
  } finally {
    clearInterval(ticker)
    await task.destroy()
  }
}

async function rss(dir: string): Promise<void> {
  for (const file of [FIXTURES.dense, FIXTURES.padded]) {
    const bytes = read(dir, file)
    // Read before the parse: getDocument transfers `data` and leaves it detached (byteLength 0).
    const size = bytes.byteLength
    let peak = process.memoryUsage().rss
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 10)
    const started = Date.now()
    const pages = await extractWithPdfjs(bytes)
    clearInterval(sampler)
    peak = Math.max(peak, process.memoryUsage().rss)
    const chars = pages.reduce((t, p) => t + p.items.reduce((n, i) => n + i.text.length, 0), 0)
    console.log(`${file}  ${(size / 1048576).toFixed(2)} MB  pages ${pages.length}` +
      `  chars ${chars}  ${Date.now() - started} ms  peak RSS ${(peak / 1048576).toFixed(1)} MB`)
  }
}

async function main(): Promise<void> {
  const [mode, dir] = process.argv.slice(2)
  if (!dir) throw new Error('usage: spike-pdfjs.ts <build|text|colour|tounicode|network|timer|rss|all> <dir>')
  const run: Record<string, (d: string) => Promise<void>> = { build, text, colour, tounicode, network, timer, rss }
  if (mode === 'all') {
    await build(dir)
    for (const name of ['text', 'colour', 'tounicode', 'network', 'timer', 'rss']) {
      console.log(`\n--- ${name} ---`)
      await run[name](dir)
    }
    return
  }
  const chosen = run[mode ?? '']
  if (!chosen) throw new Error(`unknown mode ${JSON.stringify(mode)}`)
  await chosen(dir)
}

// Guarded (R1): A5 and Step 7's route import this module, and an unguarded main() would read
// their argv as a mode and exit the process — A5's run, or the `next dev` server.
if (process.argv[1]?.endsWith('spike-pdfjs.ts')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
