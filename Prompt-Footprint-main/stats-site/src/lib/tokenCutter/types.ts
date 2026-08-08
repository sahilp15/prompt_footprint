// Token Cutter — shared type vocabulary.
// ---------------------------------------------------------------------------
// Every stage of the pipeline speaks in these types. Keeping them in one file
// means a change to the contract is a change to one place, and it makes the
// data flow readable end to end:
//
//   text ──▶ protect ──▶ segment ──▶ structure ──▶ detectors ──▶ Suggestion[]
//                                                       │
//                              accepted edits ◀─────────┘
//                                     │
//                                     ▼
//                             apply ──▶ validate ──▶ CutterResult

/** A half-open character range `[start, end)` in the original text. */
export interface Range {
  start: number
  end: number
}

// ── Protection ──────────────────────────────────────────────────────────────

/** Categories of text the cutter must never rewrite without explicit consent. */
export type ProtectedKind =
  | 'code-block'
  | 'inline-code'
  | 'url'
  | 'email'
  | 'json'
  | 'quote'
  | 'placeholder'
  | 'markdown'
  | 'math'
  | 'number'
  | 'date'
  | 'file-path'
  | 'memory-term'

export interface ProtectedSpan extends Range {
  kind: ProtectedKind
  text: string
  /** Why this span is protected, shown verbatim in the UI. */
  reason: string
}

// ── Segmentation and prompt structure ───────────────────────────────────────

/** The role a sentence plays inside a prompt. */
export type SegmentRole =
  | 'role'        // "You are a senior editor."
  | 'task'        // the thing to actually do
  | 'context'     // background the model needs
  | 'constraint'  // limits: length, tone, must/must-not
  | 'example'     // illustrative input/output
  | 'format'      // required output shape
  | 'question'    // a direct question
  | 'meta'        // politeness, greetings, sign-off

export interface Segment extends Range {
  text: string
  role: SegmentRole
  /** Index of the block (paragraph / list item / fence) this sentence sits in. */
  blockIndex: number
  /** True when the whole segment lies inside a protected span. */
  protectedSegment: boolean
}

export interface Block extends Range {
  text: string
  kind: 'paragraph' | 'list-item' | 'heading' | 'code' | 'blank'
}

// ── Entities and constraints (the semantic-safety contract) ─────────────────

export type EntityKind =
  | 'number'
  | 'date'
  | 'url'
  | 'email'
  | 'file-type'
  | 'technology'
  | 'proper-noun'
  | 'quoted'
  | 'negation'
  | 'length-limit'
  | 'imperative'   // explicit must / must not

export interface Entity {
  kind: EntityKind
  /** Normalized form used for comparison (lower-cased, whitespace-collapsed). */
  key: string
  /** The text as it appeared, for display. */
  text: string
}

export type ConstraintKind =
  | 'length'
  | 'tone'
  | 'format'
  | 'audience'
  | 'deadline'
  | 'inclusion'
  | 'exclusion'
  | 'language'

export interface Constraint extends Range {
  kind: ConstraintKind
  /** Normalized identity — two constraints with the same key are duplicates. */
  key: string
  text: string
  label: string
}

// ── Suggestions ─────────────────────────────────────────────────────────────

/** Why a change is being proposed. Drives the badge and the explanation copy. */
export type SuggestionCategory =
  | 'repeated-instruction'
  | 'filler'
  | 'wordy-phrase'
  | 'grammar'
  | 'spelling'
  | 'redundant-example'
  | 'sentence-merge'
  | 'ambiguous'
  | 'politeness'
  | 'transition'
  | 'hedge'
  | 'whitespace'
  /** A verbose instruction wrapper around an intact instruction ("make sure that you …"). */
  | 'instruction-collapse'
  /** Talk *about* the request rather than part of it ("hope that makes sense"). */
  | 'meta-commentary'

export type Confidence = 'high' | 'medium' | 'low'

/** Aggressiveness tiers. Each suggestion declares the lowest tier it belongs to. */
export type OptimizationLevel = 'light' | 'balanced' | 'maximum'

export interface Suggestion extends Range {
  id: string
  category: SuggestionCategory
  /** Text currently at `[start, end)`. */
  original: string
  /** What to put in its place. Empty string means "delete". */
  replacement: string
  /** Short label, e.g. "Unnecessary filler". */
  title: string
  /** One sentence explaining the recommendation to the user. */
  reason: string
  confidence: Confidence
  /** Numeric confidence 0–1; `confidence` is the bucketed form. */
  score: number
  /** Lowest optimization level at which this is proposed. */
  minLevel: OptimizationLevel
  /** Safe changes are pre-accepted; unsafe ones start rejected. */
  safe: boolean
  /** Estimated tokens this edit removes (never negative). */
  tokensSaved: number
  /** Set when a memory entry caused or protected this suggestion. */
  memoryId?: string
  /** Set when the change is informational only (no text edit is possible). */
  advisory?: boolean
}

