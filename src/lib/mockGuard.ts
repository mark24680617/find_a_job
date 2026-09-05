import type { MockDebriefOut, MockTurnOut } from '@/ai/schemas'
import type { ReportedQuestion } from '@/lib/practice'
import { normalizeWs, QUOTE_CAP } from '@/lib/research/quotes'
import type { Fact, MockTurn, PracticeMode } from '@/lib/types'

/**
 * What the mock may not do, settled in code after the model has done its part — the same
 * discipline as the brief's citation guard. Three things are asked for in the prompts and are
 * properties of the record here: the interviewer cites a reported question only when it asked
 * it, the debrief quotes the candidate only from what they typed, and a rehearsal line is one
 * of their own claims and nothing else. Nothing retries. A dropped citation or a dropped quote
 * costs the candidate one line; a retry would cost them the session.
 *
 * Every comparison normalises both sides. The haystack is model prose that wraps where it
 * likes or, in coding mode, the candidate's code with its own line breaks, and the needle
 * never keeps them where the haystack has them.
 */

/**
 * The candidate's turns, normalised, each kept apart — the only text a quote of theirs may come
 * from, and one turn is as far as a quote may reach. Joined, the end of one answer and the start
 * of the next make a sentence they never said.
 */
function candidateTurns(transcript: MockTurn[]): string[] {
  return transcript.filter((turn) => turn.role === 'user').map((turn) => normalizeWs(turn.text))
}

/**
 * The questions the candidate actually answered, in the order they were asked — one entry each,
 * so the count is the length and the i-th of them is the heading of the i-th entry. A follow-up
 * is not a question of its own — what was said in answer to it belongs to the question it
 * followed — and a question the mock ended on was never answered, so the debrief gets no entry
 * for it.
 */
export function answeredQuestionTexts(transcript: MockTurn[]): string[] {
  const answered: string[] = []
  let waiting: string[] = []
  for (const turn of transcript) {
    if (turn.role === 'user') {
      answered.push(...waiting)
      waiting = []
    } else if (turn.kind === 'question') waiting.push(turn.text)
  }
  return answered
}

/**
 * A citation the screen shows as "reported by …" must name a source we handed over, and the
 * question that source reported must be in the turn as asked. Substring rather than equality:
 * an interviewer says "To start: {question}" and that is still the question, word for word.
 * Otherwise the citation goes and the question stays — it is still worth asking; a citation
 * nobody can check is the one thing the screen may not show.
 *
 * A follow-up on a follow-up becomes a question. "Follow up once" is a property of the record,
 * not a request, and it is what keeps the six-question count moving.
 */
export function guardTurn(
  turn: MockTurnOut,
  reported: ReportedQuestion[],
  previousModelTurn: MockTurn | undefined,
): MockTurnOut {
  const say = normalizeWs(turn.say)
  const cited =
    turn.sourceId !== null &&
    reported.some((r) => r.sourceId === turn.sourceId && say.includes(normalizeWs(r.text)))
  return {
    ...turn,
    sourceId: cited ? turn.sourceId : null,
    kind:
      turn.kind === 'follow-up' && previousModelTurn?.kind === 'follow-up' ? 'question' : turn.kind,
  }
}

/**
 * The debrief's rules. `said` is quoted back to the candidate in their own words on the
 * product's amber and is the one piece of model output here with a path into their fact bank,
 * so it has to be theirs: what is not inside a single one of their turns is dropped, and so is
 * an empty quote, which every text contains, and one longer than a quote is allowed to be —
 * `QUOTE_CAP` is the same line `verifyQuotes` holds, and an answer may run to twelve thousand
 * characters. Per turn rather than against the whole transcript joined: a sentence that starts
 * in one answer and ends in the next is words of theirs in an order they never used, and a real
 * answer is submitted whole, so nothing legitimate spans two.
 *
 * Each entry's heading is replaced with the question that was actually asked, in the same order
 * the entries are counted in. It is the one quoted-looking string on this screen the model could
 * otherwise paraphrase, and everything else here is checked against the record.
 *
 * `rehearse` is filtered the way the brief's `factsToRehearse` is — a line that is not one of
 * their claims is a sentence the model wrote for them to say out loud in an interview. `code`
 * outside a coding round is feedback on a box that never existed. And the entries are cut to the
 * questions an answer followed: the model is told not to write an entry for a question the mock
 * ended on, and this is where that stops being a request. A debrief with nothing left in
 * `answers` is still a debrief.
 */
export function guardDebrief(
  debrief: MockDebriefOut,
  transcript: MockTurn[],
  facts: Fact[],
  mode: PracticeMode,
): MockDebriefOut {
  const spoken = candidateTurns(transcript)
  const asked = answeredQuestionTexts(transcript)
  const claims = new Set(facts.map((fact) => normalizeWs(fact.claim)))
  return {
    ...debrief,
    answers: debrief.answers.slice(0, asked.length).map((answer, i) => ({
      ...answer,
      question: asked[i],
      unsupported: answer.unsupported.filter((item) => {
        const quote = normalizeWs(item.said)
        return quote !== '' && quote.length <= QUOTE_CAP && spoken.some((turn) => turn.includes(quote))
      }),
    })),
    code: mode === 'coding' ? debrief.code : null,
    rehearse: debrief.rehearse.filter((line) => claims.has(normalizeWs(line))),
  }
}
