import type { PrepBrief, ResearchSource } from '@/lib/types'

/**
 * The prep brief for one round: five sections, in the order somebody actually uses them.
 *
 * What the round probes, the questions to have an answer ready for and which of your own facts
 * answers each, the questions to ask back, the claims to have on the tip of your tongue, and
 * the things that could go wrong. The last two are the ones that carry the product's thesis:
 * the rehearsal lines are the candidate's own claims quoted back verbatim — nothing here is
 * written for them to recite — and the red flags are amber, because an unmet gate is exactly
 * the kind of thing only they can decide how to say.
 *
 * A question the model copied out of a community write-up carries that guide's source id, and
 * the sources — the map's, handed down by whichever screen this brief is on — turn it into the
 * host that reported it. An id that resolves to nothing shows nothing: "reported by" with
 * nobody behind it is the one claim this product is not allowed to make, and the question is
 * still worth preparing uncited.
 *
 * A section with nothing in it is not rendered. An empty heading is a promise the model did
 * not keep, and the brief reads better short than padded.
 */

export function BriefView({ brief, sources }: { brief: PrepBrief; sources?: ResearchSource[] }) {
  const empty =
    brief.likelyTopics.length === 0 &&
    brief.questionsToPrepare.length === 0 &&
    brief.questionsToAsk.length === 0 &&
    brief.factsToRehearse.length === 0 &&
    brief.redFlags.length === 0
  if (empty) return null

  // The sources by id. A screen that has no map hands none down, and an id we cannot resolve
  // is the same thing to a reader as no id at all — so both go through one lookup that misses.
  const sourceById = new Map((sources ?? []).map((s) => [s.id, s]))

  return (
    <div className="mt-5 grid min-w-0 gap-6 border-t border-line pt-5">
      <Section title="What this round probes" items={brief.likelyTopics}>
        <ul className="mt-2 grid gap-1.5">
          {brief.likelyTopics.map((topic, i) => (
            <li key={i} className="max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink">
              {topic}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Questions to prepare" items={brief.questionsToPrepare}>
        <ul className="mt-2 grid gap-3">
          {brief.questionsToPrepare.map((item, i) => {
            const source = item.sourceId ? sourceById.get(item.sourceId) : undefined
            return (
              <li key={i} className="max-w-[64ch]">
                <p className="text-[0.9375rem] leading-snug font-medium text-ink">
                  {item.q}
                  {source && (
                    <>
                      {' '}
                      {/* The separator is punctuation, not information — the link says the
                          whole thing on its own, and a screen reader should not read a dot. */}
                      <span aria-hidden="true" className="font-normal text-ink-3">
                        ·
                      </span>{' '}
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-link text-sm font-normal text-ink-3"
                      >
                        {`reported by ${source.host}`}
                      </a>
                    </>
                  )}
                </p>
                {/* The angle is the whole point of the pairing: which of YOUR facts answers it. */}
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{item.angle}</p>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Questions to ask back" items={brief.questionsToAsk}>
        <ul className="mt-2 grid gap-1.5">
          {brief.questionsToAsk.map((q, i) => (
            <li key={i} className="max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink">
              {q}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Facts to rehearse" items={brief.factsToRehearse}>
        <ul className="mt-2 grid gap-2.5">
          {brief.factsToRehearse.map((fact, i) => (
            // Quoted, and it looks quoted: these are the candidate's own claims, handed back
            // rather than composed. The display serif is the reading face used for documents.
            <li
              key={i}
              className="max-w-[62ch] border-l-2 border-line-strong pl-4 font-display text-[0.9375rem] leading-relaxed text-ink"
            >
              {fact}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Where this could go wrong" items={brief.redFlags}>
        <ul className="mt-2 grid gap-2">
          {brief.redFlags.map((flag, i) => (
            <li
              key={i}
              className="max-w-[62ch] border border-amber bg-amber-soft px-4 py-3 text-[0.9375rem] leading-relaxed text-ink"
            >
              {flag}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function Section({
  title,
  items,
  children,
}: {
  title: string
  items: unknown[]
  children: React.ReactNode
}) {
  if (items.length === 0) return null
  return (
    <section className="min-w-0">
      <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">{title}</h4>
      {children}
    </section>
  )
}
