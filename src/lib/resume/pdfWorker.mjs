/**
 * The PDF parse, in a thread of its own (final review, extract-1). `extract.ts` starts this file
 * as a `node:worker_threads` Worker with a heap ceiling and a main-thread deadline, because pdfjs
 * builds each page's whole operator list before it yields: a 26 KB page of a million `re f`
 * rectangles filled a 512 MB heap in-process before any bound or deadline could refuse it. Here
 * the same parse runs out of heap inside the worker, which dies alone, and the main thread's timer
 * — on a thread pdfjs does not block — terminates it at MAX_EXTRACT_MS.
 *
 * Plain ESM, not TypeScript: it is loaded by URL, outside any bundler, so it has to run as Node
 * reads it. It imports nothing of ours. Everything it is configured with arrives in `workerData`
 * from `extract.ts`, which stays the one place the hardening is written down (R10):
 *   { bytes: Uint8Array, options: { ...HARDENING, maxImageSize }, minGlyphSize, maxPages }
 * It posts exactly one message: `{ pages, runs }`, `{ bound: 'pages' }` or `{ unreadable: true }`.
 * The last carries no parser message, because nothing on this feature may put document content
 * in a log (spec §8).
 */
import { parentPort, workerData } from 'node:worker_threads'
import { getDocument, normalizeUnicode, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

// ── The colour walk (R9) ─────────────────────────────────────────────────────────────────

/** Every fill operator: each sets the colour the next text-showing operator draws with. */
const FILL_OPS = new Set(
  Object.entries(OPS)
    .filter(([name]) => name.startsWith('setFill'))
    .map(([, fn]) => fn),
)

/** The four operators A3's walk counts as drawing text (deps.md, 'Fill colour per text item'). */
const SHOW_TEXT_OPS = new Set([
  OPS.showText,
  OPS.showSpacedText,
  OPS.nextLineShowText,
  OPS.nextLineSetSpacingShowText,
])

/**
 * The darkest fill the walk still reads as white (Task F4): every RGB channel at or above 0.9 of
 * full, #e6e6e6 and lighter. The walk assumes the page is white, so text in such a fill is as
 * unreadable as #ffffff text and is hidden the same way; only a known dark rectangle under it
 * (`onDark`) keeps it. The same floor decides whether a filled rectangle is a white paint or a
 * dark band, so a near-white box is no background that white text can be read on.
 */
const NEAR_WHITE_FLOOR = 0.9

/** A `#rrggbb` fill whose every channel is at or above NEAR_WHITE_FLOOR. */
const nearWhiteHex = (hex) =>
  /^#[0-9a-f]{6}$/i.test(hex) && [1, 3, 5].every((k) => parseInt(hex.slice(k, k + 2), 16) / 255 >= NEAR_WHITE_FLOOR)

/**
 * A white fill. pdfjs hands a fill over as a hex string (A3: `setFillRGBColor ["#ffffff"]`), and
 * 6.3.289's evaluator turns `g`, `k`, `sc` and a plain `scn` into that same op, so a gray or CMYK
 * fill meets the same floor as an RGB one.
 */
function isWhite(args) {
  const [first] = args
  if (typeof first === 'string') return nearWhiteHex(first)
  return args.length === 3 && args.every((v) => v === 1 || v === 255)
}

/** The characters a text-showing operator draws, from its glyph objects; spacing numbers draw none. */
function glyphText(glyphs) {
  if (!Array.isArray(glyphs)) return ''
  return glyphs
    .map((g) => {
      const unicode = typeof g === 'object' && g !== null ? g.unicode : undefined
      return typeof unicode === 'string' ? normalizeUnicode(unicode) : ''
    })
    .join('')
}

const inkOnly = (s) => s.replace(/\s+/g, '')

// ── What was painted where (final review, extract-3) ─────────────────────────────────────
// White text is hidden on a white page and plain to read on a navy sidebar. So a white run is
// visible only when the paint under it is a known dark rectangle, and hidden wherever the walk
// is unsure. Coordinates are page user space: the CTM starts at identity, the space
// getTextContent()'s item transforms are in.

/** A box as [x0, y0, x1, y1]. A paint the walk cannot place covers everything. */
const EVERYWHERE = [-Infinity, -Infinity, Infinity, Infinity]

/** `p ↦ m(n(p))`: `n` applied first, as `cm` and a form's /Matrix concatenate onto the CTM. */
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

const axisAligned = (m) => m[1] === 0 && m[2] === 0

/** A local box under a transform, as the device box around its four corners. */
function place(m, [x0, y0, x1, y1]) {
  const xs = []
  const ys = []
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    xs.push(m[0] * x + m[2] * y + m[4])
    ys.push(m[1] * x + m[3] * y + m[5])
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

const meet = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]

const holds = (box, x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]

/**
 * A path that is one axis-aligned rectangle: moveTo, three lineTos along its edges, closePath —
 * what both `re` and pdf-lib's drawRectangle become. Anything else (a curve, a second subpath, a
 * bow-tie) may cover less than its bounding box, so it is never taken as a background.
 */
function isRect(data) {
  if (!(data instanceof Float32Array) || data.length !== 13) return false
  if (data[0] !== 0 || data[3] !== 1 || data[6] !== 1 || data[9] !== 1 || data[12] !== 4) return false
  const pts = [[data[1], data[2]], [data[4], data[5]], [data[7], data[8]], [data[10], data[11]]]
  return pts.every(([x, y], k) => {
    const [nx, ny] = pts[(k + 1) % 4]
    return (x === nx) !== (y === ny)
  })
}

/** Every constructPath painting op that fills; the rest stroke or only end a path. */
const FILL_PAINTS = new Set([
  OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
])
const STROKE_PAINTS = new Set([OPS.stroke, OPS.closeStroke])
/** Images placed on the unit square under the CTM. Their pixels are never decoded here. */
const UNIT_IMAGES = new Set([
  OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintSolidColorImageMask,
])
/** Paints whose extent the walk does not compute: they cover everything, conservatively. */
const UNPLACED_PAINTS = new Set([
  OPS.shadingFill, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat,
  OPS.paintImageMaskXObjectGroup, OPS.paintInlineImageXObjectGroup, OPS.rawFillPath,
])

/** A gstate entry that can make a fill paint less than it covers: fill alpha, a soft mask, a blend. */
const blursPaint = ([key, value]) =>
  (key === 'ca' && value !== 1) || (key === 'SMask' && value !== false) || (key === 'BM' && value !== 'source-over')

/**
 * One pass over a page's operator list: which characters each text-showing operator drew and in
 * what colour, and every paint with where it landed.
 *
 * The graphics state — fill colour, CTM, clip, and whether a fill can paint less than it covers —
 * is saved and restored with `q`/`Q`, and with a Form XObject's Begin/End, which pdfjs emits with
 * no `q`/`Q` of its own around them (its canvas saves in paintFormXObjectBegin). A form inherits
 * the caller's state, so Begin pushes a copy and End pops it: a fill set inside a form does not
 * leak past it, in either direction (final review, extract-2).
 *
 * A paint is `dark` or `white` only when it is a known colour filling one axis-aligned rectangle
 * under a known rectangular clip, opaque, outside optional content; everything else it paints is
 * `unknown`. A clip that is not one rectangle makes every fill under it unknown.
 */
function walk(ops) {
  const drawn = []
  let haystack = ''
  const paints = []
  const saved = []
  let s = { white: false, fill: null, ctm: [1, 0, 0, 1, 0, 0], clip: EVERYWHERE, blurred: false }
  let clipPending = false
  const marked = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i] ?? []
    if (fn === OPS.save) saved.push({ ...s })
    else if (fn === OPS.restore) s = saved.pop() ?? s
    else if (fn === OPS.paintFormXObjectBegin) {
      saved.push({ ...s })
      const [matrix, bbox] = args
      if (matrix) s.ctm = mul(s.ctm, Array.from(matrix))
      if (bbox) s.clip = s.clip === null || !axisAligned(s.ctm) ? null : meet(s.clip, place(s.ctm, Array.from(bbox)))
    } else if (fn === OPS.paintFormXObjectEnd) s = saved.pop() ?? s
    else if (fn === OPS.transform) s.ctm = mul(s.ctm, args)
    else if (fn === OPS.setGState) {
      if (Array.isArray(args[0]) && args[0].some((entry) => Array.isArray(entry) && blursPaint(entry))) s.blurred = true
    } else if (fn === OPS.beginMarkedContentProps) marked.push(args[0] === 'OC')
    else if (fn === OPS.beginMarkedContent) marked.push(false)
    else if (fn === OPS.endMarkedContent) marked.pop()
    else if (fn === OPS.clip || fn === OPS.eoClip) clipPending = true
    else if (FILL_OPS.has(fn)) {
      s.white = isWhite(args)
      s.fill = typeof args[0] === 'string' && /^#[0-9a-f]{6}$/i.test(args[0]) ? args[0] : null
    } else if (fn === OPS.constructPath) {
      const [paint, [data] = [], minMax] = args
      const box = minMax ? place(s.ctm, Array.from(minMax)) : EVERYWHERE
      const rect = isRect(data) && axisAligned(s.ctm)
      if (clipPending) {
        clipPending = false
        s.clip = rect && s.clip !== null ? meet(s.clip, box) : null
      }
      if (FILL_PAINTS.has(paint)) {
        const known = rect && s.fill !== null && s.clip !== null && !s.blurred && !marked.includes(true)
        const kind = !known ? 'unknown' : nearWhiteHex(s.fill) ? 'white' : 'dark'
        paints.push({ at: i, box: known ? meet(box, s.clip) : box, kind })
      } else if (STROKE_PAINTS.has(paint)) paints.push({ at: i, box, kind: 'unknown' })
    } else if (UNIT_IMAGES.has(fn)) paints.push({ at: i, box: place(s.ctm, [0, 0, 1, 1]), kind: 'unknown' })
    else if (UNPLACED_PAINTS.has(fn)) paints.push({ at: i, box: EVERYWHERE, kind: 'unknown' })
    else if (SHOW_TEXT_OPS.has(fn)) {
      const chars = inkOnly(glyphText(args[0]))
      haystack += chars
      // One entry per UTF-16 unit, so an index into `haystack` is an index into `drawn`.
      for (let k = 0; k < chars.length; k++) drawn.push({ white: s.white, at: i })
    }
  }
  return { drawn, haystack, paints }
}

