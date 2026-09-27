import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * README's one-line deploy is the only deploy command in the public snapshot (docs/ is left out
 * of it), so it has to carry every runtime variable the service reads. `--set-env-vars` replaces
 * the service's variables wholesale: a deploy without `RESUME_TOOLS_ENABLED` answers 503 on the
 * upload and every resume tool route (final review, docs-4).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')

/** The `NAME` of every `NAME=${NAME}` entry a `--flag "^##^…"` argument carries. */
function flagKeys(flag: string): string[] {
  const match = README.match(new RegExp(`${flag} "\\^##\\^([^"]+)"`))
  if (!match) throw new Error(`README has no ${flag} argument`)
  return match[1].split('##').map((entry) => {
    const [key, value] = entry.split('=')
    expect(value).toBe(`\${${key}}`)
    return key
  })
}

const PUBLIC = [
  'NEXT_PUBLIC_FB_API_KEY',
  'NEXT_PUBLIC_FB_AUTH_DOMAIN',
  'NEXT_PUBLIC_FB_PROJECT_ID',
  'NEXT_PUBLIC_FB_APP_ID',
]
const RUNTIME_ONLY = [
  'GEMINI_API_KEY',
  'TYPESAFE_API_KEY',
  'RESUME_TOOLS_ENABLED',
  'RESUME_DEPLOYMENT_CEILING',
]

describe("README's deploy command", () => {
  it('sets every runtime variable, the three resume ones included', () => {
    expect(flagKeys('--set-env-vars').sort()).toEqual([...RUNTIME_ONLY, ...PUBLIC].sort())
  })

  it('bakes only the NEXT_PUBLIC_* values into the build', () => {
    expect(flagKeys('--update-build-env-vars').sort()).toEqual([...PUBLIC].sort())
  })
})

describe("README's deployment ceiling row", () => {
  it('states no dollar bound the metering does not enforce', () => {
    const row = README.split('\n').find((line) => line.startsWith('| `RESUME_DEPLOYMENT_CEILING`'))
    expect(row).toBeDefined()
    expect(row).not.toMatch(/\$\d/)
    expect(row).toMatch(/not dollars/)
  })
})
