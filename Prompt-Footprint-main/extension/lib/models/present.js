// PromptFootprint — presenting a model observation + estimate
// ---------------------------------------------------------------------------
// Pure formatting shared by the in-page panel and the popup, so the two surfaces
// cannot disagree about what the extension currently believes.
//
// The wording rules it enforces:
//   • an unresolved model reads "Unknown model", never a flagship's name;
//   • Auto routing reads "Auto — effective model not exposed";
//   • energy is a RANGE with an evidence badge, never a lone number;
//   • cooling water and full-operational water are separate rows;
//   • before send, nothing is called a saving.

(function (root) {
  'use strict';

  const EST = (typeof PFEstimator !== 'undefined') ? PFEstimator : require('../estimator.js');
  const COPY = (typeof PFEnvCopy !== 'undefined') ? PFEnvCopy : require('../env/copy.js');
  const CAT = (typeof PFModelCatalog !== 'undefined') ? PFModelCatalog : require('./catalog.js');

  const PROVIDER_NAME = {
    openai: 'ChatGPT',
    anthropic: 'Claude',
    google: 'Gemini',
    unknown: 'Unknown provider',
  };

  const SURFACE_NAME = {
    'custom-gpt': 'Custom GPT',
    gem: 'Gem',
    'claude-web': 'Claude',
    chatgpt: 'ChatGPT',
    'gemini-web': 'Gemini',
  };

  const SOURCE_NAME = {
    'selected-menu-item': 'selected menu option',
    'picker-label': 'model picker label',
    'response-metadata': 'response metadata',
    aria: 'accessible name',
    'provider-default': 'provider default',
    unknown: 'not detected',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** The one line that names the model, uncertainty included. */
  function modelLabel(obs) {
    const o = obs || {};
    if (o.effectiveModel) {
      const meta = CAT.modelMeta(o.provider, o.effectiveModel);
      return `${meta ? meta.label : o.effectiveModel} (effective)`;
    }
    if (o.routing === 'auto') return 'Auto — effective model not exposed';
    if (o.canonicalModel) {
      const meta = CAT.modelMeta(o.provider, o.canonicalModel);
      return meta ? meta.label : o.canonicalModel;
    }
    if (o.selectedLabel) return `Unknown model — "${o.selectedLabel}"`;
    return 'Unknown model';
  }

  function reasoningLabel(obs) {
    const o = obs || {};
    if (!o.reasoningMode || o.reasoningMode === 'unknown') return 'not exposed';
    const locked = o.reasoningLockedBy ? ' (fixed by the model)' : '';
    return `${o.reasoningMode}${locked}`;
  }

  function toolsLabel(obs) {
    const tools = (obs && obs.tools) || [];
    return tools.length ? tools.join(', ') : 'none detected';
  }

  /** Compact view for the collapsed popup row / in-page pill. */
  function collapsedSummary(obs, estimate, extra) {
    const o = obs || {};
    const x = extra || {};
    const f = estimate ? EST.formatEstimate(estimate) : null;
    return {
      provider: PROVIDER_NAME[o.provider] || PROVIDER_NAME.unknown,
      surface: SURFACE_NAME[o.surface] || null,
      model: modelLabel(o),
      unknownModel: !o.canonicalModel && !o.effectiveModel,
      routing: o.routing,
      inputTokens: x.inputTokens != null ? x.inputTokens : null,
      tokensAvoided: x.tokensAvoided != null ? x.tokensAvoided : null,
      tokensAvoidedLabel: COPY.PRE_SEND_LABELS.tokensAvoided,
      energyRange: f ? f.energy : '—',
      energyLabel: estimate && estimate.phase === 'complete'
        ? COPY.POST_RESPONSE_LABELS.footprint
        : COPY.PRE_SEND_LABELS.projectedRange,
      evidence: f ? f.evidence : null,
      evidenceLabel: f ? f.evidenceLabel : null,
      confidence: f ? f.confidence : null,
      lowerBound: !!(estimate && estimate.lowerBound),
    };
  }

  /**
   * The expanded detail rows. Every claim in here is paired with where it came
   * from — the point of the expanded view is that a sceptical user can check it.
   */
  function expandedRows(obs, estimate) {
    const o = obs || {};
    const est = estimate;
    const f = est ? EST.formatEstimate(est) : null;
    const rows = [];
    const add = (label, value, hint) => { if (value != null && value !== '') rows.push({ label, value, hint }); };

    add('Selected label', o.selectedLabel || 'none detected');
    add('Canonical model', o.canonicalModel || 'unmapped — kept as unknown');
    if (o.effectiveModel) add('Effective model', o.effectiveModel, 'Reported by the provider for this response.');
    add('Detected via', SOURCE_NAME[o.source] || o.source);
    add('Detection confidence', o.confidence != null ? `${Math.round(o.confidence * 100)}%` : '—');
    add('Routing', o.routing === 'auto' ? 'auto (backend not exposed)' : o.routing);
    add('Reasoning / effort', reasoningLabel(o));
    add('Tools / modes', toolsLabel(o));
    if (o.surface && SURFACE_NAME[o.surface] && o.surface !== 'chatgpt' && o.surface !== 'claude-web' && o.surface !== 'gemini-web') {
      add('Surface', SURFACE_NAME[o.surface], 'A configuration, not a model identity.');
    }

    if (est) {
      const outObserved = est.outputTokens && est.outputTokens.observed;
      add('Input tokens', String(est.inputTokens));
      add('Output tokens', outObserved
        ? String(Math.round(est.outputTokens.central))
        : `assumed ~${Math.round(est.outputTokens.central)} (not known yet)`);
      add('Scenario', `${est.scenario} / ${est.reasoningClass}`);
      add('Energy', f.energy, `Evidence: ${f.evidenceLabel} · confidence ${f.confidence}`);
      add('Carbon', f.carbon, est.carbon ? `Scope: ${est.carbon.scope}. ${est.carbon.appliesWithin}` : null);
      if (est.carbonReference) {
        add('Carbon reference', `${EST.formatRange(est.carbonReference, 'g CO2e')} (${est.carbonReference.accounting})`,
          `Shown separately, not merged: ${est.carbonReference.appliesWithin}`);
      }
      // Two water rows, never one. They measure different things.
      add('Water — cooling', f.waterCooling, est.water.cooling ? est.water.cooling.appliesWithin : est.water.fullOperationalNote);
      add('Water — full operational', f.waterFullOperational, est.water.fullOperational ? est.water.fullOperational.appliesWithin : null);
      add('Water — as reported', f.waterReported, est.water.reported ? est.water.reported.appliesWithin : null);
      if (est.productAnchor) {
        add('Provider anchor', `${est.productAnchor.energyWh} Wh (${est.productAnchor.evidence.toLowerCase()})`, est.productAnchor.warning);
      }
      add('Estimate basis', est.profileId, `Catalog ${est.modelSnapshotId}`);
      add('Evidence as of', f.sourceDate);
      add('Sources', f.citations.join(' · '));
    }
    return rows;
  }

  /** Why the number just moved — shown after a model/mode change. */
  function changeExplanation(previous, current, prevEstimate, nextEstimate) {
    if (!previous) return null;
    const from = modelLabel(previous);
    const to = modelLabel(current);
    const parts = [];
    if (from !== to) parts.push(`Model changed from ${from} to ${to}.`);
    if (previous.reasoningMode !== current.reasoningMode) {
      parts.push(`Reasoning/effort changed from ${reasoningLabel(previous)} to ${reasoningLabel(current)}.`);
    }
    const prevTools = (previous.tools || []).join(',');
    const nextTools = (current.tools || []).join(',');
    if (prevTools !== nextTools) parts.push(`Tools changed from [${prevTools || 'none'}] to [${nextTools || 'none'}].`);
    // Only report the number moving if it actually moved. A switch between two
    // models whose bands overlap exactly is still worth naming, but claiming the
    // range "moved" from a value to the same value is noise.
    if (prevEstimate && nextEstimate) {
      const from = EST.formatRange(prevEstimate.energyWh, 'Wh');
      const to = EST.formatRange(nextEstimate.energyWh, 'Wh');
      if (from !== to) parts.push(`Projected range moved from ${from} to ${to}.`);
    }
    if (!parts.length) return null;
    parts.push('Messages already sent keep the model they were sent with.');
    return parts.join(' ');
  }

  const PFModelPresent = {
    PROVIDER_NAME,
    SURFACE_NAME,
    SOURCE_NAME,
    escapeHtml,
    modelLabel,
    reasoningLabel,
    toolsLabel,
    collapsedSummary,
    expandedRows,
    changeExplanation,
  };

  if (root) root.PFModelPresent = PFModelPresent;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFModelPresent;
})(typeof self !== 'undefined' ? self : this);
