import type { Application, InterviewRound, PrepBrief, Profile } from '@/lib/types'

/**
 * One invented candidate, one invented posting, one invented interview — the product with
 * something in it.
 *
 * An empty product does not demonstrate this one. The whole claim is that an answer is
 * grounded in cited facts, that the agent asks rather than guesses, and that a hard gate gets
 * an honest verdict — none of which is visible until there is a profile to cite, a posting to
 * be screened by, and a question that could not be answered without asking. So this file
 * builds that world: Tom Candidate, a backend engineer who is a strong fit for a payments role
 * except in one stated way, mid-way through applying for it.
 *
 * It is a pure function of the clock, which is the only reason it can be tested. Everything
 * dated is derived from `now`, so a seed loaded in December is not a seed with an interview
 * that happened in August, and `tests/sampleWorld.test.ts` can hold the whole thing to the
 * invariants the live flows enforce: fact ids in sequence, citations whose spans appear
 * verbatim in the text they mark, standard answers in the one canonical form their control
 * round-trips, drafts inside their own stated limits.
 *
 * Everyone and every employer in it is invented. The technologies are real because a resume
 * with invented technologies would read as nonsense.
 */

/** The company name the sample writes. The route refuses to write a second one under it. */
export const SAMPLE_COMPANY = 'Marram Systems'

export interface SampleWorld {
  profile: Profile
  /** `createdAt` is carried, not stamped on write — `listApplications` orders by it. */
  application: Omit<Application, 'id'>
  /** `createdAt` is deliberately absent: `createInterview` stamps it. */
  interview: Omit<InterviewRound, 'id' | 'createdAt'>
}

const DAY = 86_400_000

const shift = (from: Date, days: number) => new Date(from.getTime() + days * DAY).toISOString()

/** The posting, as it would arrive from the adapter — the text every parse below reads. */
const JD = `Marram Systems — Senior Backend Engineer, Payments
Seattle, WA · Hybrid · Full-time

About us
Marram Systems builds settlement infrastructure for freight brokers. Money moves
between four parties on every load we touch, and it moves late, in the wrong
order, and occasionally twice. We are the ledger that makes it come out right.
We are forty people. The payments team is six.

The role
You will own the write path of our ledger. Today it is a Postgres table with a
trigger on it and eleven years of good intentions; by the end of next year it
needs to be a double-entry ledger that can be reconciled without a human. You
would be the fourth engineer on that rewrite and the one accountable for it not
losing money while it happens.

What you would work on
- The ledger rewrite: schema, migration path, and the reconciliation job.
- Our event bus. We moved to Kafka last year and the consumers have not caught up.
- Settlement latency. Brokers watch it, and it is currently the loudest complaint.
- The on-call rotation, one week in six, shared with the rest of the team.

What we are looking for
- 5+ years building backend services in production.
- Strong Postgres. You should be comfortable reasoning about isolation levels.
- Experience with a double-entry ledger, or comparable financial systems.
- Go, or a demonstrated ability to be productive in it within a month.
- Two days a week in our Seattle office. This is not negotiable for this role;
  the payments team pairs on Tuesdays and Wednesdays and that is where the
  ledger decisions get made.

Nice to have
- Kafka, or another log-based event bus, at a scale where ordering mattered.
- Having been on-call for something that handled other people's money.

How we hire
A 30-minute call with our recruiter, a 90-minute technical conversation with two
engineers, and a half-day on-site in Seattle. We pay for travel. We do not do
take-home exercises.

Compensation
$150,000–$185,000 base, plus equity. We publish bands and we do not negotiate
off them.

Marram Systems is an equal opportunity employer.`

