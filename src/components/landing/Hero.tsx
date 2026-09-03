'use client'

import Image from 'next/image'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import hero from '../../../public/landing/hero.png'

/**
 * The thesis, said once, and the one picture. A split, not a centred stack: the sentence on
 * the left is the argument and the plate on the right is the exhibit, and they read in that
 * order. The children rise in on load — the single entrance this page allows itself.
 */

/** Each child sets its own delay through --i; `rise` reads it. */
const rise = (i: number) => ({ className: 'rise', style: { '--i': i } as CSSProperties })

export function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-6 pt-16 pb-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-16 lg:pt-24">
      <div className="min-w-0">
        <p {...rise(0)} className="rise text-xs font-medium uppercase tracking-[0.18em] text-accent">
          An open-source job-application agent
        </p>
        <h1
          {...rise(1)}
          className="rise mt-5 max-w-[16ch] font-display text-[clamp(2.25rem,1.4rem+3.2vw,4rem)] leading-[1.05] tracking-tight text-ink"
        >
          Your story is unique. AI helps you tell it — it doesn’t replace it.
        </h1>
        <p {...rise(2)} className="rise mt-6 max-w-[52ch] text-[1.0625rem] leading-relaxed text-ink-2">
          It reads your resume once, reads the posting, and writes each answer out of things you
          have actually done — every claim underlined and traceable to the fact it came from.
          Where it would have to invent, it stops and asks you instead.
        </p>
        <div {...rise(3)} className="rise mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
          <Link href="/sign-in?mode=sign-up" className="btn btn-primary">
            Get started
          </Link>
          <a href="#demo" className="btn btn-quiet">
            Watch the demo
          </a>
        </div>
        <p {...rise(4)} className="rise mt-4 text-sm text-ink-3">
          Free to use. MIT-licensed. It never submits anything on your behalf.
        </p>
      </div>

      <figure {...rise(2)} className="rise min-w-0">
        <div className="border border-line bg-surface p-3">
          <Image
            src={hero}
            alt="An index-card drawer with one card pulled out; a sentence on it has one phrase underlined, and a thread runs from that phrase to a second card carrying the source."
            priority
            sizes="(min-width: 1024px) 45vw, 100vw"
            className="h-auto w-full"
          />
        </div>
        <figcaption className="mt-2 text-xs text-ink-3">Fig. 1 — a claim, and the card it came from.</figcaption>
      </figure>
    </section>
  )
}
