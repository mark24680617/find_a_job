import type { Assignment, InterviewRound } from '@/lib/types'

/**
 * The decisions about a take-home's brief that hold on both sides of the wire: how long a brief
 * may be, how short is too short to plan from, how large a PDF may be, what address a public
 * link really points at, and — the one every surface reads — which text is the brief right now.
 *
 * Pure on purpose, and free of imports beyond a type: the assignment route, the plan route, the
 * round page and the live smoke all have to reach the same answer, and the round page is a
 * client component, so nothing here may reach for the fetcher, for Firestore or for a model.
 * The server half of reading a brief — the guarded fetch and its refusals — is
 * src/lib/readBrief.ts, which imports this file and is imported by nothing that renders.
 */

/**
 * The brief travels to the model as one prompt part and every quote in the guide is checked
 * against it, so it is capped where a long document stops being a brief and starts being a
 * repository dump. Over this the text is cut rather than refused: a brief that runs long is
 * still worth planning from, and the screen says it was cut.
 */
export const MAX_BRIEF_CHARS = 20_000

/**
 * Under this there is nothing to plan from — a one-line "the exercise is attached", or a login
 * wall read as a page. Refused with a reason, and the plan button says the same thing about a
 * notice this short rather than drawing a guide out of nothing.
 */
export const MIN_BRIEF_CHARS = 200

/** Bytes of PDF we will turn into base64 and post. Comfortably inside the model's inline limit. */
export const MAX_PDF_BYTES = 6 * 1024 * 1024

/**
 * The address a brief's link really points at, in text. Two hosts serve most of the documents
 * candidates are actually sent, and both hide the words behind an application: a Google Doc's
 * share link is a JavaScript shell, and GitHub's blob page wraps the file in a whole editor.
 * Both have a plain-text form at a predictable address, so this rewrite is the difference
 * between reading the brief and reading a page that says "Loading…". Everything else is handed
 * back exactly as it came in — including a published Google Doc, whose address names no
 * document to export, and a string that is no address at all, which the caller, not this
 * function, is the one placed to refuse.
 */
export function assignmentUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return raw
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname.split('/').filter(Boolean)

  // docs.google.com/document/d/{id}/anything → the same document, exported as plain text, and
  // with it the signed-in form docs.google.com/document/u/{n}/d/{id}/anything, which is what a
  // browser signed in to more than one account copies: the /u/{n}/ names the browser profile
  // that opened the document, not the document, so both export at the same address. The
  // trailing segment (/edit, /preview) and the query (?usp=sharing) are dropped: they say how a
  // browser should display it, and we are not a browser.
  //
  // The one Google Docs address left alone is the published one — docs.google.com/document/d/e/
  // {token}/pub, what "Publish to the web" hands out. The segment after /d/ is the letter `e`
  // and the token belongs to the publication rather than to the document, so exporting `e` as an
  // id asks for nobody's document and turns a link that works in a browser into a 404. Handed
  // back as it came, the /pub page is ordinary HTML and is read as text like any other page.
  if (host === 'docs.google.com') {
    const doc = /^\/document\/(?:u\/\d+\/)?d\/(?!e\/)([^/]+)/.exec(url.pathname)
    if (doc) return `https://docs.google.com/document/d/${doc[1]}/export?format=txt`
  }

  // github.com/{owner}/{repo}/blob/{ref}/{path…} → the raw file. The ref is the ONE segment
  // after `blob` and the rest is the path; from the address alone a branch named `feat/x` and a
  // branch `feat` holding a directory `x` are the same characters, and we do not try to tell
  // them apart. Nothing is lost by not trying: raw.githubusercontent.com takes {ref}/{path} in
  // exactly the same flat form and resolves it the same way github.com just did.
  if (host === 'github.com' && path[2] === 'blob' && path.length > 4) {
    const [owner, repo, , ref, ...file] = path
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file.join('/')}`
  }

  return raw
}

/**
 * A brief as it will be stored, sent or shown: trimmed, and cut at the cap with a flag saying
 * so. The flag travels with the text because a quote checked against a cut brief can only ever
 * fail honestly, and the screen has to be able to say why.
 */
export function cutBrief(text: string): { text: string; cut: boolean } {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_BRIEF_CHARS) return { text: trimmed, cut: false }
  return { text: trimmed.slice(0, MAX_BRIEF_CHARS), cut: true }
}

/** Which text is the brief, where it came from, and the identity a plan is pinned to. */
export interface BriefInUse {
  text: string
  /** `assignment.addedAt`, or `'notice'`. A plan drawn from one identity is stale under another. */
  identity: string
  cut: boolean
  source: 'notice' | Assignment['source']
}

/**
 * The one place that decides which text is the brief. A take-home often arrives as the email
 * itself, so until the candidate adds one the notice IS the brief; once they add one the stored
 * assignment wins and the notice stays exactly where it was. Everything that reads a brief —
 * the plan route, the round page, the smoke — reads it through here, so nobody can plan from
 * one text and check the quotes against another.
 *
 * `cut` is true when either the text was cut here or the stored assignment was already cut on
 * its way in. The route cuts before it stores, so `cutBrief` usually has nothing left to do to
 * an assignment; the question the screen is asking is "is the brief I am showing the whole
 * brief?", and for one cut before it was stored the answer is still no.
 */
export function briefInUse(round: Pick<InterviewRound, 'noticeRaw' | 'assignment'>): BriefInUse {
  const assignment = round.assignment
  const { text, cut } = cutBrief(assignment ? assignment.text : round.noticeRaw)
  return {
    text,
    identity: assignment ? assignment.addedAt : 'notice',
    cut: cut || (assignment?.cut ?? false),
    source: assignment ? assignment.source : 'notice',
  }
}

/**
 * Which of the round page's two take-home sections is working, if either. The assignment and the
 * plan are one record read two ways: a brief replaced while a plan is being drawn from the old
 * one would leave the guide quoting a text nobody has, and the plan route's 409 would refuse it
 * after the minute it cost. One piece of state above both sections is how each knows to wait for
 * the other — and the type belongs here, with the caps, because both components and the page
 * name it, and a type declared in any one of the three would put the other two in a ring around
 * it.
 */
export type SectionLock = 'reading' | 'planning' | null
