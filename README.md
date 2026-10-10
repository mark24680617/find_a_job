# Find a Job

**Your story is unique. AI helps you tell it — it doesn't replace it.**

An agent that fills in job applications the way a good friend would: it reads your resume once,
reads the posting, and then writes each answer out of things you have actually done — with every
claim underlined and traceable back to the fact it came from. Where a fact would have to be
invented it stops and asks you instead of guessing, and before it drafts anything long it puts
the positioning calls to you: which half of your background should lead, whether the gap in 2025
gets named. It reads the posting's hard requirements against your profile and says plainly when
one is a firm no, so you can decide whether to apply at all before writing four answers. And it
learns your voice from your edits — each time you rewrite one of its sentences, the rule you were
applying is distilled and kept. A cover letter is one of those questions: drafted the same cited
way, with a letterhead above it and one button that sets the letter you saved on a US-Letter page
as a PDF.

**Live:** <https://find-a-job-572064776552.us-west1.run.app>

---

## What it looks like

| | |
|---|---|
| <img src="assets/06-review-workspace-citations-light.png" alt="The review workspace: a drafted answer with cited phrases underlined, an amber card asking the candidate a question the agent will not guess, and the editable final answer with a live word count." width="100%"> | <img src="assets/08-review-setup-clarify-cards-light.png" alt="Two positioning questions asked before drafting, each with a recommended option already selected." width="100%"> |
| **Grounded drafting.** Underlined phrases are citations — select one and the fact behind it appears. What is not underlined is the agent's own prose, and looks like it. | **The clarify loop.** Before a long answer, the calls only you can make — each with a recommendation already picked, so the fast path is to glance and draft. |
| <img src="assets/05-wizard-parse-confirm-gates-light.png" alt="The parsed posting: company and role, an advisory about an unmet requirement, and a table of three requirements judged met, not met and unclear." width="100%"> | <img src="assets/01-dashboard-pipeline-light.png" alt="The pipeline board: five columns from draft to rejected, each card showing company, role and how long since anything last happened to it." width="100%"> |
| **Hard gates, judged honestly.** Every requirement gets a verdict against your facts, a read of how firmly it is worded, and — when one is unmet — an apply-or-skip advisory. | **The pipeline.** Where everything is, and what has gone quiet. Interviews still ahead sit above it and export to your calendar. |

The empty dashboard has a **Load sample data** button. It writes one invented candidate, one
invented posting and one booked interview into your own account, so the product can be seen full
without pasting a real resume first.

There is a **Resume** page at `/profile/resume`. Upload the PDF you actually send to employers and
it is stored under your account, then checked three ways, each one triggered on its own: Diagnose
runs a suite of deterministic checks — text layer, columns, contact details in a header, dates,
placeholder residue, hidden text — each with the vendor that documents it named beside the verdict,
and then asks a yes/no judge four fixed questions per bullet. Gaps reads the skills your own saved
postings and O*NET's data for one occupation ask for, and sorts them into three buckets. Rewrite
proposes a replacement for a bullet that failed, with every claim cited back to a fact or to a
span of the resume, and writes nothing until you accept it. Every count on that page is `.length`
over the rows beside it; there is no score and no percentage anywhere on it.

The page has one line about privacy — your resume is private to your account, and you can delete
it at any time. In full, for anyone running a copy of their own:

> Your resume text goes to Google's Gemini API to produce what is on this page. When a TypeSafe
> API key is configured, the same text also goes to TypeSafe's Jev API for the yes/no judgements.
> TypeSafe's terms say it does not train on what you send and that the output is yours; the same
> terms reserve ongoing rights over telemetry derived from your requests, and zero-data-retention
> is an enterprise-only option this deployment does not have. Your resume is stored under your
> account in Firestore, and you can delete it here.

---

## Running it locally

About ninety seconds, most of it waiting on `npm install`.

```sh
git clone <repository-url> find-a-job && cd find-a-job
cp .env.example .env.local          # then fill in the six values below
npm install
gcloud auth application-default login
npm run dev                         # http://localhost:3000
```

