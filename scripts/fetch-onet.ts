/**
 * Regenerates `src/lib/resume/onet.ts` from O*NET's own download (spec §6.2).
 *
 *   npx tsx scripts/fetch-onet.ts <dir>
 *
 * Run at the start of a release, never edited by hand. The generated file records the release,
 * the date and a SHA-256 of what was downloaded, so the data on disk can be shown to be the data
 * O*NET published.
 *
 * A data file, not a live fetch: the product makes no request to onetcenter.org at run time, so
 * no new outbound host enters the build and spec §8's SSRF posture is untouched.
 *
 * The attribution is READ AT THE SOURCE and pasted into <dir>/attribution.txt by a person. It is
 * a licence condition, not a courtesy, and this script will not compose one.
 *
 * No top-level await: tsx compiles this to CJS.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RELEASE = '31.0'
const SOURCE = `https://www.onetcenter.org/dl_files/database/db_${RELEASE.replace('.', '_')}_csv/software_skills.csv`
const LICENCE = 'https://www.onetcenter.org/license_db.html'
const OUT = 'src/lib/resume/onet.ts'

/**
 * The occupations this product's users apply to. All 923 would be megabytes for a page that asks
 * about one; these twelve came to 3,350 rows over 993 distinct names on release 31.0. Adding one
 * is a line here and a re-run. This is the one list: Task D1's role-family picker is derived from
 * ONET_TITLES, so a code added here is a family the page offers (R11).
 */
const ALLOWED_SOC = [
  '15-1252.00', // Software Developers
  '15-1253.00', // Software Quality Assurance Analysts and Testers
  '15-1254.00', // Web Developers
  '15-1255.00', // Web and Digital Interface Designers
  '15-2051.00', // Data Scientists
  '15-1211.00', // Computer Systems Analysts
  '15-1212.00', // Information Security Analysts
  '15-1243.00', // Database Architects
  '15-1244.00', // Network and Computer Systems Administrators
  '15-1299.08', // Computer Systems Engineers/Architects
  '15-1299.09', // Information Technology Project Managers
  '11-3021.00', // Computer and Information Systems Managers
]

/**
 * Spellings that mean one thing, folded onto the name O*NET uses. Hand-maintained HERE, not in
 * the generated file, and every value is checked against the data before anything is written: an
 * alias pointing at a name that is not in the release is a silent miss, and a miss lands a skill
 * in bucket 3, where the product asks the user about a skill they may well have listed.
 */
const ALIASES: Record<string, string> = {
  postgres: 'PostgreSQL',
  aws: 'Amazon Web Services AWS software',
  ec2: 'Amazon Elastic Compute Cloud EC2',
  azure: 'Microsoft Azure software',
  gcp: 'Google Cloud software',
  k8s: 'Kubernetes',
  nodejs: 'Node.js',
  java: 'Oracle Java',
  j2ee: 'Oracle Java 2 Platform Enterprise Edition J2EE',
  terraform: 'IBM Terraform',
  'elastic search': 'Elasticsearch',
  // (final review, ledger-2; F3, owner decision 2026-09-26) The short names resumes and postings
  // are written in, behind O*NET's long ones. Only tokens that are not ordinary English, by A6's
  // Node.js rule (progress.md:119): a whole-word match in a fact claim puts a skill in bucket 2
  // with no judge. Left out on purpose: excel, spark, hive, maven, angular and confluence are
  // English words ('I excel at', 'spark interest', 'a maven of'), and would flag a skill from
  // plain prose; sql matches inside T-SQL and PL/SQL and names a different O*NET row
  // (Structured query language SQL) from SQL Server; ios whole-word matches Cisco IOS, a different
  // vendor's O*NET row beside Apple iOS in Software Developers, so a network line would name Apple
  // iOS; left out for the same reason as sql.
  kafka: 'Apache Kafka',
  hadoop: 'Apache Hadoop',
  airflow: 'Apache Airflow',
  jenkins: 'Jenkins CI',
  jira: 'Atlassian JIRA',
  html: 'Hypertext markup language HTML',
  css: 'Cascading style sheets CSS',
  json: 'JavaScript Object Notation JSON',
  xml: 'Extensible markup language XML',
  powerpoint: 'Microsoft PowerPoint',
  sharepoint: 'Microsoft SharePoint',
  'power bi': 'Microsoft Power BI',
  matlab: 'The MathWorks MATLAB',
  dynamodb: 'Amazon DynamoDB',
  redshift: 'Amazon Redshift',
  tomcat: 'Apache Tomcat',
  bitbucket: 'Atlassian Bitbucket',
  'sql server': 'Microsoft SQL Server',
  android: 'Google Android',
  macos: 'Apple macOS',
  cassandra: 'Apache Cassandra',
}

