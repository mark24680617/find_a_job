'use client'

import Link from 'next/link'
import { useState, type KeyboardEvent } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import type { Application, ArtifactScope, Gate, ParsedJob } from '@/lib/types'

/**
 * Step two: what the agent understood, shown before anything is written from it.
 *
 * The record already exists by the time this renders — the create returned it — so nothing
 * here is a draft waiting on a Save. Every correction is sent the moment it is made, and the
 * page says so rather than showing a save bar there is nothing to save.
 *
 * Three things on this screen are the human's, not the agent's:
 *   - **Company and role.** Ashby and Lever hand back a name derived from the URL slug, so a
 *     posting at `/trm-labs/` becomes "Trm Labs". They are text fields, not headings.
 *   - **The advisory.** An unmet hard requirement is a decision about whether to apply at
 *     all, and it is worth making before spending an evening on the answers.
 *   - **The scope**, when the model could not tell one from the other. Whether the answers
 *     attach to this requisition or to a platform-wide profile changes what is worth
 *     writing, and guessing it wrong is worse than asking.
 */

interface Props {
  app: Application
  onUpdated: (app: Application) => void
}

const MET: Record<Gate['met'], { label: string; className: string }> = {
  yes: { label: 'Met', className: 'border-accent bg-accent-soft text-accent' },
  no: { label: 'Not met', className: 'border-danger bg-danger-soft text-danger' },
  unclear: { label: 'Unclear', className: 'border-amber bg-amber-soft text-amber' },
}

/**
 * How firmly the posting words the requirement, in English. Three rungs, firmest first:
 * the posting insists, says nothing either way, or softens it itself. "Silent" is the
 * absence of a signal, not a mild one — it has to read weaker than "required", because the
 * advisory treats an unmet explicit and an unmet silent gate the same way.
 */
const POSTURE: Record<Gate['posture'], string> = {
  explicit: 'Worded as required',
  silent: 'Neither insisted nor softened',
  'escape-clause': 'Posting softens it',
}

/**
 * Grow a name field to its content. Roles run long — "Account Director, Defence and Intel
 * (Canada)" — and a single-line box would hide the end of the thing the record is named
 * after. They are textareas that wrap rather than inputs that clip; Enter commits.
 */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  // `height` sets the border box (Tailwind's preflight), while scrollHeight measures the
  // padding box, so the field's 1px borders have to be added back or the last line clips.
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
}

/**
 * The stored `sourceUrl` is whatever was in the box when the posting was pasted — the create
 * route keeps it without looking at it — so it is not a link until it parses as one. Anything
 * else (a `javascript:` scheme, a fragment of text) is shown as text and never given an href.
 */
function httpUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

const SOURCE: Record<string, string> = {
  ashby: 'Ashby',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  generic: 'the page itself',
  manual: 'text you pasted',
}

