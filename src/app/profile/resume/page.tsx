import { AppShell } from '@/components/AppShell'
import { ResumePageClient } from '@/components/resume/ResumePageClient'

// The frame, and nothing else: the screen below loads its own document, the way the account
// screen does. A server component because it holds no state — `src/app/page.tsx` is the
// precedent — and both of the components it renders are client ones.

export default function ResumePage() {
  return (
    <AppShell>
      <ResumePageClient />
    </AppShell>
  )
}
