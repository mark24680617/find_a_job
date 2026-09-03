'use client'

import { Demo } from '@/components/landing/Demo'
import { Faq } from '@/components/landing/Faq'
import { Hero } from '@/components/landing/Hero'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { Plates } from '@/components/landing/Plates'

/**
 * The page a signed-out visitor gets at /. One record, read top to bottom: the thesis, how it
 * works with the mechanism shown live, what it looks like, the demo behind a poster, the
 * questions people ask, and a footer that says where the code is. Nothing here is fetched;
 * the whole page is in the first response.
 */

export function Landing() {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <Plates />
        <Demo />
        <Faq />
      </main>
      <LandingFooter />
    </div>
  )
}
