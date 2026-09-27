/**
 * Two texts of the same resume (spec §9.5, §12 item 4).
 *
 *   npx tsx --env-file=.env.local scripts/diff-resume-text.ts <dir>
 *
 * Gemini reads the PDF multimodally and `pdfjs-dist` reads it in TypeScript. Every guard on this
 * feature is a verbatim includes() against the extracted text, so the two had better say the same
 * thing — and where they do not, the stored extracted text is canonical (spec §5.1) and this run
 * is what decides whether `profileIngest` should be handed that text as a Part instead of the
 * document.
 *
 * The model side goes through `runAssignmentTranscribe`, which builds exactly the Part
 * `profileIngest` builds — one media part, the PDF inlined as a base64 data URL, and nothing
 * beside it (`src/ai/prompts/assignmentTranscribe.ts:22-23`, `profileIngest.ts:70-77`). It is the
 * same path with the transcription prompt in front of it, which is what this diff needs.
 *
 * Then the thing nobody has measured: `profileIngest` demands a verbatim `sourceSnippet` for
 * every fact and NOTHING in the repo checks one, because the source document was never stored
 * (spec §12 item 3). Here the document is stored, so the check is possible for the first time.
 *
 * Fixtures only, and real API calls. No top-level await: tsx compiles this to CJS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runAssignmentTranscribe } from '../src/ai/flows/assignmentTranscribe'
import { runProfileIngest } from '../src/ai/flows/profileIngest'
import { normalizeWs } from '../src/lib/research/quotes'
import { extractWithPdfjs } from './spike-pdfjs'
import { CLEAN_EN, extractedText, renderFixture, TWO_COLUMN_EN, type ResumeFixture } from '../tests/fixtures/resumes'

const lines = (text: string): string[] =>
  text.split('\n').map(normalizeWs).filter((l) => l !== '')

/** Line-level containment both ways: what a verbatim includes() would find, and would not. */
function compare(label: string, mineName: string, mine: string, theirName: string, theirs: string): void {
  const a = lines(mine)
  const b = lines(theirs)
  const haystack = normalizeWs(theirs)
  const reverse = normalizeWs(mine)
  const lost = a.filter((l) => !haystack.includes(l))
  const extra = b.filter((l) => !reverse.includes(l))
  console.log(`\n${label}`)
  console.log(`  characters: ${mineName} ${normalizeWs(mine).length}, ${theirName} ${normalizeWs(theirs).length}`)
  console.log(`  ${mineName} lines found in ${theirName}'s text: ${a.length - lost.length} of ${a.length}`)
  console.log(`  ${theirName} lines found in ${mineName}'s text: ${b.length - extra.length} of ${b.length}`)
  for (const l of lost.slice(0, 10)) console.log(`    only ${mineName}: ${JSON.stringify(l)}`)
  for (const l of extra.slice(0, 10)) console.log(`    only ${theirName}: ${JSON.stringify(l)}`)
}

async function run(fixture: ResumeFixture, dir: string): Promise<void> {
  const bytes = await renderFixture(fixture)
  writeFileSync(join(dir, `${fixture.id}.pdf`), bytes)
  const pdfBase64 = Buffer.from(bytes).toString('base64')

  const pages = await extractWithPdfjs(bytes)
  const fromPdfjs = pages
    .map((p) => p.items.map((i) => i.text).join(' '))
    .join('\n')
  const { text: fromGemini } = await runAssignmentTranscribe({ pdfBase64 })

  writeFileSync(join(dir, `${fixture.id}.pdfjs.txt`), fromPdfjs)
  writeFileSync(join(dir, `${fixture.id}.gemini.txt`), fromGemini)

  // The fixture's own ground truth is the third text, and the one the other two are judged by.
  compare(`${fixture.id}: pdfjs against gemini`, 'pdfjs', fromPdfjs, 'gemini', fromGemini)
  compare(`${fixture.id}: fixture truth against pdfjs`, 'truth', extractedText(fixture), 'pdfjs', fromPdfjs)
  compare(`${fixture.id}: fixture truth against gemini`, 'truth', extractedText(fixture), 'gemini', fromGemini)

  const ingested = await runProfileIngest({ pdfBase64 })
  const located = (haystack: string): number => {
    const text = normalizeWs(haystack)
    return ingested.facts.filter((f) => f.sourceSnippet !== '' && text.includes(normalizeWs(f.sourceSnippet))).length
  }
  const inPdfjs = located(fromPdfjs)
  const inGemini = located(fromGemini)
  console.log(`\n${fixture.id}: ${ingested.facts.length} facts from profileIngest`)
  console.log(`  sourceSnippets found in the pdfjs text:  ${inPdfjs} of ${ingested.facts.length}`)
  console.log(`  sourceSnippets found in the gemini text: ${inGemini} of ${ingested.facts.length}`)
  for (const f of ingested.facts) {
    if (!normalizeWs(fromPdfjs).includes(normalizeWs(f.sourceSnippet))) {
      console.log(`    NOT IN THE EXTRACTED TEXT: ${f.id} ${JSON.stringify(f.sourceSnippet)}`)
    }
  }
  // R12: the "feed the extracted text" outcome is an owner decision, not a task in this plan.
  console.log(`\n  Decision rule: if ${inPdfjs} is below ${ingested.facts.length}, the stored text`)
  console.log('  cannot check every snippet profileIngest produces: record "feed profileIngest the')
  console.log('  extracted text as a Part" in deps.md as an owner decision. If it is equal, the PDF')
  console.log('  stays as it is. Stage B keeps the extracted text canonical either way.')
}

async function main(): Promise<void> {
  const [dir] = process.argv.slice(2)
  if (!dir) throw new Error('usage: diff-resume-text.ts <dir>')
  mkdirSync(dir, { recursive: true })
  for (const fixture of [CLEAN_EN, TWO_COLUMN_EN]) await run(fixture, dir)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
