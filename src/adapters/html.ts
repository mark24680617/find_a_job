/**
 * Job descriptions arrive as HTML from every source, and Gemini reads them as text. No
 * parser dependency: postings are simple documents, and a regex pass that drops the
 * non-content elements first is enough. Nothing here touches the DOM, so it runs
 * server-side and in tests unchanged.
 */

// Removed with their content — these carry site chrome, not the posting.
const CHROME = /<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi

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

/** Strip chrome and markup, decode entities, and collapse the whitespace HTML leaves behind. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(CHROME, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, '\n')

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
