import type { Part } from '@/ai/genkit'
import type { EvidenceNote } from '@/ai/prompts/processSynthesize'
import type { RoleFamily } from '@/lib/research/roleFamily'

/**
 * The synthesis prompt: the brief and the evidence in, the guide out. The system text is the
 * spec's, word for word. Its whole job is to keep three kinds of sentence apart — what the
 * brief says, what people report, and what we suggest — and the layout below is what makes
 * that possible to check: the brief arrives whole under a heading of its own, the observations
 * carry their source ids in square brackets, and each digest is one labelled block. The guard
 * that follows checks exactly the two claims the layout supports.
 */
export const TAKE_HOME_SYNTHESIZE_SYSTEM = `You prepare a candidate for one take-home assignment from two kinds of evidence: the brief
they were given, and what people report about this company's take-home.
Rules:
1. brief.deliverables, brief.constraints and brief.evaluation come from the brief alone. Each
   item carries \`quote\`, a verbatim substring of the brief that says it — copy the words
   exactly. An item you cannot quote from the brief does not belong there, and the quote must
   say the whole item: an item resting on two places in the brief is two items, not one item
   quoting one of them. brief.timeLimit is the constraint that states how long the candidate
   has, quoted the same way, and null when the brief states none; it also appears in
   constraints. brief.task restates the assignment in one paragraph, in your words.
2. reported.tasks, reported.evaluation, reported.pitfalls and reported.time come from the
   observations and digests, each item citing the source ids that say it. Never cite a source
   for something it does not say; a sentence no source supports is left out, not written
   without ids.
3. plan is your suggestion: the steps, in order, that would produce what the brief asks for
   within the constraints it states, informed by what reviewers are reported to look for. Give
   each step a budget when the brief or the evidence states a time limit, and keep the total
   inside it. The plan cites nothing and claims nothing about the company. Where the brief
   leaves a choice open — a language, a framework, a tool — the step says the choice is open;
   it does not make it.
4. askRecruiter lists what the brief leaves open that the candidate should ask before
   starting — the expected time, the stack, how it will be reviewed — and what the evidence
   could not settle. Not the deadline: the round already asks for that. Nor a choice the brief
   deliberately leaves to the candidate: a brief that says the format or the tool is theirs to
   pick has answered it, and asking it back asks for the choice to be taken away.
5. caveats state the age and thinness of the evidence plainly, and say when grounded is
   false.
6. Say nothing about the candidate, in any field. This is about the assignment and the
   company.`

/**
 * One digest as the synthesis reads it. This is the flow's output minus the two fields the run
 * keeps for itself (`publishedAt` dates the source; `firstHand` ranks it), plus the source id,
 * which is what a citation is allowed to name.
 */
export interface TakeHomeEvidenceDigest {
  sourceId: string
  task: string
  timeGiven: string
  deliverables: string[]
  evaluation: string[]
  pitfalls: string[]
  takeaways: string[]
  quotes: string[]
}

export interface TakeHomeSynthesizePromptInput {
  jobSummary: string
  family: RoleFamily
  brief: string
  notes: EvidenceNote[]
  digests: TakeHomeEvidenceDigest[]
  sourceIds: string[]
  grounded: boolean
}

/**
 * One digest, laid out. An empty field is left out rather than sent as a bare label: a line
 * reading `pitfalls:` with nothing after it is an invitation to fill it in, and the one thing
 * the reported half of a guide may not contain is a sentence nobody wrote.
 */
function layOutDigest(digest: TakeHomeEvidenceDigest): string {
  return [
    `Digest of ${digest.sourceId}:`,
    ...(digest.task.trim() ? [`task: ${digest.task}`] : []),
    ...(digest.timeGiven.trim() ? [`time given: ${digest.timeGiven}`] : []),
    ...(digest.deliverables.length > 0 ? [`deliverables: ${digest.deliverables.join(' | ')}`] : []),
    ...(digest.evaluation.length > 0 ? [`evaluation: ${digest.evaluation.join(' | ')}`] : []),
    ...(digest.pitfalls.length > 0 ? [`pitfalls: ${digest.pitfalls.join(' | ')}`] : []),
    ...digest.takeaways.map((t) => `- ${t}`),
    ...digest.quotes.map((q) => `quote: "${q}"`),
  ].join('\n')
}

export function buildTakeHomeSynthesizePrompt(
  input: TakeHomeSynthesizePromptInput,
): { system: string; parts: Part[] } {
  const notes = input.notes
    .map((n) => `[${n.sourceIds.length > 0 ? n.sourceIds.join(', ') : 'unsupported'}] ${n.text}`)
    .join('\n')
  const digests = input.digests.map(layOutDigest).join('\n\n')
  // Five parts, always. The brief's heading is unconditional where the map's posting excerpt is
  // conditional: there is no take-home run without a brief — the route refuses one under 200
  // characters — and rule 1 spends its whole length talking about "the brief", which has to be
  // one thing the model can point at.
  return {
    system: TAKE_HOME_SYNTHESIZE_SYSTEM,
    parts: [
      { text: `Parsed job:\n${input.jobSummary}\n\nRole family: ${input.family}` },
      { text: `The brief, in its own words:\n${input.brief}` },
      { text: `Observations from search, each tagged with the source ids that support it:\n${notes || '(none)'}` },
      { text: `Digests of write-ups we read in full:\n${digests || '(none)'}` },
      { text: `Source ids you may cite: ${input.sourceIds.join(', ') || '(none)'}\ngrounded: ${input.grounded}` },
    ],
  }
}