export function ParseConfirm({ app, onUpdated }: Props) {
  const [company, setCompany] = useState(app.company)
  const [role, setRole] = useState(app.role)
  // Selected immediately so the radio answers the click, then reverted if the write fails.
  const [scope, setScope] = useState<ArtifactScope>(app.parsed?.scope ?? 'unknown')
  // Whether the question was ever open. Answering it settles the panel rather than making it
  // vanish under the cursor — a misclick has to stay correctable.
  const [asked] = useState(app.parsed?.scope === 'unknown')
  const [saving, setSaving] = useState(false)
  // Two failure lines, not one: the scope radios sit several screens below the record header,
  // and a failure reported up there reads as a dead click down here.
  const [nameError, setNameError] = useState('')
  const [scopeError, setScopeError] = useState('')

  const parsed: ParsedJob | undefined = app.parsed
  const sourceLink = httpUrl(app.sourceUrl)

  /** Sends the change and says whether it landed. Where a failure is *shown* is the caller's. */
  async function patch(change: Partial<Application>): Promise<boolean> {
    setSaving(true)
    try {
      onUpdated(
        await apiFetch<Application>(`/api/applications/${app.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(change),
        }),
      )
      return true
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }

  /** Company and role travel together: they name one record, and one PATCH is one write. */
  async function commitName() {
    const nextCompany = company.trim() || app.company
    const nextRole = role.trim() || app.role
    setCompany(nextCompany)
    setRole(nextRole)
    if (nextCompany === app.company && nextRole === app.role) return
    setNameError('')
    if (!(await patch({ company: nextCompany, role: nextRole }))) {
      setNameError('That change didn’t save. Try again.')
    }
  }

  /** A name is one line: Enter finishes it rather than putting a newline inside it. */
  function commitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.currentTarget.blur()
  }

  async function chooseScope(next: ArtifactScope) {
    if (!parsed) return
    const previous = scope
    setScope(next)
    setScopeError('')
    if (!(await patch({ parsed: { ...parsed, scope: next } }))) {
      setScope(previous)
      setScopeError('That answer didn’t save. Try again.')
    }
  }

  return (
    <>
      <section aria-labelledby="record-heading" className="mt-8 border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-4">
          <div>
            <h2 id="record-heading" className="font-display text-lg tracking-tight text-ink">
              The record
            </h2>
            <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-ink-2">
              Both are editable. Job boards often derive the company from the address — “Trm
              Labs” for TRM Labs — so check it before anything is written under it.
            </p>
          </div>
          <p role="status" aria-live="polite" className={`text-sm ${nameError ? 'text-danger' : 'text-ink-3'}`}>
            {nameError || (saving ? 'Saving…' : 'Corrections save as you make them')}
          </p>
        </div>

        <div className="grid gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
          <div className="min-w-0">
            <label
              htmlFor="record-company"
              className="block text-xs font-medium uppercase tracking-[0.12em] text-ink-3"
            >
              Company
            </label>
            <textarea
              id="record-company"
              rows={1}
              className="field mt-1.5 font-display text-[1.25rem] leading-snug tracking-tight text-ink"
              value={company}
              ref={autoGrow}
              onInput={(e) => autoGrow(e.currentTarget)}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={commitOnEnter}
              onBlur={() => void commitName()}
            />
          </div>
          <div className="min-w-0">
            <label
              htmlFor="record-role"
              className="block text-xs font-medium uppercase tracking-[0.12em] text-ink-3"
            >
              Role
            </label>
            <textarea
              id="record-role"
              rows={1}
              className="field mt-1.5 font-display text-[1.25rem] leading-snug tracking-tight text-ink"
              value={role}
              ref={autoGrow}
              onInput={(e) => autoGrow(e.currentTarget)}
              onChange={(e) => setRole(e.target.value)}
              onKeyDown={commitOnEnter}
              onBlur={() => void commitName()}
            />
          </div>
        </div>

        <p className="border-t border-line px-5 py-3 text-sm text-ink-3">
          Read from {SOURCE[app.adapter] ?? app.adapter}
          {sourceLink ? (
            <>
              {' · '}
              <a
                href={sourceLink}
                target="_blank"
                rel="noreferrer"
                className="btn-link"
              >
                the posting
              </a>
            </>
          ) : (
            app.sourceUrl && <span className="break-all">{' · '}{app.sourceUrl}</span>
          )}
          {' · '}
          <span className="tnum">{app.jdRaw.length.toLocaleString()} characters</span>
        </p>
      </section>

      {parsed && parsed.advisory !== '' && (
        <section
          aria-labelledby="advisory-heading"
          className="mt-8 border border-line-strong bg-surface px-5 py-5"
        >
          <h2 id="advisory-heading" className="font-display text-lg tracking-tight text-ink">
            Worth a decision before you write
          </h2>
          <p className="mt-2 max-w-[62ch] text-[1.0625rem] leading-relaxed text-ink">
            {parsed.advisory}
          </p>
        </section>
      )}

      {parsed && parsed.roleFacts.length > 0 && (
        <section aria-labelledby="role-facts-heading" className="mt-10">
          <h2 id="role-facts-heading" className="font-display text-xl tracking-tight text-ink">
            What the role is
          </h2>
          <ul className="mt-4 max-w-[76ch] border-t border-line">
            {parsed.roleFacts.map((fact, i) => (
              <li
                key={`${fact}-${i}`}
                className="border-b border-line py-2.5 text-[0.9375rem] leading-relaxed text-ink-2"
              >
                {fact}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="gates-heading" className="mt-10">
        <h2 id="gates-heading" className="font-display text-xl tracking-tight text-ink">
          What it asks for
          {parsed && parsed.gates.length > 0 && (
            <span className="tnum ml-3 text-sm font-normal text-ink-3">{parsed.gates.length}</span>
          )}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">
          Judged against the facts in your profile — nothing else. A requirement it can’t settle
          from those is yours to settle.
        </p>

        {!parsed || parsed.gates.length === 0 ? (
          <p className="mt-5 border border-dashed border-line px-5 py-8 text-sm text-ink-2">
            No hard requirements stated in this posting.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-line-strong text-left text-xs uppercase tracking-[0.12em] text-ink-3">
                  <th scope="col" className="py-2 pr-6 font-medium">
                    Requirement
                  </th>
                  <th scope="col" className="w-28 py-2 pr-4 font-medium">
                    You
                  </th>
                  <th scope="col" className="w-56 py-2 pr-4 font-medium">
                    How it’s worded
                  </th>
                  <th scope="col" className="w-2/5 py-2 font-medium">
                    What the posting says
                  </th>
                </tr>
              </thead>
              <tbody>
                {parsed.gates.map((gate, i) => (
                  <tr key={`${gate.requirement}-${i}`} className="border-b border-line align-top">
                    <td className="py-3 pr-6 leading-relaxed text-ink">{gate.requirement}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={`chip font-medium ${MET[gate.met].className}`}
                      >
                        {MET[gate.met].label}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="chip">
                        {POSTURE[gate.posture]}
                      </span>
                    </td>
                    <td className="py-3 font-display text-sm leading-relaxed text-ink-2">
                      {gate.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {parsed && asked && (
        <section
          aria-labelledby="scope-heading"
          className={`mt-10 border px-5 py-5 ${
            scope === 'unknown' ? 'border-amber bg-amber-soft' : 'border-line bg-surface'
          }`}
        >
          <h2 id="scope-heading" className="font-display text-lg tracking-tight text-ink">
            Is this form for this one job, or a platform profile?
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-ink-2">
            The posting doesn’t say, and it changes what’s worth writing. Only you can see the
            form you’re filling in.
          </p>
          <div className="mt-4 grid gap-3">
            {(
              [
                ['per-application', 'This one job', 'Answers belong to this requisition and nothing else.'],
                ['per-profile', 'A platform profile', 'Answers follow you to every job posted on that platform.'],
              ] as const
            ).map(([value, label, help]) => (
              <label key={value} className="flex max-w-[62ch] cursor-pointer items-baseline gap-3">
                <input
                  type="radio"
                  name="artifact-scope"
                  value={value}
                  className="accent-accent"
                  checked={scope === value}
                  disabled={saving}
                  onChange={() => void chooseScope(value)}
                />
                <span>
                  <span className="text-[0.9375rem] font-medium text-ink">{label}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-ink-2">{help}</span>
                </span>
              </label>
            ))}
          </div>
          {scopeError !== '' && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {scopeError}
            </p>
          )}
        </section>
      )}

      <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line-strong pt-5">
        <Link href={`/applications/${app.id}`} className="btn btn-primary">
          Continue
        </Link>
        <p className="text-sm text-ink-3">
          Already saved as a draft — nothing here is lost by leaving.
        </p>
      </div>
    </>
  )
}
