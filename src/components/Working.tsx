'use client'

import { useEffect, useState, type ReactNode } from 'react'

/**
 * The wait, made legible. One shape for every slow thing in the product.
 *
 * All of them are a model reading a document — a resume, a posting, a form, a role — and all of
 * them take between five and twenty seconds, which is long enough that a still screen reads as a
 * broken one. So each shows the same three things: a hairline being swept (in `globals.css`, so
 * the animation costs nothing), the part of the reading happening now, and how long the whole
 * thing usually takes.
 *
 * The stages are an honest account of the work rather than a progress bar: the flows report
 * nothing between the request and the answer, so the lines advance on a clock and the last one
 * simply stays until the answer lands. Nothing here claims a percentage it cannot know.
 *
 * **The region is mounted whether or not anything is happening, and only its contents change.**
 * A `role="status"` element that arrives in the DOM already carrying its message is not
 * announced by several screen readers — the region has to exist first for the change to be a
 * change. So a caller renders this permanently, hands it the resting copy for that surface as
 * `children`, and flips `busy`; between waits the surface looks exactly as it did before. For
 * the same reason nothing between here and the page may carry `aria-busy`: that tells assistive
 * tech to hold back updates from inside it, which is the opposite of the point.
 *
 * `role="status"` announces each stage once. Two or three lines across twenty seconds is the
 * difference between telling somebody what is happening and talking over everything else.
 */

export interface Stage {
  /** Milliseconds after the wait began that this line takes over. The first stage is at 0. */
  at: number
  text: string
}

interface Props {
  /** Whether the wait is happening now. The region stays mounted either way. */
  busy: boolean
  stages: readonly Stage[]
  /** What "a while" means here, so nobody has to guess whether it has hung. */
  note: string
  className?: string
  /** What stands in this spot between waits — the resting copy for the surface. */
  children?: ReactNode
}

export function Working({ busy, stages, note, className = '', children }: Props) {
  const [index, setIndex] = useState(0)

  // The clock needs the timings and nothing else, so it depends on them as a primitive: a caller
  // writing its stages inline re-creates the array on every parent render, and an array in the
  // dependency list would restart the clock each time and strand the first line.
  const timings = stages.map((stage) => stage.at).join(',')

  // Every wait starts from its first line, however the one before it ended — so the reset keys
  // on the identity of the wait, not on `busy` alone. One wait can hand straight over to
  // another without `busy` ever dipping: when the positioning round comes back with nothing to
  // ask, clearing it and starting the draft land in the same render, and a reset watching only
  // `busy` would open the draft on the clarify round's second line. Adjusting state during
  // render is React's supported way to reset it from a changing input, and it lands before the
  // paint rather than after a frame of the wrong copy.
  const wait = `${busy}|${timings}`
  const [prevWait, setPrevWait] = useState(wait)
  if (prevWait !== wait) {
    setPrevWait(wait)
    setIndex(0)
  }

  useEffect(() => {
    if (!busy) return
    const timers = timings
      .split(',')
      .slice(1)
      .map((at, i) => window.setTimeout(() => setIndex(i + 1), Number(at)))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [busy, timings])

  return (
    <div role="status" className={className}>
      {busy ? (
        <>
          <div className="working" aria-hidden="true" />
          <p className="mt-2.5 text-sm text-ink-2">{stages[index]?.text ?? ''}</p>
          <p className="mt-0.5 text-sm text-ink-3">{note}</p>
        </>
      ) : (
        children
      )}
    </div>
  )
}
