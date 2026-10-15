// Recognition, research, and milestone data — the single source of truth for
// every page that mentions an award, the publication, or a headline number.
//
// Add a new honour by appending one entry to `AWARDS`. Nothing in the pages is
// hard-coded against a specific award: the featured slot, the ledger, the
// field-size chart, and the counts all follow from this file.
//
// Field contract (keep every entry consistent):
//   id            stable slug, used as a React key and an in-page anchor
//   rank          integer finishing position (drives sort order and numerals)
//   placement     short rank label exactly as it should be read → "3rd Place"
//   distinction   the longer form used under the numeral → "Third place"
//   finalist      true when the honour is a finalist placement, not a podium
//   event         official event name, as the organizer writes it
//   shortName     compact name for tight spaces (charts, the hero line)
//   year          the year the result was announced — no invented dates
//   kind          one-line description of the competition
//   participants  registered-participant count, used for the field-size chart
//   participantsShort  the chart label ("~" marks an approximate figure)
//   participantsLabel  the figure exactly as we are allowed to state it
//   sponsors      event sponsors, where relevant. These sponsored the event,
//                 not PromptFootprint — the UI says so wherever they appear.
//   description   1–2 sentences on what was recognized
//   links         [{ label, href }] — public pages, opened in a new tab
//   featured      exactly one entry sets this
//
// Every figure below was supplied by the team from the organizers' Devpost
// pages. Do not add participant counts, prize amounts, or partnerships that
// are not on those pages.

export const AWARDS = [
  {
    id: 'nextstep-hacks-2026',
    rank: 2,
    placement: '2nd Place',
    distinction: 'Second place overall',
    finalist: false,
    event: 'NextStep Hacks 2026',
    shortName: 'NextStep Hacks',
    year: '2026',
    kind: 'International hackathon',
    participants: 1033,
    participantsShort: '1,033+',
    participantsLabel: '1,033+ registered participants',
    sponsors: ['Claude (Anthropic)', 'NordVPN'],
    description:
      'PromptFootprint earned 2nd place at NextStep Hacks 2026, an international hackathon with more than 1,000 registered participants and sponsors including Claude and NordVPN. The recognition highlights our approach to making generative AI more efficient, accessible, and environmentally transparent.',
    links: [
      { label: 'View project', href: 'https://devpost.com/software/promptfootprint-0map6i' },
      { label: 'Competition', href: 'https://nextstep2026.devpost.com/' },
    ],
    featured: true,
  },
  {
    id: 'climate-changemakers-2026',
    rank: 3,
    placement: '3rd Place',
    distinction: 'Third place',
    finalist: false,
    event: 'The Climate Change-Makers Challenge 2026',
    shortName: 'Climate Change-Makers',
    year: '2026',
    kind: 'International environmental innovation competition',
    participants: 290,
    participantsShort: '~300',
    participantsLabel: 'Nearly 300 registered participants from 40+ countries',
    description:
      'PromptFootprint earned third place at an international climate innovation competition for developing a browser-based approach to measuring and reducing the environmental impact of everyday generative AI usage.',
    links: [
      { label: 'View project', href: 'https://devpost.com/software/prompt-footprint' },
      { label: 'Competition', href: 'https://climatechangemakers2026.devpost.com/' },
    ],
    featured: false,
  },
  {
    id: 'hoobit-hacks-2026',
    rank: 4,
    placement: '4th Place',
    distinction: 'Fourth place overall',
    finalist: false,
    event: 'Hoobit Hacks 2026',
    shortName: 'Hoobit Hacks',
    year: '2026',
    kind: 'International student hackathon',
    participants: 570,
    participantsShort: '570+',
    participantsLabel: '570+ registered participants',
    description:
      'PromptFootprint placed fourth overall at Hoobit Hacks 2026, an international hackathon with more than 570 registered participants, recognizing our work on AI efficiency and environmental impact transparency.',
    links: [
      { label: 'View project', href: 'https://devpost.com/software/promptfootprint' },
      { label: 'Competition', href: 'https://hoobit-hacks-2026.devpost.com/' },
    ],
    featured: false,
  },
  {
    id: 'hack-the-habitat-2026',
    rank: 7,
    placement: '7th Place Finalist',
    distinction: 'Seventh-place finalist',
    finalist: true,
    event: 'Hack the Habitat 2026',
    shortName: 'Hack the Habitat',
    year: '2026',
    kind: 'International environmental technology hackathon',
    participants: 325,
    participantsShort: '~325',
    participantsLabel: 'About 325 registered participants',
    description:
      'PromptFootprint was recognized as a seventh-place finalist at Hack the Habitat 2026, an international environmental technology hackathon with more than 300 registered participants, for its approach to reducing the environmental footprint of generative AI.',
    links: [
      { label: 'Competition', href: 'https://hack-the-habitat-2026.devpost.com/' },
    ],
    featured: false,
  },
]

