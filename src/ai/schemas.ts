/**
 * Output schemas for every flow. Genkit validates the model's response against these
 * before a flow ever sees it, so they are the boundary between "a model said something"
 * and "the app has data". Each mirrors a `src/lib/types.ts` interface — the SchemaGuards
 * block at the bottom fails the build if the two drift apart.
 *
 * `z` comes from 'genkit', not 'zod': Genkit re-exports its own zod instance and schemas
 * built with a second copy would not validate. See docs/notes/deps.md.
 */
import { z } from 'genkit'
import type {
  ArtifactScope,
  Changeset,
  Citation,
  ClarifyOption,
  ClarifyQuestion,
  Fact,
  FactAdd,
  FactSkip,
  FactUpdate,
  ParsedJob,
  PrepBrief,
  Profile,
  QConstraints,
  Question,
  RoundType,
  VoiceRule,
} from '@/lib/types'

/** A question only the candidate can answer — never guessed, always asked. */
const AskHumanSchema = z.object({ question: z.string(), why: z.string() })

const ArtifactScopeSchema = z.enum(['per-application', 'per-profile', 'unknown'])

const RoundTypeSchema = z.enum([
  'recruiter-screen',
  'technical',
  'behavioral',
  'panel',
  'onsite',
  'other',
])

/**
 * Enforced, not merely documented: a model left to itself returns "fact-1", and the ids
 * have to match the `f<n>` sequence the profile merge allocates. Shared by facts and by
 * the citations that key into them — a citation naming a shape no fact can have is dead.
 * The message is the point: the retry shows it to the model, and "Invalid" teaches nothing.
 */
const factId = z.string().regex(/^f\d+$/, 'must be f<n>, e.g. f1')

const FactSchema = z.object({
  id: factId,
  claim: z.string(),
  sourceSnippet: z.string(),
  tags: z.array(z.string()),
})

const QConstraintsSchema = z.object({
  limit: z.number().optional(),
  unit: z.enum(['words', 'chars']).optional(),
  type: z.enum(['short-text', 'long-text', 'select', 'file']),
  required: z.boolean(),
})

const CitationSchema = z.object({ claimSpan: z.string(), factId })

/**
 * Enforced like `factId`: the flow that persists a clarify answer keys it back by this id,
 * and the prompt is told to number the questions `c1`..`cN`, so a model that returns
 * "question-1" would break the round-trip. The message is what the retry sees.
 */
const clarifyId = z.string().regex(/^c\d+$/, 'must be c<n>, e.g. c1')

const ClarifyOptionSchema = z.object({ label: z.string(), value: z.string() })

/**
 * A single positioning question. `question` and `why` are non-empty because a blank one is
 * a card the UI cannot render; `options` is 2-4 because one option is not a choice and more
 * than four is not a decision a person makes quickly. That `recommended` names one of the
 * option values is not a shape the schema can see — it is checked in the flow.
 */
const ClarifyQuestionSchema = z.object({
  id: clarifyId,
  question: z.string().min(1),
  why: z.string().min(1),
  options: z.array(ClarifyOptionSchema).min(2).max(4),
  recommended: z.string(),
  allowMultiple: z.boolean(),
  allowOther: z.boolean(),
})

const GateSchema = z.object({
  requirement: z.string(),
  met: z.enum(['yes', 'no', 'unclear']),
  posture: z.enum(['escape-clause', 'silent', 'explicit']),
  note: z.string(),
})

/** profileIngest: resume/notes in, cited facts out. Fact ids MUST be `f1`..`fN`. */
export const ProfileIngestOutSchema = z.object({
  facts: z.array(FactSchema),
  standardAnswers: z.record(z.string()),
  gaps: z.array(z.string()),
})

/** jobInterpret: a job description in, the parsed posting out. */
export const JobInterpretOutSchema = z.object({
  company: z.string(),
  role: z.string(),
  roleFacts: z.array(z.string()),
  gates: z.array(GateSchema),
  themes: z.array(z.string()),
  scope: ArtifactScopeSchema,
  advisory: z.string(),
})

/** formParse: an application form in, its questions and artifact scope out. */
export const FormParseOutSchema = z.object({
  questions: z.array(z.object({ q: z.string(), constraints: QConstraintsSchema })),
  scope: ArtifactScopeSchema,
  scopeEvidence: z.string(),
})

/** answerDraft: one question in, a cited draft out (plus what it could not answer). */
export const AnswerDraftOutSchema = z.object({
  text: z.string(),
  citations: z.array(CitationSchema),
  askHuman: z.array(AskHumanSchema),
})

/**
 * clarifyDraft: one question plus the posting and facts in, at most four positioning
 * questions out — or none, when the facts already settle the answer.
 */
export const ClarifyDraftOutSchema = z.object({
  questions: z.array(ClarifyQuestionSchema).max(4),
})

