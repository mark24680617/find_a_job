import {
  FlowOutputError,
  generateStructured,
  type GenerateCall,
  type Part,
  type ThinkingLevel,
} from '@/ai/genkit'
import { BANNED_CLAIMS, buildResumeFindingsPrompt } from '@/ai/prompts/resumeFindings'
import type { BulletNoulId } from '@/ai/nouls'
import { ResumeFindingsOutSchema, type ResumeFindingsOut } from '@/ai/schemas'
import { doctrinePhrasesIn } from '@/lib/resume/doctrinePhrases'
import { normalizeWs } from '@/lib/research/quotes'

/**
 * MEDIUM, and measured: at no thinking, 8 of 8 replay letters invented claims about the candidate
 * on exactly this kind of work, and at MEDIUM none did (docs/notes/deps.md, "Thinking levels per
 * flow — evaluated 2026-09-14"). HIGH is used nowhere in this product and is not introduced here.
 */
const THINKING_LEVEL: ThinkingLevel = 'MEDIUM'

export interface ResumeFindingsInput {
  /** The VISIBLE text: hidden lines are out of every model input on this feature (§8). */
  resumeText: string
  failures: { checkId: string; source: string; lines: string[] }[]
  /** The fail-verdict bullets only, each with the Noul ids it failed (R24). */
  failedBullets: { id: string; text: string; failed: BulletNoulId[] }[]
  today: string
}

/**
 * What the schema cannot see, checked after generation.
 *
 * Every problem string names a check id, a bullet id or a position and never quotes a resume span.
 * These strings become a `FlowOutputError` message, and anything escaping a handler is logged by
 * the platform with its message and its stack (§8). The correction Part below is a different
 * thing: it never becomes an exception, so it may carry the rejected attempt back.
 */
function problemsWith(out: ResumeFindingsOut, input: ResumeFindingsInput): string[] {
  const problems: string[] = []
  const haystack = normalizeWs(input.resumeText)
  // A `bullet-<q>` id is handed over only for the questions some bullet actually failed (R24).
  const handed = new Set<string>([
    ...input.failures.map((f) => f.checkId),
    ...input.failedBullets.flatMap((b) => b.failed.map((q) => `bullet-${q}`)),
  ])

  out.findings.forEach((finding, i) => {
    const q = normalizeWs(finding.quote)
    if (q === '') {
      problems.push(`finding ${i} quotes no text`)
    } else if (!haystack.includes(q)) {
      problems.push(`finding ${i} quotes text that does not appear in the resume`)
    }
    if (!handed.has(finding.checkId)) {
      problems.push(
        `finding ${i} names checkId ${JSON.stringify(finding.checkId)}, which is not one of the failures handed over`,
      )
    } else if (finding.checkId.startsWith('bullet-')) {
      // R24: the quote has to sit inside a line that failed THAT judgement, not merely a line
      // that failed some judgement. Named by position, never by the line's text (§8).
      const question = finding.checkId.slice('bullet-'.length)
      const quote = normalizeWs(finding.quote)
      const inFailedLine = input.failedBullets.some(
        (b) => b.failed.some((q) => q === question) && normalizeWs(b.text).includes(quote),
      )
      if (!inFailedLine) {
        problems.push(`finding ${i} quotes no line that failed ${JSON.stringify(finding.checkId)}`)
      }
    }
    const prose = `${finding.explanation}\n${finding.fix}`
    for (const claim of BANNED_CLAIMS) {
      if (claim.match.test(prose)) problems.push(`finding ${i} claims ${claim.why}`)
    }
    // The self-description check's own matcher, imported rather than copied (R33, C-13), so a
    // model's prose is held to the same whole-word match as the resume.
    // A phrase inside the finding's own quote is the candidate's word being named, not the
    // product writing it — and the quote guard above has already proved it is in the resume.
    const quoted = q.toLowerCase()
    for (const hit of doctrinePhrasesIn(prose)) {
      if (quoted.includes(hit)) continue
      // Naming our own banned phrase is not quoting the candidate: the phrase came out of the
      // model, and the correction is unactionable without it.
      problems.push(`finding ${i} uses the phrase ${JSON.stringify(hit)}, which this product does not write`)
    }
  })

  // Two findings that break the same rule are one problem said once — the list is read by a model
  // as instructions and by a person as an explanation, and both suffer repetition.
  return [...new Set(problems)]
}

/** The correction, carrying the rejected attempt back, as `answerDraft`'s does. */
const correction = (previous: ResumeFindingsOut, problems: string[]): Part => ({
  text: [
    'Your previous answer was rejected.',
    '',
    'What you wrote:',
    ...(previous.findings.length === 0
      ? ['(no findings)']
      : previous.findings.map(
          (f, i) => `- finding ${i}: ${f.checkId} -> ${JSON.stringify(f.quote)}\n  ${f.explanation}\n  ${f.fix}`,
        )),
    '',
    'Why it was rejected:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Write every finding again with all of those fixed. Return the full structured output — the',
    'findings, their quotes, and anything you must ask.',
  ].join('\n'),
})

/**
 * One call, over the failing items only — never over the whole resume, and never at all when
 * nothing failed. A run with nothing to explain costs nothing and returns an empty list, which is
 * also §6.1's "Nothing to rewrite" state seen from this end.
 *
 * `answerDraft`'s disposition: correct once, then refuse. Chosen deliberately, because the
 * rejected thing is the product rather than a line the user can afford to lose — a finding whose
 * quote is not in their document reads as verified and is not.
 */
export async function runResumeFindings(
  input: ResumeFindingsInput,
  generate?: GenerateCall,
): Promise<ResumeFindingsOut> {
  if (input.failures.length === 0 && input.failedBullets.length === 0) return { findings: [] }

  const { system, parts } = buildResumeFindingsPrompt(input)
  const ask = (prompt: Part[]) =>
    generateStructured(
      {
        parts: prompt,
        system,
        schema: ResumeFindingsOutSchema,
        thinkingLevel: THINKING_LEVEL,
        temperature: 0,
      },
      generate,
    )

  const first = await ask(parts)
  const problems = problemsWith(first, input)
  if (problems.length === 0) return first

  const second = await ask([...parts, correction(first, problems)])
  const remaining = problemsWith(second, input)
  if (remaining.length === 0) return second

  throw new FlowOutputError(
    `The findings were still wrong after one correction — ${remaining.join('; ')}`,
  )
}
