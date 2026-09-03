'use client'

import { use } from 'react'
import { AppShell } from '@/components/AppShell'
import { RoundPage } from '@/components/interviews/RoundPage'

export default function InterviewRoundPage({ params }: PageProps<'/applications/[id]/interviews/[rid]'>) {
  const { id, rid } = use(params)
  return (
    <AppShell>
      <RoundPage appId={id} rid={rid} />
    </AppShell>
  )
}
