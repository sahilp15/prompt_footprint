// Recognition data — the single source of truth for the Awards page.
//
// Add a new honour by appending one entry to `AWARDS`. Nothing in the page is
// hard-coded against a specific award, so the layout, the timeline, the
// featured slot, and the headline statistics all follow from this file.
//
// Field contract (keep every entry consistent):
//   id          stable slug, used as a React key and for deep links
//   placement   short rank label, title case      → "3rd Place"
//   rank        integer finishing position, used for the "best finish" stat
//   event       official event name, exactly as the organizer writes it
//   scope       one-line context: field size / reach
//   date        ISO-8601 date or year the result was announced
//   dateLabel   human-readable form of `date` shown in the UI
//   summary     one sentence, no trailing period stripped — full sentences only
//   description 2–3 sentences explaining what was recognized
//   highlights  short noun phrases (no trailing punctuation), sentence case
//   href        canonical public link, opened in a new tab
//   linkLabel   button text for `href`
//   featured    exactly one entry should set this
//
// Dates: only the announcement year is published by both organizers, so `date`
// is a year and `dateLabel` says so. Do not invent a more precise date.

export const AWARDS = [
  {
    id: 'hoobit-hacks-2026',
    placement: '4th Place',
    rank: 4,
    award: 'Winner — Fourth Place',
    event: 'Hoobit Hacks 2026',
    scope: 'International hackathon · 570+ participants',
    participants: 570,
    participantsLabel: '570+ participants',
    date: '2026',
    dateLabel: '2026',
    summary:
      'Placed fourth internationally against a field of more than 570 participants.',
    description:
      'PromptFootprint measures the energy, water, and CO₂ behind every ChatGPT and Claude prompt, then helps the user cut it. The submission was a complete, shipped product: a local-first Chrome extension, a token-level environmental model grounded in published research, and a writing assistant that reduces prompt size before the request is ever sent.',
    highlights: [
      'Shipped Chrome extension, not a prototype',
      'Token-level environmental model',
      'Local-first — no account required',
      'Prompt optimizer that measures what it saves',
    ],
    href: 'https://devpost.com/software/promptfootprint',
    linkLabel: 'View on Devpost',
    featured: false,
  },
  {
    id: 'climate-changemakers-2026',
    placement: '3rd Place',
    rank: 3,
    award: 'Winner — Third Place',
    event: 'The Climate Change-Makers Challenge 2026',
    scope: 'International challenge · nearly 300 participants from 40+ countries',
    participants: 290,
    participantsLabel: 'Nearly 300 participants',
    date: '2026',
    dateLabel: '2026',
    summary:
      'Placed third internationally among nearly 300 participants from more than 40 countries.',
    description:
      'Recognized for making the hidden environmental cost of everyday AI use visible and actionable — helping people understand and reduce the energy, water, and carbon footprint of their prompts. Every figure the extension reports traces back to a published source, and the limitations are stated alongside the numbers.',
    highlights: [
      'Published methodology with cited sources',
      'Energy, water, and CO₂ per prompt',
      'Reach across 40+ countries',
      'Open source under the MIT license',
    ],
    href: 'https://devpost.com/software/prompt-footprint',
    linkLabel: 'View on Devpost',
    featured: true,
  },
]

/** The single spotlighted award; falls back to the strongest finish. */
export function featuredAward(awards = AWARDS) {
  return awards.find((a) => a.featured) || [...awards].sort((a, b) => a.rank - b.rank)[0]
}

/**
 * Headline statistics derived from `AWARDS` — never hard-coded, so they stay
 * true when an award is added. `caption` names the source of each figure so the
 * page never implies a broader claim than the data supports.
 */
export function awardStats(awards = AWARDS) {
  const best = [...awards].sort((a, b) => a.rank - b.rank)[0]
  const competitors = awards.reduce((sum, a) => sum + (a.participants || 0), 0)
  return [
    {
      id: 'awards',
      value: awards.length,
      suffix: '',
      label: 'International awards',
      caption: 'Hackathon and challenge placements',
    },
    {
      id: 'best',
      value: best.rank,
      suffix: ordinalSuffix(best.rank),
      label: 'Best finish',
      caption: best.event,
    },
    {
      id: 'competitors',
      value: competitors,
      suffix: '+',
      label: 'Competitors',
      caption: 'Across both events combined',
    },
    {
      id: 'countries',
      value: 40,
      suffix: '+',
      label: 'Countries represented',
      caption: 'Climate Change-Makers Challenge 2026',
    },
  ]
}

/** "1st", "2nd", "3rd", "4th"… — the suffix only, for the counter animation. */
export function ordinalSuffix(n) {
  const abs = Math.abs(Math.trunc(n))
  const lastTwo = abs % 100
  if (lastTwo >= 11 && lastTwo <= 13) return 'th'
  switch (abs % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}
