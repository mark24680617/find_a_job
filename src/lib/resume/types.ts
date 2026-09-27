/**
 * The stored resume and the small result shapes every other module on this feature reads.
 *
 * Pure types and nothing else — no Firestore, no model, no `pdfjs-dist` — so this file is safe
 * in a client bundle. `src/lib/types.ts` re-exports the set at the end of that file, which is
 * how `src/ai/schemas.ts` reaches them the way it reaches every other domain type.
 *
 * `DiagnoseResult['findings']` and `AcceptedRewrite['citations']` are written out structurally
 * rather than aliased to the flow-output types they mirror. That is deliberate: `SchemaGuards`
 * (src/ai/schemas.ts:278) asserts mutual assignability between a flow output and its counterpart
 * here, and an alias would make the assertion tautological. `Citation` and
 * `AnswerDraftOut['citations']` already sit exactly this way.
 */

/**
 * Which judge answered. Declared here rather than in `src/ai/jev.ts` so that this module stays
 * client-safe: `src/ai/jev.ts` opens with `import 'server-only'`, and a types file that reached
 * into it would put a build error one careless import away. `src/ai/jev.ts` re-exports this name
 * unchanged (`export type { Judge } from '@/lib/resume/types'`), so `import type { Judge } from
 * '@/ai/jev'` still reads as the spec writes it, and `@/lib/types` re-exports it with the rest of
 * this module (R39).
 */
export type Judge = 'jev' | 'gemini'

export interface StoredResume {
  addedAt: string                      // ISO; the basis every derived artifact is stamped with
  filename: string
  bytes: number
  /** CANONICAL. Every citation and every quote on this feature is checked against this string. */
  text: string
  /**
   * Every run the parser produced, in reading order. `size: 0` means the reader never sees this
   * run — under the legible floor, or filled white — and `text` is the join of the runs with
   * `size > 0`. One number, one rule, for both §6.1's hidden-text check and §8's exclusion of
   * hidden text from every model input. `hiddenBy` is set on every size-0 run and only says
   * which half fired — `'size'` for the geometry half, `'colour'` for a white fill read through
   * `getOperatorList()` — so §6.1's two hidden-text rows can tell them apart; it is never the
   * test for "hidden". Text drawn off the page box never arrives here: pdfjs-dist 6.3.289 drops
   * it before `getTextContent()` returns (deps.md, Open decision 5). (amended 2026-09-24, R2, R9)
   * `x`/`y` are the page's own user space, whose box need not start at 0,0, so a negative
   * coordinate says nothing about visibility (final review, judging-1).
   */
  lines: {
    page: number
    x: number
    y: number
    size: number
    hiddenBy?: 'size' | 'colour'
    font: string
    text: string
  }[]
  sections: { name: string; fromLine: number; toLine: number }[]
  entries: {
    org: string
    role: string
    fromRaw: string
    toRaw: string
    from: string | null    // null = could not be read (D4). Never guessed.
    to: string | null
    bulletIds: string[]
    bulletLines: number[]
  }[]
  /** `b1 … bN` over the document's bullets in reading order, independent of entry (spec §5.1). */
  bullets: { id: string; entryIndex: number; lines: number[]; text: string }[]
  language: 'en' | 'other'             // decided in code; gates the checks and the Nouls (§6.1)
  diagnose?: DiagnoseResult            // each stamped reviewedFrom: <addedAt>
  gaps?: GapsResult
  rewrites?: AcceptedRewrite[]
  asks?: AnsweredAsk[]                 // answered askHuman entries; the Y rule's third source
  snippetCheck?: SnippetCheck
}

export interface BulletJudgement {
  bulletId: string
  questionId: string
  noul: number | null                   // null when judge === 'gemini': it returns no number
  verdict: 'pass' | 'fail' | 'unjudged' // §6.1's decision rule, computed in code
  model: string
  judge: Judge
}

export interface DiagnoseResult {
  reviewedFrom: string
  judge: Judge
  ranAt: string
  checks: { checkId: string; state: 'pass' | 'fail' | 'not-run'; source: string }[]
  judgements: BulletJudgement[]         // "18 checks, 4 need attention" counts over checks + these
  findings: {
    checkId: string
    quote: string
    explanation: string
    fix: string
    askHuman: { question: string; why: string } | null
  }[]
}

export interface GapsResult {
  reviewedFrom: string
  judge: Judge
  ranAt: string
  roleFamily: string
  postingsUsed: number
  onetRelease: string
  /**
   * `inPostings`: the name came from the saved postings (Tier 0), not only from O*NET.
   * `namedInResume`: the resume's visible text names it. Both computed by D5's `bucketSkills`,
   * because the client holds no posting terms; the page words its headings and `why` from these
   * flags and says "in the postings" only when `inPostings` is true. (amended 2026-09-24, R37)
   * `evidence`: the text each flag matched — the saved posting term, the first visible resume line
   * (a `lines[].text`) and the fact claim — null where that flag is false. The page draws a
   * statement about the user only with its quote, so a false match shows as one; a flag with no
   * text (a name split across two lines) draws no statement. (amended 2026-09-26, F2)
   */
  skills: {
    name: string
    bucket: 1 | 2 | 3
    inPostings: boolean
    namedInResume: boolean
    judgement: BulletJudgement | null
    evidence: { posting: string | null; resume: string | null; bank: string | null }
  }[]
}

export interface AcceptedRewrite {
  reviewedFrom: string
  judge: Judge
  acceptedAt: string
  bulletId: string
  text: string
  citations: { claimSpan: string; factId: string | null; resumeSpan: string | null }[]
  recheck: BulletJudgement[]            // "Re-checked: 3 of 4" is arithmetic over this
}

export interface AnsweredAsk {
  askId: string
  question: string
  answer: string
  answeredAt: string
}

/**
 * One row of the evidence table. `state` is `'not-run'` for a check the language gate skipped and
 * for a check whose input the §9.3 spike found unreachable; `source` is the named vendor or the
 * sentence that says this is our judgement, never a borrowed name. `lines` are indices into
 * `StoredResume.lines`, so the page can show the line the check is about beside the verdict. The
 * stored slice on `DiagnoseResult` drops `lines`, because a stored per-glyph index list is
 * document weight for a number the page recomputes.
 */
export interface CheckResult {
  checkId: string
  state: 'pass' | 'fail' | 'not-run'
  source: string
  lines: number[]
}

/** What `extractResume` produces: the structural half of a StoredResume, and nothing about how it arrived. */
export type Extracted = Pick<
  StoredResume,
  'text' | 'lines' | 'sections' | 'entries' | 'bullets' | 'language'
> & { pages: number }

/** Spec §5.4's stored shape. Reported, never auto-corrected: `located + missing.length === total`. */
export interface SnippetCheck {
  reviewedFrom: string
  located: number
  total: number
  missing: string[]        // the sourceSnippets that could not be found, verbatim as stored
}
