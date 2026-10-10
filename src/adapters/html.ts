/**
 * Job descriptions arrive as HTML from every source, and Gemini reads them as text. No
 * parser dependency: postings are simple documents, and a regex pass that drops the
 * non-content elements first is enough. Nothing here touches the DOM, so it runs
 * server-side and in tests unchanged.
 *
 * Every pass reads the page once. The page is whatever a URL a person chose served, read
 * before anything meters the request, and the patterns these passes run were each applied at
 * every position: from every opener with no closer they read the rest of the page again, so
 * 80,000 "<" took 17 s and blocked every request on the instance (security review,
 * 2026-10-08). The answers are the ones those patterns gave, exactly; tests/linearTime.test.ts
 * holds the passes to both.
 */

// Removed with their content — these carry site chrome, not the posting.
const CHROME = /<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/
const CHROME_OPENER = /<(script|style|nav|header|footer)\b/gi

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•',
  middot: '·',
}

/**
 * Greenhouse stores its description as entity-escaped HTML, so it needs one decode pass
 * before the markup is visible to `htmlToText`. Exported for that case only.
 */
export function decodeEntities(html: string): string {
  return html.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? whole
    const code =
      body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    // Lone surrogates and out-of-range values would throw in fromCodePoint; leave them be.
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return whole
    if (code >= 0xd800 && code <= 0xdfff) return whole
    return String.fromCodePoint(code)
  })
}

/**
 * Each chrome element swapped for a space: from its opener to the first closer of its name,
 * which is what `CHROME` matches. It is tried only where an opener is, and never again for a
 * name it has once failed on — an opener with no closer of its name after it has none after any
 * later opener of that name either, nor a ">" if it had none. Those openers stay in the text,
 * as they always did, for the tag pass to strip.
 */
function dropChrome(html: string): string {
  const element = new RegExp(CHROME, 'iy')
  const unclosed = new Set<string>()
  let out = ''
  let kept = 0 // everything before this is already in `out`
  for (const opener of html.matchAll(CHROME_OPENER)) {
    const name = opener[1].toLowerCase()
    if (opener.index < kept || unclosed.has(name)) continue
    element.lastIndex = opener.index
    if (element.exec(html) === null) {
      unclosed.add(name)
      continue
    }
    out += html.slice(kept, opener.index) + ' '
    kept = element.lastIndex
  }
  return out + html.slice(kept)
}

/** Each comment swapped for a space: `<!--` to the first `-->` after it, as `/<!--[\s\S]*?-->/g`. */
function dropComments(html: string): string {
  let out = ''
  let kept = 0
  for (let open = html.indexOf('<!--'); open >= 0; open = html.indexOf('<!--', kept)) {
    const close = html.indexOf('-->', open + 4)
    // No closer after this opener means none after any later one: the rest stays as it is.
    if (close < 0) break
    out += html.slice(kept, open) + ' '
    kept = close + 3
  }
  return out + html.slice(kept)
}

/**
 * Each tag swapped for a line break: "<" to the first ">" after it. Past the page's last ">",
 * no "<" has one, so that tail is kept as it is without being searched — searched, every "<" in
 * it read the rest of the page for a ">" that is not there.
 */
function dropTags(html: string): string {
  const end = html.lastIndexOf('>') + 1
  return html.slice(0, end).replace(/<[^>]*>/g, '\n') + html.slice(end)
}

/**
 * What the page's first `<title>` holds, entities still encoded, or null when it has none —
 * what `/<title[^>]*>([\s\S]*?)<\/title>/i` captures. Only the first opener is tried: with no
 * ">" or no closer after it, no later opener has one either.
 */
export function rawTitle(html: string): string | null {
  const opener = html.search(/<title/i)
  if (opener < 0) return null
  const title = /<title[^>]*>([\s\S]*?)<\/title>/iy
  title.lastIndex = opener
  return title.exec(html)?.[1] ?? null
}

/** Strip chrome and markup, decode entities, and collapse the whitespace HTML leaves behind. */
export function htmlToText(html: string): string {
  const stripped = dropTags(dropComments(dropChrome(html)))

  // Decoding after stripping, so that an escaped `&lt;p&gt;` in the copy is never read as a tag.
  return decodeEntities(stripped)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Drops the empty pieces so a missing location never leaves a blank line in the JD. */
export function joinSections(...parts: (string | undefined | null)[]): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
}

/** `trm-labs` reads as a URL, not a company; the user can correct it after. */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}
