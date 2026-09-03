'use client'

import { FAQ } from '@/lib/landing/faq'

/**
 * Native disclosures in a ruled list. The browser does the opening and closing, the CSS in
 * globals.css draws the chevron, and the first answer stands open so the list is never a wall
 * of closed doors.
 */

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="faq mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
      <h2 id="faq-heading" className="font-display text-2xl tracking-tight text-ink">
        Questions people ask
      </h2>
      <div className="mt-8 max-w-[68ch] divide-y divide-line border-y border-line">
        {FAQ.map((item, i) => (
          <details key={item.q} open={i === 0} className="py-4">
            <summary className="flex items-center justify-between gap-4 text-[1.0625rem] font-medium text-ink">
              <span>{item.q}</span>
            </summary>
            <p className="mt-3 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