/**
 * For each of a page's `getTextContent()` items, in the items' order: the operator that drew its
 * first white character, or -1 when none of it was drawn in white.
 *
 * The walk records the colour of every character each text-showing operator draws, in drawing
 * order, and this matches the items to those characters in the same order — whitespace aside,
 * because pdfjs puts spaces between items that the page never drew. An item with any white
 * character is white: a run that mixes white and visible glyphs is itself the pattern the check
 * exists for, and the evidence table shows the line. An item no operator accounts for keeps its
 * colour unknown and stays visible — the reading before this walk existed.
 *
 * Each glyph passes through the parser's own normalisation, the one `getTextContent()` applies
 * to its items (`normalizeUnicode`: U+FB03 is 'ffi'), so both sides are compared in one form and
 * a white ligature pairs like any other run.
 *
 * Pairing is by drawn text, not by index: A3 measured 14 text-showing operators against 13
 * items on HIDDEN_EN, because the off-page run is drawn but never becomes an item, so an index
 * pairing shifts after it (deps.md, 'Fill colour per text item'; the controller's ruling of
 * 2026-09-24).
 */
function whiteAt({ drawn, haystack }, items) {
  let cursor = 0
  return items.map((str) => {
    const needle = inkOnly(str)
    const at = needle === '' ? -1 : haystack.indexOf(needle, cursor)
    if (at === -1) return -1
    cursor = at + needle.length
    return drawn.slice(at, cursor).find((c) => c.white)?.at ?? -1
  })
}

