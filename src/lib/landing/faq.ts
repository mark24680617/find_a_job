/**
 * The questions people ask before they sign in, as data: the page renders this list and the
 * tests read the same one. The answers are the product's own claims — nothing here is promised
 * that a screen inside does not keep.
 */
export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Does it submit applications for me?',
    a: 'No. It writes with you; you read the answer, paste it into the form, and send it. An agent that presses submit on your behalf is not a partner — it is a liability with your name on it.',
  },
  {
    q: 'What does “cited” mean here?',
    a: 'Every factual sentence in a draft points at a fact from your own profile, and each fact carries the fragment of your resume or notes it came from. Select an underlined phrase and the source appears. Anything not underlined is the agent’s own prose, and looks like it.',
  },
  {
    q: 'What happens when it doesn’t know something?',
    a: 'It asks. If an answer needs a motivation, a date, or a preference that is not in your facts, the draft stops with a question for you rather than filling the gap with something plausible.',
  },
  {
    q: 'Which job sites work with a link?',
    a: 'Postings on Ashby, Greenhouse and Lever come in through their public job APIs. For anything else — LinkedIn included — paste the posting text; it is a first-class path, not a fallback.',
  },
  {
    q: 'Where is my data, and who can see it?',
    a: 'In your own account, under your own sign-in. The browser never talks to the database directly; every read and write goes through the server, which checks your identity first. Delete your account and everything under it goes with it.',
  },
  {
    q: 'Is it free? Is it open source?',
    a: 'Yes and yes. The live app is free to use; the code is MIT on GitHub, so you can read it, change it, or run your own.',
  },
  {
    q: 'Which model writes the drafts, and why should I trust it?',
    a: 'Gemini 3.7 Flash, at temperature zero. After every draft, code — not the model — checks that the stated length is met, that every cited phrase appears verbatim, and that every citation names a fact you actually have. A draft that fails is refused, not smoothed over.',
  },
  {
    q: 'Does it learn how I write?',
    a: 'Each time you rewrite one of its sentences, the difference is distilled into a rule and applied to every later draft. You can read and delete those rules on your profile.',
  },
]
