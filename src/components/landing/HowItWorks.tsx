'use client'

import { Specimen } from '@/components/landing/Specimen'

/**
 * A ledger, not a row of cards: four numbered entries divided by rules, each one sentence of
 * what happens and one of why it is done that way. The specimen sits under the third entry,
 * where the citation is first mentioned, so the mechanism is shown at the moment it is named.
 */

const STEPS = [
  {
    n: '01',
    heading: 'Read your resume once',
    line: 'Drop in a PDF or paste notes. It splits them into facts, each carrying the exact fragment of your own text it came from — delete a fact and the agent can no longer say it.',
  },
  {
    n: '02',
    heading: 'Read the posting honestly',
    line: 'Paste a link and every requirement gets a verdict against your facts — met, not met, unclear — and a read of how firmly it is worded. A firm no is said before you write four answers, not after.',
  },
  {
    n: '03',
    heading: 'Draft each answer, cited',
    line: 'Before a long answer it asks the positioning calls only you can make, with a recommendation already picked. Then it writes, and every factual sentence points at a fact. What it cannot ground becomes a question for you.',
  },
  {
    n: '04',
    heading: 'You review, paste, submit',
    line: 'Edit the answer until it is yours. It learns your voice from what you change. It never presses submit — you read it, you paste it, you send it.',
  },
] as const

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-heading" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
      <h2 id="how-heading" className="font-display text-2xl tracking-tight text-ink">
        How it works
      </h2>
      <ol className="mt-8 divide-y divide-line border-y border-line">
        {STEPS.map((step) => (
          <li key={step.n} className="grid gap-x-6 gap-y-3 py-6 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
            <span className="tnum font-display text-lg text-accent" aria-hidden="true">
              {step.n}
            </span>
            <div className="min-w-0">
              <h3 className="text-[1.0625rem] font-medium text-ink">{step.heading}</h3>
              <p className="mt-1.5 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">{step.line}</p>
              {step.n === '03' && (
                <div className="mt-6">
                  <Specimen />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