/** One row of a CSV that quotes fields containing commas; O*NET's does. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i += 1 }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(field); field = '' }
    else field += c
  }
  out.push(field)
  return out
}

const literal = (s: string): string => JSON.stringify(s)

async function main(): Promise<void> {
  const [dir] = process.argv.slice(2)
  if (!dir) throw new Error('usage: fetch-onet.ts <dir>   (holding attribution.txt)')

  const attribution = readFileSync(join(dir, 'attribution.txt'), 'utf8').trim()
  if (attribution.length < 20 || !attribution.includes('O*NET')) {
    throw new Error(`${join(dir, 'attribution.txt')} does not hold O*NET's own attribution wording; read ${LICENCE}`)
  }

  const response = await fetch(SOURCE)
  if (!response.ok) throw new Error(`${SOURCE} answered ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(body).digest('hex')
  writeFileSync(join(dir, 'software_skills.csv'), body)
  console.log(`downloaded ${body.byteLength} bytes, sha256 ${sha256}`)

  const rows = body.toString('utf8').split(/\r?\n/).filter((l) => l !== '')
  const header = splitCsvLine(rows[0])
  const at = (name: string): number => {
    const index = header.indexOf(name)
    if (index < 0) throw new Error(`the download has no ${JSON.stringify(name)} column: ${header.join(', ')}`)
    return index
  }
  const codeAt = at('O*NET-SOC Code')
  const titleAt = at('Title')
  const nameAt = at('Workplace Example')
  // (F3, ledger-2) In Demand, not Hot Technology. O*NET's 31.0 data dictionary, read 2026-09-26
  // at https://www.onetcenter.org/dictionary/31.0/excel/software_skills.html: "The Hot Technology
  // column indicates requirements frequently included across all employer job postings. [...] The
  // In Demand column indicates requirements frequently included in employer job postings for the
  // particular occupation." The second is the demand Gaps states.
  const inDemandAt = at('In Demand')

  const wanted = new Set(ALLOWED_SOC)
  const titles: Record<string, string> = {}
  const skills: Record<string, { name: string; inDemand: boolean }[]> = {}
  const seen = new Map<string, Set<string>>()
  for (const row of rows.slice(1)) {
    const cells = splitCsvLine(row)
    const code = cells[codeAt]
    if (!wanted.has(code)) continue
    const name = cells[nameAt].trim()
    if (name === '') continue
    titles[code] = cells[titleAt].trim()
    const already = seen.get(code) ?? new Set<string>()
    if (already.has(name)) continue
    already.add(name)
    seen.set(code, already)
    ;(skills[code] ??= []).push({ name, inDemand: cells[inDemandAt].trim() === 'Y' })
  }

  const missing = ALLOWED_SOC.filter((code) => !skills[code])
  if (missing.length > 0) throw new Error(`release ${RELEASE} has no rows for ${missing.join(', ')}`)

  const names = new Set(Object.values(skills).flat().map((s) => s.name))
  for (const [spelling, target] of Object.entries(ALIASES)) {
    if (!names.has(target)) throw new Error(`alias ${spelling} points at ${JSON.stringify(target)}, which is not in release ${RELEASE}`)
  }

  const total = Object.values(skills).reduce((t, list) => t + list.length, 0)
  const lines = [
    '/**',
    ` * GENERATED BY scripts/fetch-onet.ts — DO NOT EDIT BY HAND.`,
    ` *`,
    ` * O*NET ${RELEASE} Database, software_skills.csv (the Technology Skills and Tools Used data).`,
    ` * Source:  ${SOURCE}`,
    ` * Fetched: ${new Date().toISOString().slice(0, 10)}`,
    ` * SHA-256: ${sha256}`,
    ` * Licence: CC BY 4.0 — ${LICENCE}. ONET_ATTRIBUTION below is O*NET's own wording, read at`,
    ` * that page and quoted verbatim; the page displays it whenever a Tier 1 row is drawn, which`,
    ` * is a licence condition and not a courtesy.`,
    ` *`,
    ` * ${Object.keys(skills).length} occupations, ${total} rows, ${names.size} distinct names.`,
    ' */',
    `export const ONET_RELEASE = ${literal(RELEASE)}`,
    '',
    `export const ONET_ATTRIBUTION = ${literal(attribution)}`,
    '',
    '/** The display name the page offers and the route stores on GapsResult.roleFamily. */',
    'export const ONET_TITLES: Record<string, string> = {',
    ...ALLOWED_SOC.map((code) => `  ${literal(code)}: ${literal(titles[code])},`),
    '}',
    '',
    '/**',
    ' * Keyed by O*NET-SOC code. `inDemand` is the release\'s own In Demand flag: frequently asked',
    ' * for in this occupation\'s postings (not Hot Technology, which is across all postings).',
    ' */',
    'export const ONET_SKILLS: Record<string, { name: string; inDemand: boolean }[]> = {',
    ...ALLOWED_SOC.flatMap((code) => [
      `  ${literal(code)}: [`,
      ...skills[code].map((s) => `    { name: ${literal(s.name)}, inDemand: ${s.inDemand} },`),
      '  ],',
    ]),
    '}',
    '',
    '/** One spelling, one name. Maintained in scripts/fetch-onet.ts and emitted here. */',
    'export const ONET_ALIASES: Record<string, string> = {',
    ...Object.entries(ALIASES).map(([k, v]) => `  ${literal(k)}: ${literal(v)},`),
    '}',
    '',
  ]
  writeFileSync(OUT, lines.join('\n'))
  console.log(`wrote ${OUT}: ${Object.keys(skills).length} occupations, ${total} rows, ${names.size} distinct names`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
