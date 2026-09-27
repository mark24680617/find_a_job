/**
 * What the judge is given to judge: one bullet, and the role and company it sits under.
 *
 * Nothing else goes in. Many questions against one state is free and identical; many items packed
 * into one state is what degrades ranking (spec §6.1). And §8's reason is the sharper one — the
 * state is the smallest thing that still makes the line readable, so an injected instruction
 * somewhere else in the document is not in the request at all.
 *
 * The state format is Task A4's, the one the cut points were measured on (R5). `entryLine` is the
 * one entry-line helper on this feature: E4 and E5b import it, so every prompt that names a
 * bullet's role says it the same way (R17).
 */

export function entryLine(entry: { role: string; org: string }): string {
  return [entry.role, entry.org].map((s) => s.trim()).filter((s) => s !== '').join(', ')
}

export function buildBulletState(bulletText: string, line: string): string {
  const bullet = `Line from the resume: ${bulletText}`
  // An empty role line is dropped rather than sent as a blank header: a header with nothing under
  // it reads to a judge as an absence it should weigh, and it is not one.
  return line === '' ? bullet : `Role: ${line}\n${bullet}`
}
