'use client'

import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Fade a block in the first time it scrolls into view. The server renders it visible — a
 * reader without JavaScript, or a crawler, gets the whole page — and only once the page is
 * live does the block go pending, before paint, and wait for the observer. A browser with no
 * observer never hides anything. Reduced motion is handled by the CSS, which ignores
 * `pending` entirely.
 */
export function useReveal<T extends HTMLElement>(): { ref: React.RefObject<T | null>; pending: boolean } {
  const ref = useRef<T>(null)
  const [pending, setPending] = useState(false)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    // Already on screen at hydration: leave it be rather than blink it off and on.
    const box = node.getBoundingClientRect()
    if (box.top < window.innerHeight && box.bottom > 0) return
    setPending(true)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPending(false)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, pending }
}