function buildProfile(now: Date): Profile {
  return {
    facts: [
      {
        id: 'f1',
        claim: 'Tom Candidate',
        sourceSnippet: 'Tom Candidate',
        tags: ['contact', 'name'],
      },
      {
        id: 'f2',
        claim: 'tom.candidate@example.com',
        sourceSnippet: 'tom.candidate@example.com',
        tags: ['contact', 'email'],
      },
      {
        id: 'f3',
        claim: 'Portland, Oregon',
        sourceSnippet: 'Portland, Oregon',
        tags: ['contact', 'location'],
      },
      {
        id: 'f4',
        claim: 'B.S. Computer Science from Cascadia State University, 2018',
        sourceSnippet: 'Cascadia State University — B.S. Computer Science, 2018',
        tags: ['education', 'degree'],
      },
      {
        id: 'f5',
        claim: 'Graduated with a 3.6 GPA',
        sourceSnippet: 'GPA 3.6',
        tags: ['education', 'gpa'],
      },
      {
        id: 'f6',
        claim: 'Senior Backend Engineer at Northwind Logistics since March 2024',
        sourceSnippet: 'Northwind Logistics - Senior Backend Engineer, March 2024 - present',
        tags: ['experience', 'role'],
      },
      {
        id: 'f7',
        claim:
          'Owns the payments service at Northwind Logistics, which handles 12,000 requests a day at a 99.95% success rate',
        sourceSnippet:
          'Owns the payments service: 12,000 requests/day at a 99.95% success rate.',
        tags: ['experience', 'payments', 'ownership'],
      },
      {
        id: 'f8',
        claim: 'Cut p99 checkout latency from 840ms to 210ms by batching ledger writes',
        sourceSnippet: 'Cut p99 checkout latency from 840ms to 210ms by batching ledger writes.',
        tags: ['experience', 'performance'],
      },
      {
        id: 'f9',
        claim: 'Led the migration of 14 services from RabbitMQ to Kafka',
        sourceSnippet: 'Led the migration of 14 services from RabbitMQ to Kafka.',
        tags: ['experience', 'migration'],
      },
      {
        id: 'f10',
        claim: 'Mentors two junior engineers at Northwind Logistics',
        sourceSnippet: 'Mentors two junior engineers.',
        tags: ['experience', 'mentorship'],
      },
      {
        id: 'f11',
        claim: 'Backend Engineer at Fenwick Software from June 2018 to November 2022',
        sourceSnippet: 'Fenwick Software - Backend Engineer, June 2018 - November 2022',
        tags: ['experience', 'role'],
      },
      {
        id: 'f12',
        claim:
          'Built the internal billing API at Fenwick Software and reduced the monthly close from 6 days to 2',
        sourceSnippet:
          'Built the internal billing API used by 40 people across finance and support. Reduced the monthly close from 6 days to 2.',
        tags: ['experience', 'billing'],
      },
      {
        id: 'f13',
        claim:
          'Wrote Tidepool, an open-source CLI that diffs Postgres schemas between environments, which has 1,200 GitHub stars',
        sourceSnippet:
          'Tidepool — an open-source CLI that diffs Postgres schemas between environments. 1,200 GitHub stars. Written in Go.',
        tags: ['projects', 'oss'],
      },
      {
        id: 'f14',
        claim: 'Works in Go, Python, PostgreSQL, Kafka, Terraform and gRPC',
        sourceSnippet: 'Go, Python, PostgreSQL, Kafka, Terraform, gRPC',
        tags: ['skills', 'languages'],
      },
      {
        id: 'f15',
        claim: 'Runs services on AWS (ECS, RDS, SQS) with Datadog for observability',
        sourceSnippet: 'AWS (ECS, RDS, SQS), Datadog',
        tags: ['skills', 'cloud'],
      },
    ],

    // Each value is in the one canonical form its control serializes back to — an answer that
    // is not would land the profile screen on a bare text input instead of the right control.
    standardAnswers: {
      work_authorization: 'Yes',
      visa_sponsorship_needed: 'No',
      relocation: 'Depends — for the right team, and inside the Pacific Northwest',
      remote_onsite_preference: 'Remote, Hybrid',
      earliest_start_date: 'UNKNOWN',
      notice_period: '2 weeks',
      salary_expectation: '$145,000 per year',
      security_clearance: 'UNKNOWN',
    },

    voiceRules: [
      {
        rule: 'Lead with the number, then the mechanism. Never the adjective.',
        evidence:
          'You replaced “dramatically improved checkout performance” with “cut p99 checkout latency from 840ms to 210ms by batching ledger writes”.',
        createdAt: shift(now, -9),
      },
      {
        rule: 'Say what you own in the first sentence. Cut “passionate about” and “leverage”.',
        evidence:
          'You rewrote “passionate about leveraging distributed systems at scale” as “I own the payments service”.',
        createdAt: shift(now, -6),
      },
    ],

    gaps: [
      'Your documents stop at Fenwick in November 2022 and pick up at Northwind in March 2024. Applications will ask what happened in between.',
      'Nothing in your documents says whether you would move for a job, or how far. Every hybrid posting turns on it.',
    ],
  }
}

