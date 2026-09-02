'use client'

import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { authMessage } from '@/lib/authMessage'
import { updateAccountProfile } from '@/lib/firebase/client'

/**
 * The two things about an account a person may simply type: what to call them, and a picture.
 * Both are local until Save — the shell is told while they differ from what is stored, so
 * leaving the page asks first. No upload: a picture is a URL, because file storage is not
 * part of what this product runs on.
 */

interface Props {
  user: User
  onDirty: (dirty: boolean) => void
}

/** A one-letter stand-in for a missing or broken picture: the name's initial, or the email's. */
function initial(user: User, name: string): string {
  const source = name.trim() || user.email || ''
  return source.charAt(0).toUpperCase() || '?'
}

export function NameAndPhoto({ user, onDirty }: Props) {
  const storedName = user.displayName ?? ''
  const storedPhoto = user.photoURL ?? ''
  const [name, setName] = useState(storedName)
  const [photo, setPhoto] = useState(storedPhoto)
  // A URL that does not load falls back to the letter rather than a broken-image icon.
  const [broken, setBroken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const dirty = name.trim() !== storedName.trim() || photo.trim() !== storedPhoto.trim()
  useEffect(() => {
    onDirty(dirty)
    return () => onDirty(false)
  }, [dirty, onDirty])

  async function save() {
    setSaving(true)
    setError('')
    setNote('')
    try {
      await updateAccountProfile(user, name, photo)
      setNote('Saved.')
    } catch (err) {
      setError(authMessage(err, 'account'))
    } finally {
      setSaving(false)
    }
  }

  const showImage = photo.trim() !== '' && !broken

  return (
    <section aria-labelledby="name-heading">
      <h2 id="name-heading" className="font-display text-lg tracking-tight text-ink">
        Name and photo
      </h2>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-line bg-canvas font-display text-lg text-ink-2"
          aria-hidden="true"
        >
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- a remote URL the person typed; next/image would need every host allowlisted
            <img src={photo.trim()} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
          ) : (
            initial(user, name)
          )}
        </div>
        <fieldset disabled={saving} className="grid min-w-0 gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Display name</span>
            <input
              type="text"
              autoComplete="name"
              className="field field-boxed h-10 px-3"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (note) setNote('')
                if (error) setError('')
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Photo URL</span>
            <input
              type="url"
              inputMode="url"
              placeholder="https://…"
              className="field field-boxed h-10 px-3"
              value={photo}
              onChange={(e) => {
                setPhoto(e.target.value)
                setBroken(false)
                if (note) setNote('')
                if (error) setError('')
              }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <p
              role="status"
              aria-live="polite"
              className={`text-sm ${error ? 'text-danger' : note ? 'text-accent' : 'text-ink-3'}`}
            >
              {error || note || (dirty ? 'Unsaved edits' : 'Nothing unsaved')}
            </p>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
