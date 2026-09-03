'use client'

import Link from 'next/link'

/** Where the code is, what it runs on, and the way in — once, quietly, at the end. */

export function LandingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-6 text-sm text-ink-3">
        <a href="https://github.com/mark24680617/find_a_job" className="btn-link" target="_blank" rel="noreferrer">
          Find a Job · MIT licence
        </a>
        <span>Built with Gemini 3.7 Flash · Genkit · Cloud Run · Firebase</span>
        <Link href="/sign-in" className="btn-link ml-auto">
          Sign in
        </Link>
      </div>
    </footer>
  )
}
