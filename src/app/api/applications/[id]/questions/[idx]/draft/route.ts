import { runAnswerDraft } from '@/ai/flows/answerDraft'
import { runProfileIngest } from '@/ai/flows/profileIngest'
import { FlowOutputError } from '@/ai/genkit'
import type { AnswerDraftOut } from '@/ai/schemas'
import { requireUser } from '@/lib/auth'
import { getApplication, getProfile, setProfile, updateApplication } from '@/lib/db'
import { mergeStory } from '@/lib/profileMerge'
import type { Application, AskHuman, ClarifyAnswer, Profile, Question } from '@/lib/types'

// Draft one question's answer from the profile, the posting and whatever the human has told
// the agent so far. Node runtime (the default): `@/lib/db` reaches Firestore through
// firebase-admin and the Genkit call needs it too; requireUser runs before either.
//
// Re-drafting is the normal case, not the exception: the first draft usually comes back with
// an open askHuman, the human answers it, and the same endpoint runs again with the answer in
// hand. So the answers have to survive the redraft — they are the human's work, and losing
// them would make answering the agent's questions pointless.

type Ctx = { params: Promise<{ id: string; idx: string }> }

/** How much of the posting the model reads. Long postings are truncated, not refused. */
const JD_LIMIT = 6000

/** What the client sends back: the ask it is answering, and the answer. */
type PostedAnswer = { question: string; answer?: string }

/**
 * Answers posted back for asks the agent made earlier. The client holds the whole askHuman
 * queue and sends it back, so an entry still blank is a state rather than a bad request; an
 * `answer` that is not a string is a bad request, because it would be stored and shown as
 * the candidate's own words. Only `question` and `answer` are read — `why` is the agent's
 * own reasoning, and the stored one stays authoritative.
 */
function readHumanAnswers(body: unknown): PostedAnswer[] | string {
  const raw = (body as Record<string, unknown> | null)?.humanAnswers
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return 'humanAnswers must be an array'

  const answers: PostedAnswer[] = []
  for (const entry of raw) {
    const record = entry as Record<string, unknown> | null
    const question = record?.question
    const answer = record?.answer
    if (typeof question !== 'string' || question === '') return 'each answer needs its question'
    if (answer !== undefined && typeof answer !== 'string') return 'an answer must be text'
    answers.push({ question, answer })
  }
  return answers
}

/** The stored asks with the human's answers filled in, matched on the question they answer. */
function merge(asked: AskHuman[], answers: PostedAnswer[]): AskHuman[] {
  return asked.map((ask) => {
    const answer = answers.find((a) => a.question === ask.question)?.answer
    return answer?.trim() ? { ...ask, answer } : ask
  })
}

/**
 * The positioning answers the client posts back. Each is keyed by the clarify question's id
 * — the same `c<n>` the clarify route stored — and carries the selected values (and/or a
 * free-text one) as an array. An id or question that is not a string is a bad request; the
 * answer must be a list of strings, since it is stored and fed to the draft as the candidate's
 * settled choice.
 */
function readClarifyAnswers(body: unknown): ClarifyAnswer[] | string {
  const raw = (body as Record<string, unknown> | null)?.clarifyAnswers
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return 'clarifyAnswers must be an array'

  const answers: ClarifyAnswer[] = []
  for (const entry of raw) {
    const record = entry as Record<string, unknown> | null
    const id = record?.id
    const question = record?.question
    const answer = record?.answer
    if (typeof id !== 'string' || id === '') return 'each clarify answer needs its id'
    if (typeof question !== 'string' || question === '') return 'each clarify answer needs its question'
    if (!Array.isArray(answer) || answer.some((v) => typeof v !== 'string')) {
      return 'a clarify answer must be a list of choices'
    }
    answers.push({ id, question, answer: answer as string[] })
  }
  return answers
}

/**
 * The stored positioning answers with this request's overlaid on top, keyed by id — a re-draft
 * that changes one choice replaces that one and leaves the rest. Insertion order is preserved,
 * so a replaced answer keeps its place and a genuinely new one is appended.
 */
function mergeClarify(stored: ClarifyAnswer[], posted: ClarifyAnswer[]): ClarifyAnswer[] {
  const byId = new Map(stored.map((a) => [a.id, a]))
  for (const a of posted) byId.set(a.id, a)
  return [...byId.values()]
}

