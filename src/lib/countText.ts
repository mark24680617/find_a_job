/**
 * Word/char counting for question limits. Application forms count what a human sees:
 * whitespace-separated tokens, and code points rather than UTF-16 units — `String.length`
 * would charge two characters for an emoji or a surrogate-pair CJK glyph.
 */
export function countUnits(text: string, unit: 'words' | 'chars'): number {
  if (unit === 'chars') return Array.from(text).length
  return text.split(/\s+/).filter(Boolean).length
}
