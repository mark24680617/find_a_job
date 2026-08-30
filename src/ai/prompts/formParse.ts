/**
 * The formParse prompt: a job-application form as pasted text and/or screenshots in, the
 * instructions that turn it into questions out. The system text below is the design spec's,
 * word for word — it encodes the learning this flow exists for (the control type is the
 * length spec nobody writes down, and a limit is only real when the form shows one), so it
 * is quoted rather than rewritten, and `tests/prompts.formParse.test.ts` holds a copy that
 * fails the build if this one drifts.
 */
import type { Part } from '@/ai/genkit'

const SYSTEM = `You read a job-application form (pasted text and/or screenshots) and extract its questions.
- One entry per answerable field. Skip pure data fields (name, email, phone, resume upload)
  UNLESS they carry constraints worth flagging.
- constraints: limit + unit ONLY if the form states or shows one (e.g. "max 500 characters",
  a visible counter). A single-line input implies a SHORT answer even with no stated limit —
  then set type "short-text" and no limit. Multi-line → "long-text". Dropdowns → "select".
- required: true only if marked required (asterisk, "required").
- scope: "per-profile" if the form is a platform-wide profile (wording like "your profile",
  reused across jobs), "per-application" if tied to this one requisition, else "unknown".
  scopeEvidence: quote the wording you judged from.
The control type is the unwritten length spec. Read the form, not your assumptions.`

/**
 * What a screenshot may be. The model reads a form by looking at it, so a type it cannot
 * decode is not a slow path — it is a blind one, and the answer would be invented rather
 * than read. Stated as a union so the route's runtime check is the only place an unknown
 * mime can enter, and everything downstream is checked by the compiler.
 */
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type ImageMime = (typeof IMAGE_MIMES)[number]

/** One screenshot of the form, as the browser handed it over. */
export interface FormImage {
  base64: string
  mime: ImageMime
}

export interface FormParseInput {
  text?: string
  images: FormImage[]
}

/**
 * A `data:` URL's header, if the payload arrived still wearing one. The browser hands a
 * screenshot over as a full data URL (`FileReader.readAsDataURL`), so the base64 that
 * reaches here may already be prefixed; prefixing it twice would send the model a payload
 * that decodes to nothing and cost a retry and a 500 to find out. The header is dropped
 * rather than read: the declared mime is the one the route checked against the allowed
 * list, so where the two disagree the declared one wins.
 */
const DATA_URL_HEADER = /^data:[^,]*;base64,/

/**
 * Screenshots go first — they are the form, and the pasted text is the note beside it.
 * An empty text is dropped rather than sent: an empty part is noise the model has to
 * account for. Nothing left to send is an error, not an empty prompt — asking for a form's
 * questions with no form in front of it is the one situation that forces the model to
 * invent them.
 */
export function buildFormParsePrompt(input: FormParseInput): {
  system: string
  parts: Part[]
} {
  const parts: Part[] = input.images.map((image) => {
    const payload = image.base64.replace(DATA_URL_HEADER, '')
    return { media: { url: `data:${image.mime};base64,${payload}`, contentType: image.mime } }
  })
  if (input.text) parts.push({ text: `Pasted form text:\n${input.text}` })
  if (parts.length === 0) throw new Error('formParse needs text or an image')
  return { system: SYSTEM, parts }
}
