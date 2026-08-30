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
  parsed?: ParsedJob; questions: Question[]
  status: AppStatus; timeline: TimelineEvent[]; createdAt: string
}
export type RoundType = 'recruiter-screen' | 'technical' | 'behavioral' | 'panel' | 'onsite' | 'other'
export interface PrepBrief {
  likelyTopics: string[]; questionsToPrepare: { q: string; angle: string }[]
  questionsToAsk: string[]; factsToRehearse: string[]; redFlags: string[]
}
export interface InterviewRound {
  id: string; noticeRaw: string; roundType: RoundType; datetime?: string
  people: string[]; prepBrief?: PrepBrief
  askHuman?: AskHuman[]  // what the notice didn't say; display-only, and it survives a reload
  chat: { role: 'user' | 'model'; text: string }[]
  createdAt: string
}
