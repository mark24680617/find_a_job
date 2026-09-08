import { describe, it, expect } from 'vitest'
import { statusChange } from '@/components/board/PipelineBoard'
import { logInterviewPatch, pastApplying, showsProcess } from '@/lib/stage'
import type { AppStatus, Application } from '@/lib/types'

// The three decisions the application screen makes about where a record has got to. They live
// in a module of their own so each of the five statuses can be read here rather than inferred
// from a rendered page: what the screen draws changes with the stage, and a wrong answer here
// is a section that appears where it should not or a record dragged backwards.

const ALL: AppStatus[] = ['draft', 'applied', 'interviewing', 'offer', 'rejected']

// A whole record, though the module only reads two fields of one: the board's `statusChange`
// takes an Application, and the two are compared below.
const app = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Nectir',
  role: 'Founding Engineer',
  jdRaw: '',
  adapter: 'manual',
  questions: [],
  status: 'draft',
  timeline: [{ event: 'created', at: '2026-08-20T09:00:00.000Z' }],
  createdAt: '2026-08-20T09:00:00.000Z',
  ...over,
})

describe('pastApplying', () => {
  it('is true from the interview stage on, since the answers have been sent by then', () => {
    expect(ALL.filter(pastApplying)).toEqual(['interviewing', 'offer', 'rejected'])
  })
})

describe('showsProcess', () => {
  it('is true only while the loop is being run', () => {
    // A draft has no loop yet; an offer and a rejection are past it. "What to expect" is
    // research about what is coming, so it is drawn only when something is.
    expect(ALL.filter(showsProcess)).toEqual(['interviewing'])
  })
})

describe('logInterviewPatch', () => {
  it('moves a draft or an applied record, writing the board’s own event', () => {
    const patch = logInterviewPatch(app({ status: 'applied' }), '2026-09-07T12:00:00.000Z')

    expect(patch).toEqual({
      status: 'interviewing',
      timeline: [
        { event: 'created', at: '2026-08-20T09:00:00.000Z' },
        { event: 'status → interviewing', at: '2026-09-07T12:00:00.000Z' },
      ],
    })
    expect(logInterviewPatch(app({ status: 'draft' }), '2026-09-07T12:00:00.000Z')).toEqual(patch)
  })

  it('writes the very patch the board writes, so one move has one history', () => {
    // The wording is typed out in both places — this module stays free of component imports,
    // so it cannot call `statusChange` — and two copies drift the moment one is edited. This
    // is what holds them together: change either wording and this fails, rather than the two
    // surfaces quietly recording the same move in two different words.
    const a = app({ status: 'applied' })
    expect(logInterviewPatch(a, '2026-09-07T12:00:00.000Z')).toEqual(
      statusChange(a, 'interviewing', '2026-09-07T12:00:00.000Z'),
    )
  })

  it('leaves the record’s own timeline alone', () => {
    const a = app()
    logInterviewPatch(a, '2026-09-07T12:00:00.000Z')
    expect(a.timeline).toHaveLength(1)
  })

  it('has nothing to move for a record already there, or past it', () => {
    // Offer and rejected are the ends of the line: logging a round against one of them must
    // never drag it back to Interviewing.
    expect(logInterviewPatch(app({ status: 'interviewing' }))).toBeNull()
    expect(logInterviewPatch(app({ status: 'offer' }))).toBeNull()
    expect(logInterviewPatch(app({ status: 'rejected' }))).toBeNull()
  })

  it('stamps the moment it is given', () => {
    const patch = logInterviewPatch(app(), '2026-01-02T03:04:05.678Z')
    expect(patch?.timeline.at(-1)?.at).toBe('2026-01-02T03:04:05.678Z')
  })
})
