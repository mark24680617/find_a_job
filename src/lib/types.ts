export interface Fact { id: string; claim: string; sourceSnippet: string; tags: string[] }
export interface VoiceRule { rule: string; evidence: string; createdAt: string }
export interface Profile {
  facts: Fact[]; standardAnswers: Record<string, string>
  voiceRules: VoiceRule[]; gaps: string[]
}
export type AppStatus = 'draft' | 'applied' | 'interviewing' | 'offer' | 'rejected'
export type GatePosture = 'escape-clause' | 'silent' | 'explicit'
export interface Gate { requirement: string; met: 'yes' | 'no' | 'unclear'; posture: GatePosture; note: string }
export type ArtifactScope = 'per-application' | 'per-profile' | 'unknown'
export interface ParsedJob {
  company: string; role: string; roleFacts: string[]
  gates: Gate[]; themes: string[]; scope: ArtifactScope
  advisory: string   // apply-or-skip advisory when a gate is unmet, else ''
}
export interface Citation { claimSpan: string; factId: string }
export interface AskHuman { question: string; why: string; answer?: string }
export interface ClarifyOption { label: string; value: string }
export interface ClarifyQuestion {
  id: string; question: string; why: string
  options: ClarifyOption[]; recommended: string
  allowMultiple: boolean; allowOther: boolean
}
export interface ClarifyAnswer { id: string; question: string; answer: string[] } // selected values and/or one free-text

// A reconcile changeset: what one fresh extraction proposes doing to the fact bank. Nothing in
// it is stored until the candidate accepts it, and `skips` exists so that every extracted claim
// is accounted for on screen rather than quietly discarded.
export interface FactAdd { claim: string; sourceSnippet: string; tags: string[] }        // a fact the bank does not hold
export interface FactUpdate { id: string; claim: string; tags: string[] }                 // a revision of the fact at `id`
export interface FactSkip { id?: string; reason: string }                                 // already known, and why
export interface Changeset { adds: FactAdd[]; updates: FactUpdate[]; skips: FactSkip[] }
export interface QConstraints { limit?: number; unit?: 'words' | 'chars'; type: 'short-text' | 'long-text' | 'select' | 'file'; required: boolean }
export interface Question {
  q: string; constraints: QConstraints
  draft?: { text: string; citations: Citation[] }
  askHuman: AskHuman[]; final?: string
  clarify?: ClarifyQuestion[]; clarifyAnswers?: ClarifyAnswer[]
  story?: string     // the candidate's own telling behind this answer, in their words
  status: 'pending' | 'drafted' | 'final'
}
export interface TimelineEvent { event: string; at: string }
export interface Application {
  id: string; company: string; role: string; jdRaw: string
  sourceUrl?: string; adapter: string
  parsed?: ParsedJob; process?: ProcessMap; questions: Question[]
  status: AppStatus; timeline: TimelineEvent[]; createdAt: string
}
// RoundType gains 'system-design'. Without it a system-design notice is typed 'technical' and
// can never claim the map's system-design stage, and the design practice mode never happens.
export type RoundType =
  | 'recruiter-screen' | 'technical' | 'system-design' | 'behavioral' | 'panel' | 'onsite' | 'other'

export interface PrepBrief {
  likelyTopics: string[]
  // sourceId is present only when `q` is a question a guide reported, copied verbatim.
  questionsToPrepare: { q: string; angle: string; sourceId?: string }[]
  questionsToAsk: string[]; factsToRehearse: string[]; redFlags: string[]
  // Present when the brief was written with the map. stageOrder is null when the map existed
  // but the round was not on the reported loop. Set by the route, never by the model.
  basis?: { stageOrder: number | null; researchedAt: string }
}

// ── The mock round ───────────────────────────────────────────────────────────────────────
// One practice interview against one logged round: an interviewer for that stage, the
// candidate's own answers, and a debrief that reads them back. Nothing here is written about
// the candidate that is not one of their facts or one of their sentences — the prompts ask
// for that and `src/lib/mockGuard.ts` makes it a property of the record.

