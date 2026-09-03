import type { Metadata } from 'next'
import { Literata, Public_Sans } from 'next/font/google'
import './globals.css'

// Two families, contrasting on the serif/sans axis and nothing else. Literata is an archival
// reading serif; Public Sans was drawn for government forms. Between them they say "this is a
// place where a record is kept", which is what the product is. See `.impeccable.md`.

const literata = Literata({
  variable: '--font-literata',
  subsets: ['latin'],
  display: 'swap',
})

const publicSans = Public_Sans({
  variable: '--font-public-sans',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://find-a-job-572064776552.us-west1.run.app'),
  title: 'Find a Job',
  description: 'Your story is unique. AI helps you tell it — it doesn’t replace it.',
  openGraph: {
    title: 'Find a Job',
    description:
      'An open-source job-application agent that writes every answer out of your own facts, cites each one, and asks instead of inventing.',
    type: 'website',
    images: ['/landing/og.jpg'],
  },
  twitter: { card: 'summary_large_image' },
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${literata.variable} ${publicSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
