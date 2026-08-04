// User memory — transparent, local, and optional.
// ---------------------------------------------------------------------------
// The point of memory is to stop the user restating the same preference every
// time ("keep my paragraph breaks", "never shorten the client's name"). The
// point of *this* implementation is that they can always see what is stored,
// why it fired, and turn any of it off.
//
// Rules the design enforces:
//   • Stored locally. `localStorage` in the web build, `chrome.storage.local`
//     in the extension dashboard. Nothing is transmitted, ever.
//   • Nothing is remembered without an explicit action. Learned suggestions are
//     proposed, not saved.
//   • Memory never overrides the current prompt. Relevance selects a small set;
//     a preference that contradicts what the user just wrote is dropped.
//   • Every application is reported back through `AppliedMemory`, so the UI can
//     say exactly which memory changed the result.

import type {
  AppliedMemory, Constraint, MemoryCategory, MemoryEntry, MemoryState,
} from './types.ts'

const STORAGE_KEY = 'pf_cutter_memory'
const MAX_ENTRIES = 200

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  tone: 'Preferred tone',
  length: 'Preferred length',
  format: 'Formatting preference',
  style: 'Writing style',
  terminology: 'Recurring terminology',
  project: 'Project or person',
  'never-remove': 'Never remove',
  'always-apply': 'Always apply',
}

/** Categories whose entries protect text rather than change it. */
const PROTECTIVE: ReadonlySet<MemoryCategory> = new Set<MemoryCategory>([
  'never-remove', 'terminology', 'project',
])

export function emptyMemory(): MemoryState {
  return { enabled: true, entries: [] }
}

// ── Storage ─────────────────────────────────────────────────────────────────
// A tiny adapter so the same module works in the extension dashboard (where
// `chrome.storage.local` is the project's convention) and on the public web
// build (where it is not available). Both are on-device.

interface ChromeLike {
  storage?: { local?: { get(keys: string[], cb: (r: Record<string, unknown>) => void): void; set(items: Record<string, unknown>, cb?: () => void): void } }
}

function chromeStorage(): ChromeLike['storage'] | null {
  const g = globalThis as unknown as { chrome?: ChromeLike }
  return g.chrome?.storage?.local ? g.chrome.storage : null
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Partial<MemoryEntry>
  return typeof e.id === 'string'
    && typeof e.value === 'string'
    && typeof e.category === 'string'
    && Array.isArray(e.triggers)
}

/** Coerce untrusted stored JSON into a valid state, dropping anything odd. */
export function normalizeMemory(raw: unknown): MemoryState {
  if (!raw || typeof raw !== 'object') return emptyMemory()
  const r = raw as Partial<MemoryState>
  const entries = Array.isArray(r.entries) ? r.entries.filter(isMemoryEntry) : []
  return {
    enabled: r.enabled !== false,
    entries: entries.slice(0, MAX_ENTRIES).map((e) => ({
      ...e,
      triggers: e.triggers.filter((t): t is string => typeof t === 'string').slice(0, 24),
      importance: clampImportance(e.importance),
      enabled: e.enabled !== false,
      useCount: Number.isFinite(e.useCount) ? e.useCount : 0,
      createdAt: Number.isFinite(e.createdAt) ? e.createdAt : Date.now(),
      updatedAt: Number.isFinite(e.updatedAt) ? e.updatedAt : Date.now(),
      source: e.source === 'learned' ? 'learned' : 'user',
    })),
  }
}

function clampImportance(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 3
  return Math.min(5, Math.max(1, Math.round(v)))
}

export async function loadMemory(): Promise<MemoryState> {
  const storage = chromeStorage()
  if (storage?.local) {
    return new Promise((resolve) => {
      storage.local!.get([STORAGE_KEY], (res) => resolve(normalizeMemory(res?.[STORAGE_KEY])))
    })
  }
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    return normalizeMemory(raw ? JSON.parse(raw) : null)
  } catch {
    // Private mode, disabled storage, or corrupt JSON — start clean rather
    // than break the page.
    return emptyMemory()
  }
}

export async function saveMemory(state: MemoryState): Promise<void> {
  const clean = normalizeMemory(state)
  const storage = chromeStorage()
  if (storage?.local) {
    return new Promise((resolve) => storage.local!.set({ [STORAGE_KEY]: clean }, () => resolve()))
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // Quota or private mode. Memory is a convenience, never a hard dependency.
  }
}

// ── Entry construction ──────────────────────────────────────────────────────

let idCounter = 0

export function createMemoryEntry(
  category: MemoryCategory,
  value: string,
  options: { triggers?: string[]; importance?: number; source?: 'user' | 'learned' } = {},
): MemoryEntry {
  const now = Date.now()
  idCounter += 1
  return {
    id: `m${now.toString(36)}${idCounter.toString(36)}`,
    category,
    value: value.trim(),
    triggers: (options.triggers ?? deriveTriggers(category, value)).map((t) => t.toLowerCase()),
    importance: clampImportance(options.importance ?? defaultImportance(category)),
    enabled: true,
    createdAt: now,
    updatedAt: now,
    useCount: 0,
    source: options.source ?? 'user',
  }
}

function defaultImportance(category: MemoryCategory): number {
  if (category === 'never-remove') return 5
  if (category === 'always-apply' || category === 'project') return 4
  return 3
}

/**
 * Trigger words for an entry the user did not supply them for.
 *
 * Content words from the value itself, which is what makes relevance work
 * without asking the user to think about matching.
 */
export function deriveTriggers(category: MemoryCategory, value: string): string[] {
  // Protective entries match on their own literal text — "Acme Corp" should
  // fire on "Acme Corp", not on the word "corp" anywhere.
  if (PROTECTIVE.has(category)) return [value.trim().toLowerCase()]

  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'my', 'i', 'is', 'be', 'use', 'always', 'never', 'prefer'])
  return [...new Set(
    value.toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )].slice(0, 8)
}

