'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import poster from '../../../public/landing/demo-poster.jpg'

/**
 * The demo, behind its own poster. Nothing from YouTube loads until the play control is
 * pressed — a page about custody of your data should not hand a visitor to a third party for
 * scrolling past a picture. The privacy-enhanced host is used when it does load.
 */

const VIDEO_ID = '8R0M3HLGvAE'

export function Demo() {
  const [playing, setPlaying] = useState(false)
  const player = useRef<HTMLIFrameElement>(null)

  // Playing unmounts the button that had focus, which would drop it on <body> and send the
  // next Tab back to the top of the document. Hand it to the player instead.
  useEffect(() => {
    if (playing) player.current?.focus()
  }, [playing])

  return (
    <section id="demo" aria-labelledby="demo-heading" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
      <h2 id="demo-heading" className="font-display text-2xl tracking-tight text-ink">
        Four minutes, start to finish
      </h2>
      <p className="mt-2 max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-2">
        The whole loop on the live app — profile, posting, a cited draft, and the interview brief
        that follows.
      </p>
      <div className="mt-8 border border-line bg-surface p-2">
        <div className="relative aspect-video w-full overflow-hidden bg-canvas">
          {playing ? (
            <iframe
              ref={player}
              src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
              title="Find a Job — demo"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : (
            <>
              <Image src={poster} alt="" sizes="(min-width: 1024px) 72rem, 100vw" className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center">
                <button
                  type="button"
                  className="btn btn-primary"
                  aria-label="Play the demo video"
                  onClick={() => setPlaying(true)}
                >
                  Play the demo
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <p className="mt-3 text-sm">
        <a href={`https://youtu.be/${VIDEO_ID}`} className="btn-link" target="_blank" rel="noreferrer">
          Open on YouTube
        </a>
      </p>
    </section>
  )
}
