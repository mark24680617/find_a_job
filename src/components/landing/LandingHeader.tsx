'use client'

import Link from 'next/link'

/**
 * The landing's own header — the shell's is for a signed-in person and does not render here.
 * Three anchors into the page, and the two ways in. Sticky so the way in is never scrolled
 * away; on a narrow screen the anchors go and the two actions stay, because nothing a visitor
 * needs lives only in the anchors.
 */

const ANCHORS = [
  { href: '#how', label: 'How it works' },
  { href: '#demo', label: 'Demo' },
  { href: '#faq', label: 'FAQ' },
] as const

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-x-8 px-6 py-3.5">
        <span className="font-display text-base font-medium tracking-tight text-ink">Find a Job</span>
        <nav aria-label="Sections" className="hidden items-center gap-6 text-sm sm:flex">
          {ANCHORS.map(({ href, label }) => (
            <a key={href} href={href} className="text-ink-2 hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <Link href="/sign-in" className="btn-link">
            Sign in
          </Link>
          <Link href="/sign-in?mode=sign-up" className="btn btn-primary">
            Get started
          </Link>
        </div>
      </div>
    </header>
  )
}
