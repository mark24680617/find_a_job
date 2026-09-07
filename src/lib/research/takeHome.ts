import { runTakeHomeDigest } from '@/ai/flows/takeHomeDigest'
import { runTakeHomeSynthesize } from '@/ai/flows/takeHomeSynthesize'
import { FlowOutputError } from '@/ai/genkit'
import { summarizeJob } from '@/ai/prompts/prepBrief'
import type { TakeHomeEvidenceDigest } from '@/ai/prompts/takeHomeSynthesize'
import type { TakeHomeDigestOut } from '@/ai/schemas'
import { gatherEvidence, readGuides, type GatherTrace } from '@/lib/research/pipeline'
import { planTakeHomeQueries } from '@/lib/research/planQueries'
import { roleFamily } from '@/lib/research/roleFamily'
import type { ParsedJob, TakeHomeDigest, TakeHomeGuide } from '@/lib/types'

/**
 * Research one company's take-home, and plan this one. The same five steps the process map
 * runs — plan the searches, read the web through them, ask where people compare notes, read
 * and digest the best few write-ups, draw the answer from all of it and guard it — pointed at
 * a different question, and given one thing the map never has: the brief the candidate is
 * actually holding.
 *
 * The shape is `researchProcess`'s because the two share `gatherEvidence` and `readGuides`
 * outright; what differs is the words this run searches with, the words it ranks titles by,
 * and the digest it asks for. It knows nothing about requests or the database — the route
 * calls it between its guards and its write, and the smoke calls it with a brief in a file.
 */

/**
 * What `quoted()` appends to the community searches in place of the map's `interview`. A
 * thread about the loop is not evidence about the assignment, and the two searches are the
 * only place this run could have asked the wrong question without noticing.
 */
const COMMUNITY_TERMS = 'take home'
/** Hacker News titles worth keeping: still interviews, plus the words a take-home goes by. */
const COMMUNITY_TITLE = /interview|take[- ]?home|assignment/i
/** How a title earns a read here. Deliberately not `interview`: the loop is not the subject. */
const GUIDE_TITLE = /take[- ]?home|assignment|exercise/i

/** Sources are numbered s1, s2, …; sorting on the number keeps s10 after s9. */
const bySourceId = (a: { sourceId: string }, b: { sourceId: string }): number =>
  Number(a.sourceId.slice(1)) - Number(b.sourceId.slice(1))

export interface TakeHomeResearchInput {
  company: string
  role: string
  parsed: ParsedJob
  /** The brief in use, already cut at MAX_BRIEF_CHARS by the caller (`briefInUse`). */
  brief: string
  /** Which brief that was — `assignment.addedAt`, or `'notice'`. Copied onto the guide. */
  plannedFrom: string
  /**
   * The posting's address, when the application has one. Handed straight to `gatherEvidence`:
   * the posting's host is classified as posting, as the map does.
   */
  sourceUrl?: string
  onGathers?: (traces: GatherTrace[]) => void
  /** How many pages the read step tried, and how many became digests. The smoke prints it. */
  onReads?: (counts: { attempted: number; landed: number }) => void
}

/**
 * The guide, or a throw. `FlowOutputError` from the synthesis means the model could not draw a
 * guide that passed its guard twice — the caller decides what that costs the person. Nothing
 * is written anywhere here, so a failed run costs a minute and not the plan they already had.
 */
export async function researchTakeHome(input: TakeHomeResearchInput): Promise<TakeHomeGuide> {
  const { company, role, parsed, brief, plannedFrom, sourceUrl } = input
  const family = roleFamily(role)
  // One clock for the whole gather-and-read half: it gives the fourth query its year and it is
  // what `readGuides` measures staleness against. The guide's own stamp is taken at the end.
  const startedAt = new Date().toISOString()
  const queries = planTakeHomeQueries(company, family, new Date(startedAt).getFullYear())

  const { sources, notes, grounded } = await gatherEvidence({
    company,
    role,
    family,
    queries,
    community: { terms: COMMUNITY_TERMS, titlePattern: COMMUNITY_TITLE },
    sourceUrl,
    startedAt,
    onGathers: input.onGathers,
  })

  const read = await readGuides<TakeHomeDigestOut>({
    sources,
    company,
    startedAt,
    titleTerm: GUIDE_TITLE,
    onReads: input.onReads,
    digest: async (source, text) => {
      let digest: TakeHomeDigestOut
      try {
        digest = await runTakeHomeDigest({ company, title: source.title, text })
      } catch (error) {
        // A write-up the model could not digest is one source that stays a link, not a run
        // that fails. Anything that is not a flow failure — a quota, a bug — goes up.
        if (error instanceof FlowOutputError) return null
        throw error
      }
      // Nothing a candidate could use came out of it: most often a page that turned out not to
      // be about this company's take-home at all, which the prompt asks be answered emptily.
      // Returning null leaves the source unread, and the date below is not taken from it.
      // This rule is the run's and not the flow's: `runTakeHomeDigest` returns a digest with no
      // takeaways as it is, and only here — where a source can still be left a link — is it null.
      if (digest.takeaways.length === 0) return null
      if (digest.publishedAt && !source.publishedAt) source.publishedAt = digest.publishedAt
      return digest
    },
  })

  // Landing order is the order the reads happened to finish in, which is nothing a reader can
  // follow. Sorted once here, so the stored digests and the prompt's blocks agree with the
  // numbering of the sources beside them.
  read.sort(bySourceId)
  const guides: TakeHomeDigest[] = read.map(({ sourceId, digest, stale }) => ({
    sourceId,
    takeaways: digest.takeaways,
    quotes: digest.quotes,
    stale,
    firstHand: digest.firstHand,
  }))
  // The structured half of a digest — what the task was, what was handed in, what the feedback
  // said — feeds the synthesis and is not stored: it is raw material for the guide's `reported`
  // section, and keeping a second copy of it on the record would be two accounts to keep true.
  const digests: TakeHomeEvidenceDigest[] = read.map(({ sourceId, digest }) => ({
    sourceId,
    task: digest.task,
    timeGiven: digest.timeGiven,
    deliverables: digest.deliverables,
    evaluation: digest.evaluation,
    pitfalls: digest.pitfalls,
    takeaways: digest.takeaways,
    quotes: digest.quotes,
  }))

  const drawn = await runTakeHomeSynthesize({
    jobSummary: summarizeJob(parsed),
    family,
    // Handed over once and doing two jobs: the prompt shows this text to the model under its own
    // heading, and the flow's guard checks every `Quoted` in the answer against this same text.
    // One field rather than two, so there is no way to show the model one brief and check another.
    brief,
    notes,
    digests,
    sourceIds: sources.map((s) => s.id),
    grounded,
  })

  // Stamped here rather than at the top: the searching and the reading take a minute between
  // them, and what the record should carry is when the plan was finished. `plannedFrom` travels
  // with it so the route can refuse a plan whose brief was replaced while it ran, and so the
  // page can say "planned from an earlier brief" if one ever slips past that.
  return { ...drawn, sources, guides, grounded, plannedFrom, plannedAt: new Date().toISOString() }
}