/**
 * The drafted answer. The citation spans below are substrings of this text — the test checks
 * that verbatim, because a span that has drifted out of the prose underlines nothing at all.
 */
const Q1_DRAFT = `I own the payments service at Northwind Logistics, which handles 12,000 requests a day at a 99.95% success rate. The part I changed was checkout. Ledger writes went one row at a time and p99 sat at 840ms; I batched them and it came down to 210ms. We watched it on the same dashboard the on-call rotation reads, so the people who would have been paged for a regression were the people who could see it had not happened. The year before that I led the migration of 14 services from RabbitMQ to Kafka, which is where most of what I know about ordering under load comes from. I would bring the same habit to a ledger rewrite: move one write path at a time, keep the old one readable while it runs, and let reconciliation say when it is safe to go on.`

const Q2_DRAFT = `You are rewriting a ledger that is currently a Postgres table with a trigger on it, and that is the work I have actually done: I own the payments service at Northwind Logistics and cut p99 checkout latency from 840ms to 210ms by batching ledger writes. A team of six is small enough that the person who writes the migration is the person who gets paged for it, which is how I would rather work than not.`

const Q2_FINAL = `You are rewriting a ledger that is currently a Postgres table with a trigger on it. That is the work I have done: I own the payments service at Northwind Logistics, and I cut p99 checkout latency from 840ms to 210ms by batching ledger writes. A team of six is small enough that whoever writes the migration is the one who gets paged for it. That is how I would rather work.`

