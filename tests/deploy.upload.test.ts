import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `gcloud run deploy --source .` uploads what `.gcloudignore` leaves, and the buildpack's
 * `next build` type-checks every file `tsconfig.json` includes. A file that is uploaded but
 * imports one that is not fails the deploy at "Running TypeScript" while every local gate
 * passes, because locally both files exist (final review, docs-1: five scripts imported
 * `../tests/fixtures/resumes` with `tests` ignored).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `.gcloudignore`'s patterns. Each is a bare name or a `*` glob, matched on any path segment. */
function ignorePatterns(): RegExp[] {
  return readFileSync(join(ROOT, '.gcloudignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      if (line.includes('/') || line.startsWith('!')) throw new Error(`unhandled pattern: ${line}`)
      const body = line.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
      return new RegExp(`^${body}$`)
    })
}

const isIgnored = (path: string, patterns: RegExp[]) =>
  path.split('/').some((segment) => patterns.some((p) => p.test(segment)))

/** Every uploaded file `next build` type-checks: tsconfig's `**\/*.ts`, `.tsx` and `.mts`. */
function uploadedSources(patterns: RegExp[]): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const rel = relative(ROOT, abs)
      if (isIgnored(rel, patterns)) continue
      if (statSync(abs).isDirectory()) walk(abs)
      else if (/\.(ts|tsx|mts)$/.test(name)) out.push(rel)
    }
  }
  walk(ROOT)
  return out
}

/** Left out of the upload but written again by the build before its type-check runs. */
const REBUILT = new Set(['.next', 'node_modules'])

const RELATIVE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g

describe('the source deploy upload', () => {
  const patterns = ignorePatterns()

  it('uploads no type-checked file that imports a file the upload leaves out', () => {
    const broken: string[] = []
    for (const file of uploadedSources(patterns)) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      for (const [, spec] of text.matchAll(RELATIVE_IMPORT)) {
        const target = relative(ROOT, resolve(ROOT, dirname(file), spec))
        if (REBUILT.has(target.split('/')[0])) continue
        if (isIgnored(target, patterns)) broken.push(`${file} -> ${spec}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('leaves the dev-only scripts out of the upload', () => {
    expect(isIgnored('scripts/smoke-resume.ts', patterns)).toBe(true)
    expect(isIgnored('src/app/page.tsx', patterns)).toBe(false)
  })

  it('keeps scripts and tests in the local type-check, so the fix is never made in tsconfig', () => {
    const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')) as {
      include: string[]
      exclude: string[]
    }
    expect(tsconfig.include).toContain('**/*.ts')
    expect(tsconfig.exclude).not.toContain('scripts')
    expect(tsconfig.exclude).not.toContain('tests')
  })
})
