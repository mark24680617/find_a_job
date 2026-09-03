'use client'

import Image, { type StaticImageData } from 'next/image'
import { useReveal } from '@/components/landing/useReveal'
import board from '../../../public/landing/01-dashboard-pipeline-light.png'
import gates from '../../../public/landing/05-wizard-parse-confirm-gates-light.png'
import citations from '../../../public/landing/06-review-workspace-citations-light.png'
import clarify from '../../../public/landing/08-review-setup-clarify-cards-light.png'

/**
 * Four plates, captioned like exhibits. They alternate sides so the eye moves down the page
 * rather than down one column, and each is framed on the surface colour: in dark mode the
 * frame goes dark and the print stays paper, which is what a mounted print does.
 *
 * The mirror is the grid template, not `order`. A flipped row declares its own 2fr/3fr and
 * puts the caption first, so the image holds the wide column either way; swapping `order`
 * alone left the image in whichever cell came second, which shrank half the exhibits instead
 * of mirroring them. With no `order` classes left, DOM order is the reading order.
 *
 * The plate crops instead of scaling. The four screenshots run from 640 to 1520 px tall, so
 * fitting each one whole would hang two posters and two postcards on the same wall. A short
 * one still renders whole; a tall one is cut at the plate's bottom edge, which keeps the top
 * of the screen — where each of these screenshots makes its point — at a readable size.
 */

const PLATES: { src: StaticImageData; alt: string; heading: string; caption: string }[] = [
  {
    src: citations,
    alt: 'The review workspace: a drafted answer with cited phrases underlined, an amber card asking the candidate a question the agent will not guess, and the editable final answer with a live word count.',
    heading: 'Grounded drafting.',
    caption:
      'Underlined phrases are citations — select one and the fact behind it appears. What is not underlined is the agent’s own prose, and looks like it.',
  },
  {
    src: clarify,
    alt: 'Two positioning questions asked before drafting, each with a recommended option already selected.',
    heading: 'The clarify loop.',
    caption:
      'Before a long answer, the calls only you can make — each with a recommendation already picked, so the fast path is to glance and draft.',
  },
  {
    src: gates,
    alt: 'The parsed posting: company and role, an advisory about an unmet requirement, and a table of three requirements judged met, not met and unclear.',
    heading: 'Hard gates, judged honestly.',
    caption:
      'Every requirement gets a verdict against your facts, a read of how firmly it is worded, and — when one is unmet — an apply-or-skip advisory.',
  },
  {
    src: board,
    alt: 'The pipeline board: five columns from draft to rejected, each card showing company, role and how long since anything last happened to it.',
    heading: 'The pipeline.',
    caption:
      'Where everything is, and what has gone quiet. Interviews still ahead sit above it and export to your calendar.',
  },
]

function Plate({ plate, flip }: { plate: (typeof PLATES)[number]; flip: boolean }) {
  const { ref, pending } = useReveal<HTMLElement>()
  const frame = (
    <div className="border border-line bg-surface p-2">
      <div className="max-h-[30rem] overflow-hidden">
        <Image
          src={plate.src}
          alt={plate.alt}
          sizes="(min-width: 1024px) 60vw, 100vw"
          className="h-auto w-full object-top"
        />
      </div>
    </div>
  )
  const caption = (
    <figcaption className="min-w-0">
      <p className="font-medium text-ink">{plate.heading}</p>
      <p className="mt-1.5 max-w-[42ch] text-[0.9375rem] leading-relaxed text-ink-2">{plate.caption}</p>
    </figcaption>
  )
  return (
    <figure
      ref={ref}
      data-reveal={pending ? 'pending' : undefined}
      className={`reveal grid gap-4 lg:items-center lg:gap-10 ${
        flip
          ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'
          : 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
      }`}
    >
      {flip ? caption : frame}
      {flip ? frame : caption}
    </figure>
  )
}

export function Plates() {
  return (
    <section aria-labelledby="plates-heading" className="mx-auto max-w-6xl px-6 py-16">
      <h2 id="plates-heading" className="font-display text-2xl tracking-tight text-ink">
        What it looks like
      </h2>
      <div className="mt-10 grid gap-16">
        {PLATES.map((plate, i) => (
          <Plate key={plate.heading} plate={plate} flip={i % 2 === 1} />
        ))}
      </div>
    </section>
  )
}
