import { describe, it, expect } from 'vitest'
import {
  MAX_BRIEF_CHARS,
  MAX_PDF_BYTES,
  MIN_BRIEF_CHARS,
  assignmentUrl,
  briefInUse,
  cutBrief,
} from '@/lib/assignment'
import type { Assignment, InterviewRound } from '@/lib/types'

// The pure decisions a take-home's brief rests on. Each is a place where being wrong is
// invisible on screen: a share link read as the JavaScript shell around a document rather than
// the document, a plan drawn from one text and its quotes checked against another, a brief cut
// at the cap with nothing on the page saying so.

const round = (over: Partial<InterviewRound> = {}): InterviewRound => ({
  id: 'r1',
  noticeRaw: '',
  roundType: 'take-home',
  people: [],
  chat: [],
  createdAt: '2026-09-05T00:00:00.000Z',
  ...over,
})
const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  text: 'Build a small service that reconciles two ledgers.',
  source: 'pasted',
  addedAt: '2026-09-05T10:00:00.000Z',
  cut: false,
  ...over,
})

describe('assignmentUrl', () => {
  it('rewrites a Google Doc to its plain-text export, whatever the share link ends in', () => {
    expect(assignmentUrl('https://docs.google.com/document/d/1AbC_dEf/edit?usp=sharing')).toBe(
      'https://docs.google.com/document/d/1AbC_dEf/export?format=txt',
    )
    expect(assignmentUrl('https://docs.google.com/document/d/1AbC_dEf/preview')).toBe(
      'https://docs.google.com/document/d/1AbC_dEf/export?format=txt',
    )
    // No trailing segment and no query at all — the bare document address.
    expect(assignmentUrl('https://docs.google.com/document/d/1AbC_dEf')).toBe(
      'https://docs.google.com/document/d/1AbC_dEf/export?format=txt',
    )
  })

  it('rewrites the signed-in Google Doc address too, account number and all', () => {
    // A link copied out of a browser signed in to more than one account carries the account in
    // it. It is the same document — the /u/{n}/ says which browser profile opened it — so it
    // exports at the same address as the plain form.
    expect(
      assignmentUrl('https://docs.google.com/document/u/1/d/1AbC_dEf/edit?usp=sharing'),
    ).toBe('https://docs.google.com/document/d/1AbC_dEf/export?format=txt')
    expect(assignmentUrl('https://docs.google.com/document/u/0/d/1AbC_dEf')).toBe(
      'https://docs.google.com/document/d/1AbC_dEf/export?format=txt',
    )
  })

  it('leaves a published Google Doc where it is — the segment after /d/ is not an id', () => {
    // "Publish to the web" hands out docs.google.com/document/d/e/{token}/pub, where what sits
    // after /d/ is the letter `e` and the token belongs to the publication rather than to the
    // document. Read as an id, `e` exports nobody's document and a link that works in a browser
    // comes back a 404. Left exactly as pasted, the /pub page is ordinary HTML and reads as text.
    const published = 'https://docs.google.com/document/d/e/2PACX-1vQb9TokEn/pub'
    expect(assignmentUrl(published)).toBe(published)
  })

  it('rewrites a GitHub blob to the raw file, keeping the path under it', () => {
    expect(assignmentUrl('https://github.com/acme/take-home/blob/main/docs/BRIEF.md')).toBe(
      'https://raw.githubusercontent.com/acme/take-home/main/docs/BRIEF.md',
    )
  })

  it('takes the ref as the single segment after blob, which is what raw addresses assume too', () => {
    // From the address alone `blob/feat/x/README.md` is a branch `feat` holding `x/README.md`
    // as readily as a branch `feat/x` holding `README.md`, and we do not try to tell them
    // apart: the ref is the one segment after `blob` and the rest is the path. It costs
    // nothing, because raw.githubusercontent.com takes {ref}/{path} in the same flat form and
    // resolves the ambiguity the same way github.com just did.
    expect(assignmentUrl('https://github.com/acme/take-home/blob/feat/x/README.md')).toBe(
      'https://raw.githubusercontent.com/acme/take-home/feat/x/README.md',
    )
  })

  it('reads a leading www. off the host before matching it', () => {
    expect(assignmentUrl('https://www.github.com/acme/take-home/blob/main/BRIEF.md')).toBe(
      'https://raw.githubusercontent.com/acme/take-home/main/BRIEF.md',
    )
  })

  it('hands back everything else exactly as given, a non-address included', () => {
    for (const raw of [
      'https://example.com/take-home',
      // A gist is a different host and a different raw scheme; left alone rather than guessed at.
      'https://gist.github.com/acme/abc123',
      // A repository, not a file: there is nothing under blob to raw.
      'https://github.com/acme/take-home',
      'https://github.com/acme/take-home/blob/main',
      // A Sheet, not a Doc — /export?format=txt is not a thing there.
      'https://docs.google.com/spreadsheets/d/1AbC/edit',
      'not a web address at all',
      '',
    ]) {
      expect(assignmentUrl(raw)).toBe(raw)
    }
  })
})