export type PracticeMode = 'coding' | 'design' | 'conversation'

export interface MockTurn {
  role: 'user' | 'model'
  text: string
  // Model turns only. `sourceId` when the turn asks a reported question verbatim.
  kind?: 'question' | 'follow-up' | 'closing'
  sourceId?: string
  at: string                 // ISO
}

export interface MockDebrief {
  overall: string
  answers: {
    question: string
    landed: string[]
    vague: string[]
    // `said` is a verbatim sentence of the candidate's; `added` once it has reached the bank.
    unsupported: { said: string; why: string; added?: boolean }[]
  }[]
  code?: { strengths: string[]; gaps: string[] }   // coding mode only
  rehearse: string[]                               // fact claims, verbatim — filtered in code
  factsChecked: number                             // how many facts the bank held at the debrief
}

export interface MockSession {
  mode: PracticeMode
  // The stage the session was started against, and the map it was read from. Absent when the
  // round is not on the loop or there is no map. Frozen here so that a round logged mid-mock,
  // or a re-run of the research, cannot move the stage under an open session.
  stageOrder?: number
  researchedAt?: string
  startedAt: string          // ISO; also the session token every later action must carry
  questionsAsked: number
  status: 'open' | 'debriefed'
  debrief?: MockDebrief
  debriefedAt?: string
  // Questions asked in earlier sessions of this round, so "Start over" gets different ones.
  previousQuestions: string[]
}

export interface InterviewRound {
  id: string; noticeRaw: string; roundType: RoundType; datetime?: string
  people: string[]; prepBrief?: PrepBrief
  askHuman?: AskHuman[]  // what the notice didn't say; display-only, and it survives a reload
  chat: MockTurn[]       // the transcript of the current or most recent session; only `start` clears it
  mock?: MockSession
  createdAt: string
}

// How much one account holds — what the account page shows its owner and the admin table
// shows the administrator. Counted, never listed: the panel does not read anyone's data.
export interface Usage { applications: number; facts: number }
// One row of the admin table. Dates are ISO on the wire (Firebase's own metadata strings are
// not); `lastSignInAt` is null for an account that was created but never signed in.
export interface AdminUser {
  uid: string; email: string; emailVerified: boolean; displayName: string
  provider: string          // 'google.com' | 'password' | anything else, verbatim; '' for none
  createdAt: string; lastSignInAt: string | null
  disabled: boolean; applications: number; facts: number
}

// ── The interview process map ────────────────────────────────────────────────────────────
// How one company runs its loop for one role, drawn from sources we can name. Stored on the
// application; generated on demand. Nothing in it was written without a source except what
// is marked as inferred, and the sources themselves are never the model's to invent.
export type StageKind =
  | 'recruiter-screen' | 'technical' | 'system-design' | 'behavioral' | 'panel' | 'onsite'
  | 'take-home' | 'other'
export type StageFormat = 'call' | 'video' | 'onsite' | 'async' | 'unknown'
export type Confidence = 'posting' | 'community' | 'inferred'
export interface ResearchSource {
  id: string; title: string; url: string; host: string
  kind: 'posting' | 'company' | 'community' | 'guide'
  snippet: string; publishedAt?: string; fetched: boolean
}
export interface ProcessStage {
  order: number; name: string; kind: StageKind; format: StageFormat; duration?: string
  whatItProbes: string; tips: string[]; sourceIds: string[]; confidence: Confidence
}
export interface TakeHome {
  present: 'yes' | 'no' | 'unknown'; description: string; timeBudget?: string
  tips: string[]; sourceIds: string[]
}
export interface CommunityGuide {
  sourceId: string; takeaways: string[]; questionsReported: string[]; quotes: string[]
  stale: boolean            // dated, and more than ~2 years before researchedAt
  firstHand: boolean        // somebody's own account, or the company's — not a prep site's
}
export interface ProcessMap {
  stages: ProcessStage[]; takeHome: TakeHome; timeline?: string
  sources: ResearchSource[]; guides: CommunityGuide[]
  askRecruiter: string[]; caveats: string[]; grounded: boolean; researchedAt: string
}