function buildApplication(now: Date): Omit<Application, 'id'> {
  const created = shift(now, -12)

  return {
    company: SAMPLE_COMPANY,
    role: 'Senior Backend Engineer, Payments',
    jdRaw: JD,
    sourceUrl: 'https://jobs.ashbyhq.com/marram-systems/senior-backend-engineer-payments',
    adapter: 'ashby',

    parsed: {
      company: SAMPLE_COMPANY,
      role: 'Senior Backend Engineer, Payments',
      roleFacts: [
        'Payments team of six inside a forty-person company',
        'Owns the write path of a ledger being rewritten as double-entry over the next year',
        'Postgres and Go, with Kafka as the event bus',
        'On-call one week in six',
        'Published band: $150,000–$185,000 base plus equity, not negotiated off',
      ],
      gates: [
        {
          requirement: '5+ years building backend services in production',
          met: 'yes',
          posture: 'explicit',
          note: 'Fenwick from June 2018 to November 2022, Northwind from March 2024 — comfortably past five.',
        },
        {
          requirement: 'Two days a week in the Seattle office',
          met: 'no',
          posture: 'explicit',
          note: 'The posting says “this is not negotiable for this role”. Your profile says Portland, and relocation is “Depends”.',
        },
        {
          requirement: 'Experience with a double-entry ledger',
          met: 'unclear',
          posture: 'escape-clause',
          note: 'The posting adds “or comparable financial systems”. Payments and billing work is in the profile; a double-entry ledger is not named in it.',
        },
      ],
      themes: [
        'ledger correctness under migration',
        'event-driven systems where ordering matters',
        'a small team where the author is the on-call',
      ],
      scope: 'per-application',
      advisory:
        'Apply, and address the office gate in your own words rather than leaving it to be found. One gate is unmet and it is stated explicitly, not softened: two days a week in Seattle, called not negotiable. Portland to Seattle is inside the region your profile says you would move within, so this is a decision you can make rather than a wall. The other two gates are met or arguable, and the escape clause on the ledger requirement — “or comparable financial systems” — is the opening your payments and billing work fits through.',
    },

    questions: [
      {
        q: 'Tell us about a system you have owned end to end. What did you change about it, and how did you know it worked?',
        constraints: { limit: 150, unit: 'words', type: 'long-text', required: true },
        draft: {
          text: Q1_DRAFT,
          citations: [
            {
              claimSpan:
                'I own the payments service at Northwind Logistics, which handles 12,000 requests a day at a 99.95% success rate',
              factId: 'f7',
            },
            { claimSpan: 'I batched them and it came down to 210ms', factId: 'f8' },
            { claimSpan: 'led the migration of 14 services from RabbitMQ to Kafka', factId: 'f9' },
          ],
        },
        askHuman: [],
        clarify: [
          {
            id: 'c1',
            question: 'Which system should this answer be about?',
            why: 'Three are true and only one fits in 150 words. The payments service is the one this posting screens for; the Kafka migration is the larger number.',
            options: [
              { label: 'The payments service at Northwind', value: 'payments' },
              { label: 'The RabbitMQ to Kafka migration', value: 'kafka' },
              { label: 'The billing API at Fenwick', value: 'billing' },
            ],
            recommended: 'payments',
            allowMultiple: false,
            allowOther: true,
          },
          {
            id: 'c2',
            question: 'How much of the reliability story should this carry?',
            why: 'The posting is about money coming out right, not about latency. Leading with the latency number is the sharper opening; leading with correctness is the closer fit.',
            options: [
              { label: 'Lead with the latency number', value: 'latency' },
              { label: 'Lead with what could not go wrong', value: 'correctness' },
              { label: 'Both, latency first', value: 'both' },
            ],
            recommended: 'both',
            allowMultiple: false,
            allowOther: true,
          },
        ],
        clarifyAnswers: [
          {
            id: 'c1',
            question: 'Which system should this answer be about?',
            answer: ['payments'],
          },
        ],
        status: 'drafted',
      },
      {
        q: 'Why Marram Systems?',
        constraints: { limit: 100, unit: 'words', type: 'long-text', required: true },
        draft: {
          text: Q2_DRAFT,
          citations: [
            { claimSpan: 'I own the payments service at Northwind Logistics', factId: 'f7' },
            {
              claimSpan: 'cut p99 checkout latency from 840ms to 210ms by batching ledger writes',
              factId: 'f8',
            },
          ],
        },
        askHuman: [],
        final: Q2_FINAL,
        status: 'final',
      },
      {
        q: 'This role requires two days a week in our Seattle office. Can you meet that, and from when?',
        constraints: { limit: 300, unit: 'chars', type: 'short-text', required: true },
        askHuman: [
          {
            question:
              'Would you move to Seattle for this role, or would you want to ask for the two days to be something else?',
            why: 'Your profile says Portland, and relocation is “Depends — for the right team, and inside the Pacific Northwest”. Seattle is inside that region, so this is answerable — but whether you would actually move, and by when, is yours to decide. The posting calls the requirement not negotiable, so a vague answer here reads as a no.',
          },
        ],
        status: 'pending',
      },
    ],

    status: 'interviewing',
    timeline: [
      { event: 'created', at: created },
      { event: 'status → applied', at: shift(now, -11) },
      { event: 'status → interviewing', at: shift(now, -4) },
    ],
    createdAt: created,
  }
}

/**
 * The brief prepBrief would write for this round, had the seed spent two model calls on it.
 * Everything in it is derived from the rest of this file rather than invented alongside it:
 * the topics come off the parsed posting's roleFacts, the angles name the facts by id, the
 * rehearsal lines are four of the profile's claims quoted verbatim (the test holds them to
 * that), and the single red flag is the one gate the parse marked unmet — the Seattle office
 * days — addressed the way the prompt demands: honestly, not dodged.
 */