`.env.local`:

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> — the Gemini Developer API; the free tier is enough |
| `TYPESAFE_API_KEY` | *optional* — the yes/no judge. Without it every judgement falls back to Gemini and each row on the Resume page says which judge answered it. With it, JEV is asked only once `CUTS_MEASURED` in `src/lib/resume/cuts.ts` is `true`, which the owner's key-arrival follow-up sets |
| `RESUME_TOOLS_ENABLED` | `true` turns the Resume page's three tools on. Anything else, unset included, answers 503 on upload and every tool route — it is the kill switch, and it is read on every request so it can be flipped without a rebuild |
| `RESUME_DEPLOYMENT_CEILING` | *optional* — metered units a day across the whole deployment before every tool refuses; `200` when unset. It limits units, not dollars. A unit is one upload, one rewrite bullet, one Gaps run, or one Diagnose run over up to 20 visible bullets. Diagnose makes one judge call a bullet plus one findings call a run; Gaps makes one judge call per 64 skills in the role family, each carrying the resume's visible text. Only the rewrite bullet's cost has a worked ceiling (four model calls); the findings and Gaps calls are not yet measured, so no dollar figure bounds the day |
| `NEXT_PUBLIC_FB_API_KEY` | Firebase console → Project settings → Your apps → Web app → SDK setup |
| `NEXT_PUBLIC_FB_AUTH_DOMAIN` | same panel — `your-project.firebaseapp.com` |
| `NEXT_PUBLIC_FB_PROJECT_ID` | same panel |
| `NEXT_PUBLIC_FB_APP_ID` | same panel — `1:000000000000:web:…` |
| `REDDIT_CLIENT_ID` | *optional, for Reddit write-ups* — <https://www.reddit.com/prefs/apps>, "create app" → **installed app**. Reddit refuses its public JSON to servers, so without an id the research reads no Reddit at all |
| `REDDIT_CLIENT_SECRET` | *optional* — leave unset for an installed app, which has none |

Two dependencies on this page are pinned to an exact version rather than a range: `pdfjs-dist`
`6.3.289`, which parses the uploaded PDF and is therefore a security dependency, and `server-only`
`0.0.1`, which makes a client import of the judge a build failure rather than a runtime surprise.

Two things have to be switched on in the Firebase project itself: **Firestore** in Native mode,
and the **Email/password** and **Google** sign-in providers under Authentication. `localhost` is
an authorized domain by default, so nothing else is needed for local work.

No service-account key lives in this repo, and none should. `gcloud auth application-default
login` is what gives the server side its Firestore credentials locally; on Cloud Run the same
code picks up the runtime service account instead.

```sh
npm test          # 2411 tests
npm run build     # production build, typecheck included
```

### Making yourself the administrator

The admin panel (`/admin`) is shown to the one account whose ID token carries the `admin`
claim. Set it once, from a machine with `gcloud auth application-default login` done:

```sh
npx tsx --env-file=.env.local scripts/grant-admin.ts you@example.com
```

Sign out and back in to pick the claim up now; otherwise it arrives within the hour.
`--revoke` takes it away again.

## Deploying

The service runs on Cloud Run from source — no Dockerfile; buildpacks handle it. The four
`NEXT_PUBLIC_*` values must be passed as *build* env vars as well as runtime ones (Next.js inlines
them into the client bundle at build time). The other four are runtime-only and never go in
the build. `--set-env-vars` replaces every variable the service had, so the command carries all
eight: an empty value is safe for `TYPESAFE_API_KEY` (the judge falls back to Gemini) and
`RESUME_DEPLOYMENT_CEILING` (200), but an empty `RESUME_TOOLS_ENABLED` switches the resume tools
off. One line:

```sh
set -a; . ./.env.local; set +a && gcloud run deploy find-a-job --source . --region us-west1 --allow-unauthenticated \
  --set-env-vars "^##^GEMINI_API_KEY=${GEMINI_API_KEY}##TYPESAFE_API_KEY=${TYPESAFE_API_KEY}##RESUME_TOOLS_ENABLED=${RESUME_TOOLS_ENABLED}##RESUME_DEPLOYMENT_CEILING=${RESUME_DEPLOYMENT_CEILING}##NEXT_PUBLIC_FB_API_KEY=${NEXT_PUBLIC_FB_API_KEY}##NEXT_PUBLIC_FB_AUTH_DOMAIN=${NEXT_PUBLIC_FB_AUTH_DOMAIN}##NEXT_PUBLIC_FB_PROJECT_ID=${NEXT_PUBLIC_FB_PROJECT_ID}##NEXT_PUBLIC_FB_APP_ID=${NEXT_PUBLIC_FB_APP_ID}" \
  --update-build-env-vars "^##^NEXT_PUBLIC_FB_API_KEY=${NEXT_PUBLIC_FB_API_KEY}##NEXT_PUBLIC_FB_AUTH_DOMAIN=${NEXT_PUBLIC_FB_AUTH_DOMAIN}##NEXT_PUBLIC_FB_PROJECT_ID=${NEXT_PUBLIC_FB_PROJECT_ID}##NEXT_PUBLIC_FB_APP_ID=${NEXT_PUBLIC_FB_APP_ID}"
```

