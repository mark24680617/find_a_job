import { MAX_PDF_BYTES } from '@/lib/assignment'

/**
 * How much document this feature will take, and the sentence each refusal is made of.
 *
 * Pure and import-light on purpose: the upload route, the extractor and the page all have to
 * reach the same answer, and the page is a client component.
 *
 * Past any of these the upload is refused with a sentence naming which one, never silently
 * truncated. Three reasons, all hard (spec §5.1): a Firestore document is capped at 1 MiB
 * (1,048,576 bytes, Google's published quota, recorded in docs/notes/deps.md) and `lines`
 * carries per-glyph geometry; JEV allows 32k tokens for `state` plus the longest question; and
 * a PDF built to be slow to parse holds a request open against the Cloud Run 300 s timeout,
 * which is a denial of service one upload long.
 */

export const MAX_RESUME_PAGES = 10
/** Measured: ten dense pages come to 47,750 characters (docs/notes/deps.md, the pdfjs spike). */
export const MAX_RESUME_CHARS = 40_000
export const MAX_RESUME_LINES = 5_000
export const MAX_EXTRACT_MS = 20_000
/**
 * (final review, extract-4) The fifth bound. Pages, lines and characters leave room for thousands
 * of one-point `• a` bullets, and Diagnose judges every visible bullet — one model call each — so
 * the count bounds a run's cost and its time inside the 300 s request timeout: 200 bullets at the
 * measured 1.3 s median per call (deps.md, the Cost table) over JUDGE_CONCURRENCY 4 is about a
 * minute. Twice the ~100 a real ten-page CV reaches (C8b).
 */
export const MAX_RESUME_BULLETS = 200

/**
 * (final review, extract-1; its second half, from the re-review of the fix wave) The RSS
 * watchdog's two numbers. While a parse worker runs, the main thread reads the process's RSS, and
 * terminates the worker with the `memory` sentence once RSS is past MAX_PARSE_RSS_BYTES AND the
 * parse has grown it by more than NORMAL_PARSE_GROWTH_BYTES. The worker's heap ceiling
 * (extract.ts, WORKER_LIMITS) cannot bound what pdfjs keeps outside the V8 heap: a ~128 KB page
 * whose one Flate stream inflates to 128 MB of spaces parsed to the end at +455 MB in plain node.
 *
 * The cap is absolute because the instance is what it protects: Cloud Run's is 512 Mi (deploy.md),
 * `next start` sits at ~144 MB after serving a page, and the 132 Mi left above the cap cover one
 * 10 ms poll of a stream inflating at ~0.5 GB/s and the rest of the server. The growth floor is
 * there because RSS does not fall back after a hostile parse: the freed memory stays resident, so
 * three refused uploads in a row left the process near 380 MB, and on the cap alone the next
 * ordinary resume was refused with a sentence that blamed it. A parse of any real resume grows
 * the process by 80–95 MB, the worker's own pdfjs import included; 128 Mi is above that with
 * room. Measured 2026-09-26 in plain node on macOS; what this still leaves is in
 * docs/notes/resume-review-followups.md, "Known limits".
 */
export const MAX_PARSE_RSS_BYTES = 380 * 1024 * 1024
export const NORMAL_PARSE_GROWTH_BYTES = 128 * 1024 * 1024

/**
 * How many parses may be waiting or running in one process before an upload is turned away
 * (disclosed by the final review's backend fixer). Parsing is one at a time (extract.ts), each up
 * to MAX_EXTRACT_MS, so the last upload taken waits at most 4 × 20 s = 80 s — where a burst of the
 * 20 uploads a day one account may make would have pushed the last of them, or anyone else's
 * upload behind them, past Cloud Run's 300 s request timeout after spending a permit. The upload
 * route reads the count before it takes the permit, so a refused upload costs nothing.
 */
export const MAX_PARSE_QUEUE = 4

/** What an upload turned away by MAX_PARSE_QUEUE is told: nothing is wrong with the document. */
export const READER_BUSY_MESSAGE = 'the reader is busy with other resumes right now — try again in a minute'

/**
 * One number, one home. The take-home brief's PDF cap is the same 6 MB and a resume is the same
 * kind of document arriving the same way, so this is that constant under this layer's own name
 * rather than a second 6 MB that could drift from it.
 */
export const MAX_RESUME_BYTES = MAX_PDF_BYTES

/**
 * The ceiling on the JSON body carrying an upload, checked against `content-length` BEFORE
 * `req.json()`. Larger than `MAX_RESUME_BYTES` because base64 is four bytes for every three,
 * plus a kilobyte for the filename and the JSON envelope: `ceil(6 MiB × 4/3) + 1 KiB`.
 */
export const MAX_UPLOAD_BODY_BYTES = Math.ceil((MAX_RESUME_BYTES * 4) / 3) + 1024

/**
 * The shape of a resume id, matched by every route on this feature before the id is used to
 * build a Firestore path (spec §4). One declaration, because seven copies of one security rule
 * are seven places it can be widened by somebody who only read one route.
 *
 * No flags. A `g` or `y` regex carries `lastIndex` across calls, and a module-level constant is
 * shared by every route in the process — the second caller of a sticky regex gets `false` for an
 * id the first one accepted.
 */
export const RESUME_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * `memory` is not a number the spec fixes: it is the parser's heap ceiling (extract.ts,
 * WORKER_LIMITS) or the RSS watchdog (MAX_PARSE_RSS_BYTES), whichever a parse reaches first — one
 * bound and one sentence, because both mean a document built to exhaust memory, not any resume.
 */
export type ExtractBound = 'pages' | 'chars' | 'lines' | 'bullets' | 'ms' | 'memory'

/** Locale-free thousands grouping, so a refusal reads the same wherever it is built. */
const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+$)/g, ',')

/**
 * One sentence per bound, held here rather than at the throw site so there is exactly one
 * wording for each. Lower case, an em dash, and what to do instead — the shape the take-home
 * route's refusals already take.
 */
export const BOUND_MESSAGE: Record<ExtractBound, string> = {
  pages: `that resume runs past ${MAX_RESUME_PAGES} pages — send the version you apply with`,
  chars: `that resume holds more than ${group(MAX_RESUME_CHARS)} characters of text — send the version you apply with`,
  lines: `that resume holds more than ${group(MAX_RESUME_LINES)} lines of text — send the version you apply with`,
  bullets: `that resume holds more than ${MAX_RESUME_BULLETS} bullets — send the version you apply with`,
  ms: `that resume took longer than ${MAX_EXTRACT_MS / 1000} seconds to read — send a simpler PDF`,
  memory: 'that resume takes more memory to read than a resume should — send a simpler PDF',
}

/** Both 413s answer in one wording: the header check and the decoded-bytes check are one rule. */
export const TOO_LARGE_MESSAGE = `that PDF is over ${MAX_RESUME_BYTES / 1024 / 1024} MB — send a smaller export of the same resume`

/**
 * What a document the parser could not open is refused with. Fixed text, never the parser's own
 * message: an exception escaping a handler is logged by the platform with its message and stack,
 * and nothing on this feature may put document content in a log (spec §8).
 */
export const UNREADABLE_MESSAGE = 'that file could not be read as a PDF — send the PDF you apply with'

/**
 * A bound the document blew. The message defaults to the bound's own sentence, so a throw site
 * says `new ExtractError('pages')` and there is no second wording for one bound.
 */
export class ExtractError extends Error {
  readonly bound: ExtractBound

  constructor(bound: ExtractBound, message: string = BOUND_MESSAGE[bound]) {
    super(message)
    this.name = 'ExtractError'
    this.bound = bound
  }
}