/** A suggestion plus the user's decision about it. */
export interface SuggestionDecision {
  id: string
  accepted: boolean
}

// ── Diff ────────────────────────────────────────────────────────────────────

export type DiffKind = 'equal' | 'removed' | 'added' | 'protected'

export interface DiffPart {
  kind: DiffKind
  text: string
  /** The suggestion that produced this part, when applicable. */
  suggestionId?: string
}

// ── Validation ──────────────────────────────────────────────────────────────

export type LossSeverity = 'critical' | 'warning'

export interface ValidationIssue {
  severity: LossSeverity
  kind: EntityKind | 'constraint'
  /** The item that went missing, as it appeared in the original. */
  text: string
  message: string
  /** The suggestion responsible, when it can be attributed. */
  suggestionId?: string
}

export interface ValidationReport {
  /** True only when no critical information was lost. */
  ok: boolean
  /** 0–1. 1 means every tracked entity and constraint survived. */
  meaningScore: number
  issues: ValidationIssue[]
  preservedEntities: number
  preservedConstraints: number
  totalEntities: number
  totalConstraints: number
  /** True when the report was actually computed (never assume equivalence). */
  validated: true
}

// ── Analytics ───────────────────────────────────────────────────────────────

export interface ImpactFigures {
  energyWh: number
  waterMl: number
  co2G: number
}

export interface CutterAnalytics {
  originalWords: number
  optimizedWords: number
  originalTokens: number
  optimizedTokens: number
  tokensSaved: number
  percentReduction: number
  saved: ImpactFigures
  /** 0–100; higher is easier to read. */
  readability: number
  readabilityDelta: number
  preservedConstraints: number
  protectedTerms: number
  suggestionsAccepted: number
  suggestionsRejected: number
  suggestionsTotal: number
}

// ── Prompt explanation ──────────────────────────────────────────────────────

export interface PromptExplanation {
  task: string
  audience: string
  tone: string
  format: string
  intent: string
  constraints: Constraint[]
  entities: Entity[]
  /** Instructions that contradict each other, surfaced for the user to fix. */
  conflicts: string[]
  /** Roughly how the prompt is organized. */
  sections: { role: SegmentRole; count: number }[]
}

// ── Memory ──────────────────────────────────────────────────────────────────

export type MemoryCategory =
  | 'tone'
  | 'length'
  | 'format'
  | 'style'
  | 'terminology'
  | 'project'
  | 'never-remove'
  | 'always-apply'

export interface MemoryEntry {
  id: string
  category: MemoryCategory
  /** What to remember, in the user's own words. */
  value: string
  /** Words that make this memory relevant to a prompt. */
  triggers: string[]
  /** 1–5; higher wins when memories compete. */
  importance: number
  enabled: boolean
  createdAt: number
  updatedAt: number
  /** Times this memory has influenced an optimization. */
  useCount: number
  /** Set for entries the cutter proposed itself rather than the user typing. */
  source: 'user' | 'learned'
}

export interface MemoryState {
  /** Master switch. When false, no memory is read or written. */
  enabled: boolean
  entries: MemoryEntry[]
}

/** A memory that actually applied to the current text, with the reason shown. */
export interface AppliedMemory {
  id: string
  category: MemoryCategory
  value: string
  effect: string
}

// ── Options and results ─────────────────────────────────────────────────────

export type ProcessingMode = 'local' | 'enhanced'

/**
 * What the cutter knows about the model the prompt is about to be sent to.
 *
 * Used for ONE thing: the final readability decision. A dense, telegraphic
 * rewrite is safe for a frontier model and risky for one we cannot identify, so
 * an unrecognised target keeps a little more explicit structure. It never
 * changes which information survives — that is the validator's job, and the
 * validator does not know or care what model is selected.
 */
export interface TargetModel {
  provider: string
  /** Canonical id, or null when the picker label is not in the registry. */
  canonicalModel: string | null
  /** Exactly what the product showed, even when unrecognised. */
  label: string | null
  tier: string | null
  /** Normalized reasoning class, when the product exposes one. */
  reasoningClass: string | null
  /** False when the label is unmapped — density is dialled back, not the content. */
  known: boolean
}