/**
 * Whether a white run drawn by operator `at` with its origin at (x, y) sits on a dark
 * background: the last paint before it that covers the origin is a known dark rectangle, and no
 * paint after it covers the origin (one would be drawn over the text). A white run on a white
 * page, beside a dark box rather than on it, or on anything the walk cannot read, stays hidden.
 */
function onDark(paints, at, x, y) {
  let under = null
  for (const p of paints) {
    if (!holds(p.box, x, y)) continue
    if (p.at > at) return false
    under = p
  }
  return under !== null && under.kind === 'dark'
}

// ── The parse ────────────────────────────────────────────────────────────────────────────

const { bytes, options, minGlyphSize, maxPages } = workerData

/**
 * Every run on every page, each with why the reader never sees it (`'size'`, `'colour'`) or null.
 * The runs go back to `extract.ts`, which folds them into lines and applies the other bounds.
 */
async function read() {
  const task = getDocument({ data: bytes, ...options })
  try {
    const doc = await task.promise
    if (doc.numPages > maxPages) return { bound: 'pages' }
    const runs = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const [x0, y0, x1, y1] = page.view
      const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()])
      const items = content.items.filter((item) => 'str' in item && item.str !== '')
      const walked = walk(ops)
      const white = whiteAt(walked, items.map((item) => item.str))
      items.forEach((item, i) => {
        const tr = item.transform
        const [x, y] = [tr[4], tr[5]]
        const size = Math.hypot(tr[2], tr[3])
        // Defensive only: 6.3.289 never returns a run drawn off the page box (deps.md, Open
        // decision 5), so no fixture reaches this term. It stays so a parser upgrade that starts
        // returning such runs cannot put them in `text`. (R2)
        const offPage = x < x0 || x > x1 || y < y0 || y > y1
        const hide =
          size < minGlyphSize || offPage ? 'size' : white[i] !== -1 && !onDark(walked.paints, white[i], x, y) ? 'colour' : null
        runs.push({ page: n, x, y, size, font: item.fontName, text: item.str, width: item.width, hide })
      })
      page.cleanup()
    }
    return { pages: doc.numPages, runs }
  } finally {
    await task.destroy()
  }
}

read().then(
  (out) => parentPort.postMessage(out),
  () => parentPort.postMessage({ unreadable: true }),
)