/** Awards in display order: strongest finish first. */
export function rankedAwards(awards = AWARDS) {
  return [...awards].sort((a, b) => a.rank - b.rank)
}

/** The single spotlighted award; falls back to the strongest finish. */
export function featuredAward(awards = AWARDS) {
  return awards.find((a) => a.featured) || rankedAwards(awards)[0]
}

/**
 * Combined field size, rounded DOWN to the nearest thousand so the "+" is
 * always true even where a count is approximate ("nearly 300").
 */
export function combinedParticipantsFloor(awards = AWARDS) {
  const sum = awards.reduce((n, a) => n + (a.participants || 0), 0)
  return Math.floor(sum / 1000) * 1000
}

/** Two-digit placement numeral — "02", "07". */
export function placementNumeral(rank) {
  return String(rank).padStart(2, '0')
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']

/** "Four" — a count spelled out for prose; digits past ten. */
export function countWord(n) {
  return NUMBER_WORDS[n] || String(n)
}

/** "1st", "2nd", "3rd", "4th"… — the suffix only. */
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

// ── Research ────────────────────────────────────────────────────────────────
//
// Published in Vanderbilt University's Young Scientist Journal. Publication
// there is not a sponsorship, endorsement, or partnership — the copy that
// renders this must never imply otherwise.
//
// The intervention figures are PRELIMINARY results from a small test and must
// always be shown with that qualifier.

export const RESEARCH = {
  title:
    'A Token-Level Framework for Quantifying ChatGPT’s Environmental Impacts and a Browser-Based Intervention for Reducing Prompt Resource Use',
  journal: 'Young Scientist Journal',
  publisher: 'Vanderbilt University',
  author: 'Parasharami, S.',
  href: 'https://wp0.vanderbilt.edu/youngscientistjournal/article/a-token-level-framework-for-quantifying-chatgpts-environ-mental-impacts-and-a-browser-based-intervention-for-reducing-prompt-resource-use/',
  summary:
    'The paper examines the environmental consequences of large-language-model use and develops a framework that estimates the energy, cooling water, and carbon emissions behind each token. It then tests whether user-facing feedback, delivered in the browser, changes how efficiently people prompt.',
  measures: ['Energy consumption', 'Cooling water', 'Carbon emissions', 'Token-level resource impact', 'Effect of user feedback on prompt efficiency'],
  result: {
    reductionPct: 19,
    tokensBefore: 2274,
    tokensAfter: 1847,
    queriesBefore: 13,
    queriesAfter: 7,
    qualifier:
      'Preliminary testing. A small-scale result, not a guaranteed outcome — savings will vary from user to user.',
  },
}

// ── Milestones ──────────────────────────────────────────────────────────────
// Headline numbers used on the landing page and the recognition page. No live
// counters: these are stated milestones, updated by hand.

export const MILESTONES = {
  downloads: 150, // shown as "150+"
  downloadsLabel: 'Chrome downloads',
  recognitions: AWARDS.length,
  recognitionsLabel: 'International hackathon recognitions',
}