export interface CutterOptions {
  level: OptimizationLevel
  /** Platform id for the environmental model. */
  platform: 'chatgpt' | 'claude'
  memory: MemoryState
  /** Allow rewriting inside quotes/code. Off by default. */
  allowProtectedEdits: boolean
  /** Target model for the final readability check. Null when unknown. */
  targetModel?: TargetModel | null
  /** Refinement rounds after the first. 0 disables iterative compression. */
  maxRefinementPasses?: number
}

// ── Iterative compression ───────────────────────────────────────────────────

/**
 * One edit made by a refinement round.
 *
 * Rounds after the first operate on the *previous round's output*, so their
 * offsets do not address the original text and they are deliberately NOT
 * returned as `Suggestion`s: a Suggestion is something the user can toggle, and
 * toggling something whose coordinates refer to a string that only exists
 * mid-pipeline is not a coherent offer. They are reported instead.
 */
export interface RefinementEdit {
  pass: number
  category: SuggestionCategory
  title: string
  reason: string
  original: string
  replacement: string
  tokensSaved: number
}

export interface RefinementPass {
  pass: number
  tokensBefore: number
  tokensAfter: number
  edits: RefinementEdit[]
  /** Set when the round was computed and then discarded. */
  rejected?: 'validation' | 'no-gain'
}

// ── Concision ───────────────────────────────────────────────────────────────

/** The seven independent conditions that must ALL hold for "already concise". */
export interface ConcisionChecks {
  /** No sentence or clause restates an earlier one. */
  noRepetition: boolean
  /** No filler, politeness, hedge, or wordy construction is left. */
  noFiller: boolean
  /** No two instructions can safely be combined. */
  notMergeable: boolean
  /** Whitespace and formatting carry no spare tokens. */
  formattingTight: boolean
  /** No verbose instruction wrapper or empty framing remains. */
  noVerboseFraming: boolean
  /** The reduction actually available is negligible. */
  savingsNegligible: boolean
  /** Another full pass finds nothing more. */
  convergedOnRepeat: boolean
}

export interface ConcisionReport {
  /** True only when every check above is true. */
  concise: boolean
  checks: ConcisionChecks
  /** Human-readable reasons the prompt is NOT concise, most valuable first. */
  reasons: string[]
  /** Edits still on the table at this level that were not applied. */
  residualOpportunities: number
  /** Tokens the residual opportunities would remove. */
  residualTokens: number
  /**
   * Information density: the share of tokens carrying task, constraint, or
   * entity content. Length-independent by construction — a 25-token prompt and
   * a 1,000-token prompt are scored the same way.
   */
  density: number
}

// ── What changed, in the user's terms ───────────────────────────────────────

export interface ChangeSummaryItem {
  label: string
  count: number
}

export interface ChangeSummary {
  removed: ChangeSummaryItem[]
  preserved: ChangeSummaryItem[]
  /** True when the validator ran and passed. */
  verified: boolean
}

export interface CutterResult {
  original: string
  /** Original with every *accepted* suggestion applied. */
  optimized: string
  suggestions: Suggestion[]
  /** Ids accepted by default (safe + at or below the chosen level). */
  defaultAccepted: string[]
  protectedSpans: ProtectedSpan[]
  segments: Segment[]
  constraints: Constraint[]
  entities: Entity[]
  explanation: PromptExplanation
  validation: ValidationReport
  analytics: CutterAnalytics
  appliedMemories: AppliedMemory[]
  mode: ProcessingMode
  /**
   * Refinement rounds run after the toggleable suggestion set was applied.
   * Empty when the first pass already converged.
   */
  refinements: RefinementPass[]
  /** Whether this prompt is genuinely as short as it can usefully be. */
  concision: ConcisionReport
  /** What was removed and what was checked as preserved. */
  changeSummary: ChangeSummary
  /** Populated when the enhanced path ran; describes what it contributed. */
  enhancement?: EnhancementReport
}

// ── Optional Gemini enhancement ─────────────────────────────────────────────

export interface EnhancementReport {
  /** Whether the remote call produced a usable result. */
  applied: boolean
  /** Human-readable status, always safe to display. */
  status: string
  /** Reason the local result was kept, when `applied` is false. */
  fallbackReason?: string
  /** 0–1 self-reported by the model, only shown alongside local validation. */
  meaningScore?: number
  preservedConstraints?: string[]
  removedRedundancies?: string[]
  uncertainChanges?: string[]
  protectedContent?: string[]
}

/** The exact JSON shape the proxy must return. Anything else is rejected. */
export interface EnhancementResponse {
  optimized: string
  preservedConstraints: string[]
  removedRedundancies: string[]
  uncertainChanges: string[]
  protectedContent: string[]
  meaningScore: number
}