`firestore.rules` denies every direct client read and write. That is correct rather than
restrictive: no browser in this product touches Firestore, and the server reaches it through the
Admin SDK, which bypasses rules entirely. It is deployed on the live project. To publish it to a
project of your own without installing the Firebase CLI:

```sh
P=your-project-id; T=$(gcloud auth print-access-token)

# -f so a rejected POST fails loudly instead of piping an error body into the next call
RS=$(curl -fsS -X POST -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "Content-Type: application/json" \
  -d "$(python3 -c "import json;print(json.dumps({'source':{'files':[{'name':'firestore.rules','content':open('firestore.rules').read()}]}}))")" \
  "https://firebaserules.googleapis.com/v1/projects/$P/rulesets" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")

test -n "$RS" && curl -fsS -X POST -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "Content-Type: application/json" \
  -d "{\"name\":\"projects/$P/releases/cloud.firestore\",\"rulesetName\":\"$RS\"}" \
  "https://firebaserules.googleapis.com/v1/projects/$P/releases"
```

If a `cloud.firestore` release already exists, the second call is a `PATCH` to
`…/releases/cloud.firestore` rather than a `POST` to `…/releases`.

---

## Architecture

```mermaid
flowchart TB
  UI["Browser — Next.js client<br/>profile vault · wizard · review · board"]
  AUTH["Firebase Auth"]

  subgraph run ["Next.js on Cloud Run"]
    API["Route handlers<br/>every one calls requireUser first"]
    ADP["Adapters<br/>ashby · greenhouse · lever · generic"]
    FLOWS["Genkit flows<br/>profileIngest · reconcileFacts · jobInterpret<br/>formParse · clarifyDraft · answerDraft<br/>feedbackDistill · interviewInterpret · prepBrief<br/>resumeFindings · bulletRewrite · judgeFallback"]
  end

  FS["Firestore<br/>users/uid/applications/id/interviews/id"]
  GEM["Gemini 3.8 Flash"]
  ATS["ATS APIs<br/>Ashby · Greenhouse · Lever"]

  UI -->|"sign in"| AUTH
  UI -->|"fetch, Bearer ID token"| API
  API -->|"verifyIdToken"| AUTH
  API -->|"Admin SDK"| FS
  API --> ADP
  ADP -->|"fetch posting"| ATS
  API --> FLOWS
  FLOWS -->|"schema-constrained output"| GEM
```

The client never reads Firestore. It holds a Firebase Auth session, and every piece of data on
screen arrived through a route handler that verified the ID token first.

**Built with:** Gemini 3.8 Flash · Genkit · TypeSafe Jev · Cloud Run · Firestore · Firebase Auth ·
Next.js 16 · TypeScript · Tailwind

---

## Roadmap

- **Interview prep, the parts still to come.** Each round has its own page today, with a brief for
  its stage, a typed six-question mock and a debrief. Still to come: reading a *screenshot* of the
  notice, a mock interview you can talk to, and answering a round's open questions in place.
- **The cover letter, past the first draft.** A letter is set up, drafted with every claim cited,
  adjusted and exported as a PDF today, under a letterhead filled from the profile's contact
  details. Still to come: UK conventions, since the copy is en-US throughout; and a plain-text
  variant for the forms that want the letter pasted.
- **An AWS port**, to check that nothing here is load-bearing on one cloud.

## Built for

The **All Things Agentic** hackathon, *Collaborative Partner* category — an agent that does the
work with you rather than instead of you. Which is why the citations are the centre of it: an
answer you cannot check is not one you can put your name to.

## License

[MIT](LICENSE).
