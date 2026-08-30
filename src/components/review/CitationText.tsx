'use client'

import type { Citation, Fact } from '@/lib/types'

/**
 * The draft answer, with its cited phrases marked. This is the safety at the centre of the
 * product: an answer may contain forward-looking sentences the agent wrote and nothing backs,
 * and those are allowed — what is NOT allowed is a claim that reads as verified when it isn't.
 * So a phrase is underlined only when its citation points at a fact that is actually in the
 * profile; selecting it shows that fact. Everything else is plain prose. An uncited sentence
 * therefore looks exactly like what it is — the agent's own words — and carries no false
 * authority.
 *
 * A citation whose `factId` names nothing in the profile is the one case to handle carefully:
 * it must never render as a live, followable link to a fact that isn't there. It falls back to
 * plain text with a small, quiet "source not found" note, so the phrase is still shown but is
 * visibly not vouched for.
 */

interface Segment {
  text: string
  citation?: Citation
}

/**
 * Split the answer into plain and cited runs. Each distinct `claimSpan` is matched at its
 * first verbatim occurrence (the flow guarantees it appears; a span that somehow doesn't is
 * simply left as plain text). Overlapping matches keep the earliest — two underlines fighting
 * over the same words would render as neither.
 */
export function segment(text: string, citations: Citation[]): Segment[] {
  const ranges: { start: number; end: number; citation: Citation }[] = []
  const claimed = new Set<string>()
  for (const citation of citations) {
    const span = citation.claimSpan
    if (span === '' || claimed.has(span)) continue
    const start = text.indexOf(span)
    if (start === -1) continue
    claimed.add(span)
    ranges.push({ start, end: start + span.length, citation })
  }
  ranges.sort((a, b) => a.start - b.start)

  const segments: Segment[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) continue // overlaps an earlier span; drop it
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start) })
    segments.push({ text: text.slice(range.start, range.end), citation: range.citation })
    cursor = range.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

interface Props {
  text: string
  citations: Citation[]
  factsById: Map<string, Fact>
  /** The citation currently open in the source panel, so its span reads as selected. */
  active: Citation | null
  onSelect: (citation: Citation) => void
}

export function CitationText({ text, citations, factsById, active, onSelect }: Props) {
  const segments = segment(text, citations)

  return (
    // `whitespace-pre-wrap` keeps the paragraph breaks the model wrote; the reading serif marks
    // this as composed text to be read, distinct from the form field it becomes below.
    <p className="max-w-[68ch] break-words whitespace-pre-wrap font-display text-[1.0625rem] leading-relaxed text-ink">
      {segments.map((seg, i) => {
        if (!seg.citation) return <span key={i}>{seg.text}</span>

        const fact = factsById.get(seg.citation.factId)
        if (!fact) {
          // Defensive: a citation to a fact that is no longer in the profile is shown, but
          // never as something the reader can follow and trust.
          return (
            <span key={i}>
              {seg.text}
              <span className="ml-1 align-baseline text-xs text-ink-3">(source not found)</span>
            </span>
          )
        }

        const selected = active?.claimSpan === seg.citation.claimSpan && active?.factId === seg.citation.factId
        // An inline `<span role="button">`, not a real `<button>`: a button carries the UA
        // default `text-align: center`, so a cited phrase that wraps across two lines renders
        // centred as a block and orphans its adjacent punctuation onto a line of its own. A span
        // flows as body text — the underline tracks the words, the sentence stays intact — while
        // still behaving as a control: selectable by pointer, and by Enter or Space at the keyboard.
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`Show the fact behind “${seg.citation.claimSpan}”`}
            onClick={() => onSelect(seg.citation!)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (e.key === ' ') e.preventDefault()
                onSelect(seg.citation!)
              }
            }}
            className={`inline cursor-pointer rounded-[2px] underline decoration-accent decoration-dotted decoration-1 underline-offset-[3px] transition-colors hover:bg-accent-soft ${
              selected ? 'bg-accent-soft decoration-solid' : ''
            }`}
          >
            {seg.text}
          </span>
        )
      })}
    </p>
  )
}