const PREP_BRIEF: PrepBrief = {
  likelyTopics: [
    'Why this role rather than another. The ledger rewrite is the job, and a recruiter opens by asking what you make of it.',
    'Whether you have carried a write path in production — that is what this role owns from day one.',
    'The two office days in Seattle. A recruiter screen is where that gets settled, not the offer call.',
    'Compensation, against a published band the posting says it does not negotiate off.',
  ],
  questionsToPrepare: [
    {
      q: 'Tell me about yourself — what are you working on now?',
      angle:
        'f6 and f7: Senior Backend Engineer at Northwind since March 2024, owning the payments service. Open on what you own, not on the title.',
    },
    {
      q: 'What draws you to a ledger rewrite specifically?',
      angle:
        'f8 — batching ledger writes is the closest thing in your bank to the work they are hiring for. Say what it taught you about ordering, not that you find it exciting.',
    },
    {
      q: 'You are in Portland. How do you feel about two days a week in Seattle?',
      angle:
        'Your own standard answer: you would move for the right team, inside the Pacific Northwest. Portland to Seattle is inside that. Say the true answer, then ask which two days.',
    },
    {
      q: 'What does your timeline look like?',
      angle:
        'Notice period is two weeks. Your earliest start date is one of the two things your profile still does not know — do not invent one on the call.',
    },
  ],
  questionsToAsk: [
    'Six people on payments inside a forty-person company — who owns reconciliation today, and who gets paged when it disagrees?',
    'The rewrite is a year of work. What has to be true at the end of it for you to call it done?',
    'On-call is one week in six. What does a bad week look like right now?',
    'The band is published and you say you do not negotiate off it. What moves somebody from one end of it to the other?',
  ],
  factsToRehearse: [
    'Owns the payments service at Northwind Logistics, which handles 12,000 requests a day at a 99.95% success rate',
    'Cut p99 checkout latency from 840ms to 210ms by batching ledger writes',
    'Led the migration of 14 services from RabbitMQ to Kafka',
    'Built the internal billing API at Fenwick Software and reduced the monthly close from 6 days to 2',
  ],
  redFlags: [
    'Two days a week in Seattle, and the posting calls it not negotiable. You are in Portland, and your own answer on moving is “depends, for the right team, inside the Pacific Northwest”. Say that plainly and early — a recruiter screen is the cheapest place in the process for it to come up, and the worst place is the offer call.',
  ],
}

function buildInterview(now: Date): Omit<InterviewRound, 'id' | 'createdAt'> {
  // One instant, used twice. The email proposes a time and `datetime` is what the strip and the
  // .ics export read, so the two have to be the same moment — derived separately, the stored one
  // is just whenever the seed was loaded, and west of UTC it can land on the day before the one
  // the email names. 17:00 UTC is 10:00 Pacific daylight time, the hour the email says (09:00
  // under winter standard time — this is a demo seed, not a scheduling system).
  const call = new Date(now.getTime() + 5 * DAY)
  call.setUTCHours(17, 0, 0, 0)
  const at = call.toISOString()

  return {
    noticeRaw: `Hi Tom — thanks for applying to the Senior Backend Engineer, Payments role.
I would like to set up a 30-minute intro call. Does ${at.slice(0, 10)} at 10:00 PT work?
I will send a video link once you confirm. It is just me on this one; the technical
conversation with two of our engineers would be the round after.

Ana Reyes
Recruiting, Marram Systems`,
    roundType: 'recruiter-screen',
    datetime: at,
    people: ['Ana Reyes — Recruiting'],
    prepBrief: PREP_BRIEF,
    chat: [],
  }
}

/** The whole sample world, derived from one clock so every date in it stays plausible. */
export function buildSampleWorld(now: Date = new Date()): SampleWorld {
  return {
    profile: buildProfile(now),
    application: buildApplication(now),
    interview: buildInterview(now),
  }
}
