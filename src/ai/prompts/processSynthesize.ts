import type { Part } from '@/ai/genkit'
import type { RoleFamily } from '@/lib/research/roleFamily'

/**
 * The synthesis prompt: everything gathered, in, the loop out. The system text is the spec's,
 * word for word. The evidence is laid out with its source ids in square brackets, because the
 * one thing the model must do right is point each stage at what reports it — and the guard
 * that follows checks exactly that.
 */
export const SYNTHESIZE_SYSTEM = `You draw the interview loop for one company and one role from the evidence provided.
Rules:
1. Every stage cites the source ids that report it. A stage no source reports may still be
   listed when the role family makes it usual (a coding round for a software engineer), but
   its confidence is "inferred" and its sourceIds are empty. Never cite a source for something
   it does not say.
2. Order stages as the loop runs. Merge duplicate reports of the same stage; keep the name a
   candidate would recognise from the notice they will receive.
3. takeHome.present is "yes" only when a source says so; "no" only when a source explicitly
   says there is none or describes the whole loop from first contact to offer without one;
   when no source settles it, "unknown". Silence is not "no".
4. askRecruiter lists what the evidence leaves open and a candidate should ask before the
   first round — round count, take-home, who they will meet, what to prepare.
5. caveats state the age and thinness of the evidence plainly. If grounded is false, say the
   map is drawn from the posting and the role family only.
6. Tips are concrete and honest. They prepare the candidate to tell their own story; they do
   not script answers and they do not coach deception.`

export interface EvidenceNote {
  sourceIds: string[]
  text: string
}

export interface EvidenceDigest {
  sourceId: string
  takeaways: string[]
  questionsReported: string[]
  quotes: string[]
}

export interface ProcessSynthesizePromptInput {
  jobSummary: string
  jdExcerpt: string
  family: RoleFamily
  grounded: boolean
  notes: EvidenceNote[]
  digests: EvidenceDigest[]
  sourceIds: string[]
}

export function buildProcessSynthesizePrompt(input: ProcessSynthesizePromptInput): { system: string; parts: Part[] } {
  const notes = input.notes
    .map((n) => `[${n.sourceIds.length > 0 ? n.sourceIds.join(', ') : 'unsupported'}] ${n.text}`)
    .join('\n')
  const digests = input.digests
    .map((d) =>
      [
        `Digest of ${d.sourceId}:`,
        ...d.takeaways.map((t) => `- ${t}`),
        ...(d.questionsReported.length > 0 ? [`questions reported: ${d.questionsReported.join(' | ')}`] : []),
        ...d.quotes.map((q) => `quote: "${q}"`),
      ].join('\n'),
    )
    .join('\n\n')
  const parts: Part[] = [
    { text: `Parsed job:\n${input.jobSummary}\n\nRole family: ${input.family}` },
  ]
  if (input.jdExcerpt.trim()) parts.push({ text: `The posting, in its own words (excerpt):\n${input.jdExcerpt}` })
  parts.push({ text: `Observations from search, each tagged with the source ids that support it:\n${notes || '(none)'}` })
  parts.push({ text: `Digests of write-ups we read in full:\n${digests || '(none)'}` })
  parts.push({ text: `Source ids you may cite: ${input.sourceIds.join(', ') || '(none)'}\ngrounded: ${input.grounded}` })
  return { system: SYNTHESIZE_SYSTEM, parts }
}