// ── Relevance ───────────────────────────────────────────────────────────────

export interface RelevanceInput {
  text: string
  constraints: Constraint[]
}

/**
 * The memories that actually apply to this prompt.
 *
 * Three gates, in order:
 *   1. Enabled — both the master switch and the entry's own toggle.
 *   2. Relevant — a trigger appears in the text, or the category is one that
 *      always applies to prompt optimization (formatting and style).
 *   3. Not overridden — the current prompt states a constraint of the same
 *      kind, so what the user just wrote wins.
 */
export function relevantMemories(state: MemoryState, { text, constraints }: RelevanceInput): MemoryEntry[] {
  if (!state.enabled) return []
  const lower = text.toLowerCase()

  const statedKinds = new Set(constraints.map((c) => c.kind))
  const OVERRIDE_MAP: Partial<Record<MemoryCategory, string>> = {
    tone: 'tone',
    length: 'length',
    format: 'format',
  }

  const scored = state.entries
    .filter((e) => e.enabled && e.value.trim())
    .map((e) => ({ entry: e, score: relevanceScore(e, lower) }))
    .filter(({ entry, score }) => {
      if (score <= 0) return false
      const overrides = OVERRIDE_MAP[entry.category]
      // The prompt in front of us always beats a stored preference.
      if (overrides && statedKinds.has(overrides as Constraint['kind'])) return false
      return true
    })
    .sort((a, b) => b.score - a.score || b.entry.importance - a.entry.importance)

  // Cap the set so a large memory bank can never dominate a short prompt.
  return scored.slice(0, 6).map((s) => s.entry)
}

function relevanceScore(entry: MemoryEntry, lowerText: string): number {
  // Style and formatting preferences are about how the *output* should look, so
  // they are relevant to any prompt — but only weakly, so a triggered entry
  // always outranks them.
  const ambient = entry.category === 'format' || entry.category === 'style' || entry.category === 'always-apply'
  let score = ambient ? 0.4 : 0

  for (const trigger of entry.triggers) {
    if (trigger.length < 2) continue
    const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(lowerText)) {
      score += 1
    }
  }

  return score * (0.6 + entry.importance * 0.08)
}

// ── Application ─────────────────────────────────────────────────────────────

/** Literal terms the protection stage must guard, drawn from memory. */
export function neverRemoveTerms(memories: MemoryEntry[]): string[] {
  return memories
    .filter((m) => PROTECTIVE.has(m.category))
    .map((m) => m.value.trim())
    .filter((v) => v.length >= 2)
}

/**
 * What each applied memory did, phrased for the UI.
 *
 * The `effect` strings are the whole point of the feature being transparent:
 * "Preserved paragraph formatting based on your preferences" beats a silent
 * behavior change every time.
 */
export function describeApplied(memories: MemoryEntry[], protectedHits: number): AppliedMemory[] {
  return memories.map((m) => ({
    id: m.id,
    category: m.category,
    value: m.value,
    effect: effectFor(m, protectedHits),
  }))
}

function effectFor(m: MemoryEntry, protectedHits: number): string {
  switch (m.category) {
    case 'never-remove':
      return protectedHits > 0
        ? `Protected “${m.value}” from being removed, based on your preferences.`
        : `“${m.value}” is protected whenever it appears.`
    case 'terminology':
    case 'project':
      return `Kept “${m.value}” exactly as written, based on your preferences.`
    case 'format':
      return `Preserved your formatting preference: ${m.value}.`
    case 'style':
      return `Matched your writing style preference: ${m.value}.`
    case 'tone':
      return `Your usual tone (${m.value}) was not restated — this prompt does not set one.`
    case 'length':
      return `Your usual length preference (${m.value}) applies; this prompt does not set one.`
    case 'always-apply':
      return `Applied your standing instruction: ${m.value}.`
    default:
      return m.value
  }
}

// ── Learning suggestions ────────────────────────────────────────────────────

/**
 * Preferences the cutter noticed but did NOT save.
 *
 * Offering these is the transparent alternative to silent learning: the user
 * sees what was inferred and chooses whether it becomes a memory.
 */
export function proposeMemories(constraints: Constraint[], existing: MemoryEntry[]): MemoryEntry[] {
  const known = new Set(existing.map((e) => `${e.category}|${e.value.toLowerCase()}`))
  const out: MemoryEntry[] = []
  const seen = new Set<string>()

  const MAP: Partial<Record<Constraint['kind'], MemoryCategory>> = {
    tone: 'tone', length: 'length', format: 'format', audience: 'style', language: 'style',
  }

  for (const c of constraints) {
    const category = MAP[c.kind]
    if (!category) continue
    const value = c.text.trim()
    // De-duplicate on the constraint KEY, not the wording: "keep it under 200
    // words" and "200 words" are one preference stated twice, and offering both
    // makes the panel look broken.
    if (known.has(`${category}|${value.toLowerCase()}`) || seen.has(c.key)) continue
    seen.add(c.key)
    // Prefer the fuller phrasing when the same key appears again later.
    out.push(createMemoryEntry(category, value, { source: 'learned' }))
    if (out.length >= 3) break
  }

  return out
}

// ── Import / export ─────────────────────────────────────────────────────────

export function exportMemory(state: MemoryState): string {
  return JSON.stringify({ version: 1, exportedAt: Date.now(), ...normalizeMemory(state) }, null, 2)
}

/** Parse an exported file. Throws with a readable message on bad input. */
export function importMemory(json: string): MemoryState {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const state = normalizeMemory(parsed)
  if (!state.entries.length) throw new Error('No memories were found in that file.')
  return state
}