/**
 * reconcileFacts: the fact bank plus a fresh extraction in, the smallest honest changeset out.
 *
 * An `add` is a fact minus its id — the id is the bank's to allocate, and a model that named one
 * would be naming a row it cannot see. `updates` and `skips` DO carry ids, because they point at
 * facts that already exist; that the id points at a real one is not a shape, so the route checks
 * it against the live bank rather than the schema pretending to.
 *
 * A skip's id is optional: an extracted claim can be already-covered by the profile as a whole
 * without duplicating one particular row, and a model forced to name a row would invent one.
 * The reason never is — a skip without a reason is exactly the silent drop this step exists to
 * prevent.
 */
export const ReconcileOutSchema = z.object({
  adds: z.array(
    z.object({
      claim: z.string().min(1),
      sourceSnippet: z.string(),
      tags: z.array(z.string()),
    }),
  ),
  updates: z.array(
    z.object({ id: factId, claim: z.string().min(1), tags: z.array(z.string()) }),
  ),
  skips: z.array(z.object({ id: factId.optional(), reason: z.string().min(1) })),
  questions: z.array(ClarifyQuestionSchema).max(4),
})

/** feedbackDistill: an edit in, at most three durable voice rules out. */
export const FeedbackDistillOutSchema = z.object({
  rules: z.array(z.object({ rule: z.string(), evidence: z.string() })).max(3),
})

/** interviewInterpret: an interview notice in, the round's facts out. */
export const InterviewInterpretOutSchema = z.object({
  roundType: RoundTypeSchema,
  // Nullable, not optional: an unknown date must be stated, not silently omitted.
  datetime: z.string().nullable(),
  people: z.array(z.string()),
  askHuman: z.array(AskHumanSchema),
})

/** prepBrief: role + profile in, the interview prep brief out. */
export const PrepBriefOutSchema = z.object({
  likelyTopics: z.array(z.string()),
  questionsToPrepare: z.array(z.object({ q: z.string(), angle: z.string() })),
  questionsToAsk: z.array(z.string()),
  factsToRehearse: z.array(z.string()),
  redFlags: z.array(z.string()),
})

export type ProfileIngestOut = z.infer<typeof ProfileIngestOutSchema>
export type JobInterpretOut = z.infer<typeof JobInterpretOutSchema>
export type FormParseOut = z.infer<typeof FormParseOutSchema>
export type AnswerDraftOut = z.infer<typeof AnswerDraftOutSchema>
export type ClarifyDraftOut = z.infer<typeof ClarifyDraftOutSchema>
export type ReconcileOut = z.infer<typeof ReconcileOutSchema>
export type FeedbackDistillOut = z.infer<typeof FeedbackDistillOutSchema>
export type InterviewInterpretOut = z.infer<typeof InterviewInterpretOutSchema>
export type PrepBriefOut = z.infer<typeof PrepBriefOutSchema>

/** `true` only when the two types are assignable in both directions. */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
/** Anything but `true` here is a compile error, which is the whole point. */
type Assert<T extends true> = T

/**
 * Compile-time only — no runtime cost. Exported so it is never "unused"; nothing should
 * import it. A flow output is often a slice of a stored type (the db stamps `createdAt`,
 * the UI adds `status`), so each check names the exact slice it must match.
 */
export type SchemaGuards = [
  Assert<Mutual<ProfileIngestOut, Omit<Profile, 'voiceRules'>>>,
  Assert<Mutual<ProfileIngestOut['facts'][number], Fact>>,
  Assert<Mutual<JobInterpretOut, ParsedJob>>,
  Assert<Mutual<FormParseOut['questions'][number], Pick<Question, 'q' | 'constraints'>>>,
  Assert<Mutual<FormParseOut['questions'][number]['constraints'], QConstraints>>,
  Assert<Mutual<FormParseOut['scope'], ArtifactScope>>,
  Assert<Mutual<Pick<AnswerDraftOut, 'text' | 'citations'>, NonNullable<Question['draft']>>>,
  Assert<Mutual<AnswerDraftOut['citations'][number], Citation>>,
  Assert<Mutual<AnswerDraftOut['askHuman'][number], Question['askHuman'][number]>>,
  Assert<Mutual<ClarifyDraftOut['questions'][number], ClarifyQuestion>>,
  Assert<Mutual<ClarifyDraftOut['questions'][number]['options'][number], ClarifyOption>>,
  Assert<Mutual<Omit<ReconcileOut, 'questions'>, Changeset>>,
  Assert<Mutual<ReconcileOut['adds'][number], FactAdd>>,
  Assert<Mutual<ReconcileOut['updates'][number], FactUpdate>>,
  Assert<Mutual<ReconcileOut['skips'][number], FactSkip>>,
  Assert<Mutual<ReconcileOut['questions'][number], ClarifyQuestion>>,
  Assert<Mutual<FeedbackDistillOut['rules'][number], Omit<VoiceRule, 'createdAt'>>>,
  Assert<Mutual<InterviewInterpretOut['roundType'], RoundType>>,
  Assert<Mutual<InterviewInterpretOut['askHuman'][number], Question['askHuman'][number]>>,
  Assert<Mutual<PrepBriefOut, PrepBrief>>,
]