/**
 * The candidate's own telling of what happened, posted alongside the draft request. Absent
 * means "unchanged" — whatever the question already carries still stands. An empty string is
 * how a person clears it. Anything that is not text is a bad request: it would be stored, fed
 * to the model as their words, and shown back to them as their words.
 */
function readStory(body: unknown): { story?: string } | string {
  const raw = (body as Record<string, unknown> | null)?.story
  if (raw === undefined) return {}
  if (typeof raw !== 'string') return 'a story must be text'
  return { story: raw }
}

const isAnswered = (ask: AskHuman) => Boolean(ask.answer?.trim())

/**
 * Still the same question, still asking for the same length. The text alone is not enough: a
 * re-parse can keep the wording and tighten the limit — 250 words down to 100 is an edit real
 * forms make — and this draft was written against the old limit and counted against the old
 * limit. Storing it under the new one would leave an over-limit draft that no guard ever
 * rejected and no error ever mentioned, which is the quietest way this product can be wrong.
 */
function sameQuestion(before: Question, after: Question | undefined): boolean {
  return (
    after !== undefined &&
    after.q === before.q &&
    after.constraints.limit === before.constraints.limit &&
    after.constraints.unit === before.constraints.unit
  )
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const body: unknown = await req.json().catch(() => null)
  const answers = readHumanAnswers(body)
  if (typeof answers === 'string') return Response.json({ error: answers }, { status: 400 })
  const clarifyAnswers = readClarifyAnswers(body)
  if (typeof clarifyAnswers === 'string') return Response.json({ error: clarifyAnswers }, { status: 400 })
  const posted = readStory(body)
  if (typeof posted === 'string') return Response.json({ error: posted }, { status: 400 })

  const { id, idx } = await ctx.params
  // A whole number and nothing else: `Number('1.5')` and `Number(' 1')` both come back as
  // usable numbers, and neither is an index into an array.
  if (!/^\d+$/.test(idx)) {
    return Response.json({ error: 'question index must be a whole number' }, { status: 400 })
  }
  const at = Number(idx)

  // Read before the model call as well as after it: this is the one flow whose INPUT is on
  // the record — the question itself — so it cannot be deferred. It also means a draft is
  // never a model call spent on an application that is not there, or not this user's.
  const before = await getApplication(user.uid, id)
  if (!before) return Response.json({ error: 'not found' }, { status: 404 })

  const asked = before.questions[at]
  if (!asked) return Response.json({ error: 'no question at that index' }, { status: 400 })
  // Rule 4 — what a per-profile answer may never do — is judged on `parsed.scope`. Drafting
  // without it is drafting with a hard rule switched off, so it is refused rather than run.
  if (!before.parsed) {
    return Response.json({ error: 'interpret the posting before drafting' }, { status: 400 })
  }

  // The telling this draft runs against: what was just posted, or — when the client sent
  // none — the one already on the question, so a re-draft keeps it.
  const story = posted.story ?? asked.story ?? ''
  // Learn it only when it is new. A re-draft posts the same words back every time, and running
  // them through the ingest again would fork one story into a second set of near-identical
  // facts, each with its own id, all citable.
  const isNewStory = story.trim() !== '' && story.trim() !== (asked.story ?? '').trim()

  let profile = await getProfile(user.uid)
  let storyLearned = false
  let newFacts = 0
  if (isNewStory) {
    // This is the task's whole point: the telling does not just steer one draft, it becomes
    // part of the profile — atomic facts whose sourceSnippets are the candidate's own words —
    // so the next question that needs it can cite it without being told again. Persisted
    // BEFORE the draft, and the draft then runs on the profile as it now stands, so the
    // citations it writes name ids that exist.
    try {
      const ingested = await runProfileIngest({ pastedText: story })
      // Re-read AFTER the ingest, not before it. setProfile replaces the whole document, and
      // the model spends around ten seconds in the line above — long enough for a profile
      // edit in another tab to land. Merging onto the copy read before that window would
      // write it straight back out, and the count would be off by whatever it reverted.
      const current: Profile = await getProfile(user.uid)
      const merged = mergeStory(current, ingested)
      await setProfile(user.uid, merged)
      newFacts = merged.facts.length - current.facts.length
      profile = merged
      storyLearned = true
    } catch (error) {
      // The model could not turn the story into facts. That is a failure to LEARN, and it is
      // not a reason to refuse to WRITE: the raw telling still reaches the prompt below and
      // still shapes the answer. The response says so, so the UI can stay quiet about a save
      // that did not happen rather than claiming one that did.
      if (!(error instanceof FlowOutputError)) throw error
    }
  }

  const askHuman = merge(asked.askHuman, answers)
  const answered = askHuman.filter(isAnswered)
  // Positioning is the human's input, not the model's — so it is composed from the stored set
  // plus this request's body, exactly as the asks are, and this is the set the draft is
  // generated against and the set that gets persisted.
  const positioning = mergeClarify(asked.clarifyAnswers ?? [], clarifyAnswers)

  let out: AnswerDraftOut
  try {
    out = await runAnswerDraft({
      question: { ...asked, askHuman },
      parsed: before.parsed,
      // The raw posting rule 8 matches against — truncated, since a long one blows the budget
      // and the screens it reasons from are near the top.
      jdText: before.jdRaw.slice(0, JD_LIMIT),
      facts: profile.facts,
      standardAnswers: profile.standardAnswers,
      // The rule text is what the model applies; the evidence behind each is what the profile
      // editor shows a human wondering where the rule came from.
      voiceRules: profile.voiceRules.map((r) => r.rule),
      humanAnswers: answered,
      clarifyAnswers: positioning,
      // Blank is sent as nothing at all, so the prompt drops the section rather than heading
      // an empty one.
      story: story || undefined,
    })
  } catch (error) {
    // The flow refused its own output: over the limit, or citing something that is not there.
    // Its message names the count, the limit and the offending span, and that message is the
    // only account of what went wrong — let it reach the wire as a 422 the UI can show, rather
    // than a 500 with the reason lost in a server log.
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, draftFailed: true }, { status: 422 })
    }
    throw error
  }

  // Read again after it. The model call takes seconds and the record can move underneath it,
  // and Firestore's update() replaces `questions` whole — composing the write from the stale
  // copy would revert anything that landed in the window. Same freshness as the parse route.
  const after = await getApplication(user.uid, id)
  if (!after) return Response.json({ error: 'not found' }, { status: 404 })
  // A re-parse replaces the question list wholesale (see the parse route), so the slot may
  // now hold a different question, or the same one asking for a different length. Filing this
  // answer under either would file an answer to something nobody asked, which is worse than
  // losing the draft.
  if (!sameQuestion(asked, after.questions[at])) {
    return Response.json({ error: 'questions changed while drafting' }, { status: 409 })
  }

  const drafted: Question = {
    // Spread from the fresh read, so a `final` the human saved keeps its place: re-drafting
    // moves the status back to 'drafted', it does not delete what they wrote.
    ...after.questions[at],
    // The positioning this draft was actually generated against — the pre-call stored set with
    // this request's body overlaid, not whatever the fresh read carries. Same reasoning as the
    // asks below: an answer that landed in the window belongs to a draft this one never saw.
    clarifyAnswers: positioning,
    // The telling this draft was written from, kept on the question so a re-draft — or coming
    // back to it tomorrow — still has it. Cleared when the person emptied the box.
    story: story || undefined,
    draft: { text: out.text, citations: out.citations },
    // The answered asks first — they are the human's, and they are why this draft says what
    // it says — then whatever the new draft still cannot answer. An ask the model repeated
    // despite being told the answer is dropped: two cards for one question, one of them
    // already answered, is a queue that reads as broken.
    //
    // Composed from the PRE-call read plus this request's body, not from the fresh read: this
    // is the queue the draft was actually generated against. An answer that landed in the
    // window belongs to a draft this one never saw. Deliberate, and left as it is.
    askHuman: [...answered, ...out.askHuman.filter((a) => !answered.some((x) => x.question === a.question))],
    status: 'drafted',
  }

  const questions = after.questions.map((q, i) => (i === at ? drafted : q))
  await updateApplication(user.uid, id, { questions } satisfies Partial<Application>)
  // The question, plus what the story did. `newFacts` and `storyLearned` are how the UI knows
  // whether to say "saved to your profile" and whether to re-read the fact bank so the new
  // citations resolve to something.
  return Response.json({ question: drafted, newFacts, storyLearned })
}