describe('cutBrief', () => {
  it('trims, and says nothing was cut', () => {
    expect(cutBrief('  Build a service.  ')).toStrictEqual({
      text: 'Build a service.',
      cut: false,
    })
  })

  it('leaves a brief exactly at the cap whole', () => {
    const exact = 'x'.repeat(MAX_BRIEF_CHARS)
    expect(cutBrief(exact)).toStrictEqual({ text: exact, cut: false })
  })

  it('cuts at the cap, and says so', () => {
    const out = cutBrief('x'.repeat(MAX_BRIEF_CHARS + 1))
    expect(out.text).toHaveLength(MAX_BRIEF_CHARS)
    expect(out.cut).toBe(true)
  })

  it('trims before it measures, so trailing whitespace never costs a brief its tail', () => {
    expect(cutBrief(`${'x'.repeat(MAX_BRIEF_CHARS)}   \n`)).toStrictEqual({
      text: 'x'.repeat(MAX_BRIEF_CHARS),
      cut: false,
    })
  })
})

describe('briefInUse', () => {
  it('is the notice until an assignment is added, and says that is what it is', () => {
    expect(briefInUse(round({ noticeRaw: '  Your take-home is attached.  ' }))).toStrictEqual({
      text: 'Your take-home is attached.',
      identity: 'notice',
      cut: false,
      source: 'notice',
    })
  })

  it('is the stored assignment once there is one, identified by when it was added', () => {
    const stored = assignment({ source: 'url', url: 'https://example.com/brief' })
    const out = briefInUse(round({ noticeRaw: 'Your take-home is attached.', assignment: stored }))
    expect(out).toStrictEqual({
      text: 'Build a small service that reconciles two ledgers.',
      identity: '2026-09-05T10:00:00.000Z',
      cut: false,
      source: 'url',
    })
  })

  it('cuts a notice too long to be a brief, and keeps calling it the notice', () => {
    const out = briefInUse(round({ noticeRaw: 'x'.repeat(MAX_BRIEF_CHARS + 500) }))
    expect(out.text).toHaveLength(MAX_BRIEF_CHARS)
    expect(out.cut).toBe(true)
    expect(out.identity).toBe('notice')
    expect(out.source).toBe('notice')
  })

  it('keeps a stored brief’s own cut flag — it was cut on the way in, not here', () => {
    // The route cuts before it stores, so the text arriving here is already inside the cap and
    // `cutBrief` has nothing left to do. The question the screen asks is "is the brief I am
    // showing the whole brief?", and for a brief cut on its way in the answer is still no.
    const out = briefInUse(round({ assignment: assignment({ cut: true }) }))
    expect(out.cut).toBe(true)
    expect(out.text).toBe('Build a small service that reconciles two ledgers.')
  })

  it('cuts a stored brief that is over the cap anyway', () => {
    const out = briefInUse(
      round({ assignment: assignment({ text: 'y'.repeat(MAX_BRIEF_CHARS + 1) }) }),
    )
    expect(out.text).toHaveLength(MAX_BRIEF_CHARS)
    expect(out.cut).toBe(true)
  })
})

describe('the caps', () => {
  it('are the numbers the assignment route, the plan button and the file input enforce', () => {
    expect(MAX_BRIEF_CHARS).toBe(20_000)
    expect(MIN_BRIEF_CHARS).toBe(200)
    expect(MAX_PDF_BYTES).toBe(6 * 1024 * 1024)
  })
})
