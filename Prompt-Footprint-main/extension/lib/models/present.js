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
  const RSN = (typeof PFReasoning !== 'undefined') ? PFReasoning : require('./reasoning.js');
  const OBSV = (typeof PFModelObservation !== 'undefined') ? PFModelObservation : require('./observation.js');

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
    'reasoning-control': 'reasoning control label',
    'response-metadata': 'response metadata',
    aria: 'accessible name',
    'provider-default': 'provider default',
    unknown: 'not detected',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * The one line that names the model.
   *
   * The rule this encodes: WHICH MODEL IS SELECTED and WHAT IT COSTS are
   * different questions with different confidences. An unrecognised label is
   * still a perfectly well-known selection — the product just showed it to us —
   * so it is displayed exactly as written. It used to be rendered as
   * `Unknown model — "GPT-7.2 Nimbus"`, which reads as doubt about something we
   * are not in doubt about. The uncertainty belongs on the estimate, where
   * `estimateBasis` puts it.
   *
   * Auto is the one case where we genuinely do not know the model, because
   * ChatGPT does not expose the routing decision. That says so, and never
   * resolves itself into a model name.
   */
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
    if (o.selectedLabel) return o.selectedLabel;
    return 'No model detected';
  }

  /**
   * The compact "GPT-5.6 Sol · High reasoning" line for the in-page pill.
   * Returns null when there is nothing verified to show — an empty pill is
   * better than a speculative one.
   */
  function pillLabel(obs) {
    const o = obs || {};
    if (!o.selectedLabel && !o.canonicalModel && !o.effectiveModel) return null;
    const parts = [modelLabel(o)];
    const reasoning = RSN.displayLabel(RSN.describe(o, o.reasoningLabel));
    if (reasoning) parts.push(reasoning);
    return parts.join(' · ');
  }

  function reasoningLabel(obs) {
    const o = obs || {};
    if (!o.reasoningMode || o.reasoningMode === 'unknown') return 'not exposed';
    const locked = o.reasoningLockedBy ? ' (fixed by the model)' : '';
    const raw = o.reasoningLabel ? ` — shown as “${o.reasoningLabel}”` : '';
    const cls = RSN.classify(o.reasoningMode);
    return `${o.reasoningMode}${cls && cls !== o.reasoningMode ? ` (${cls})` : ''}${locked}${raw}`;
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
    add('Canonical model', o.canonicalModel ||
      (o.selectedLabel ? 'not in the registry — estimate uses the provider fallback' : 'none detected'));
    if (o.effectiveModel) add('Effective model', o.effectiveModel, 'Reported by the provider for this response.');
    add('Detected via', SOURCE_NAME[o.source] || o.source);
    add('Detection confidence', o.confidence != null ? `${Math.round(o.confidence * 100)}%` : '—');
    add('Routing', o.routing === 'auto' ? 'auto (backend not exposed)' : o.routing);
    add('Reasoning / effort', reasoningLabel(o));
    if (o.reasoningSource) add('Reasoning detected via', SOURCE_NAME[o.reasoningSource] || o.reasoningSource);
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

  /**
   * The developer/debug view: everything detection currently believes, plus the
   * signals it believed it from.
   *
   * Separate from `expandedRows` because the audiences are different. That view
   * explains a number to a sceptical user; this one exists so a detection bug
   * can be diagnosed from a screenshot, which means it shows the losing
   * candidates too — a wrong answer is usually a scoring problem, and the score
   * of the runner-up is the evidence for that.
   */
  function debugRows(obs, detector) {
    const o = obs || {};
    const d = detector || {};
    const detected = OBSV.toDetectedModel(o);
    const at = new Date(detected.detectedAt || Date.now());
    const clock = at.toTimeString ? at.toTimeString().slice(0, 8) : '—';

    const rows = [
      ['Provider', PROVIDER_NAME[detected.provider] || detected.provider],
      ['Product', detected.product],
      ['Surface', SURFACE_NAME[detected.surface] || detected.surface],
      ['Detected model', modelLabel(o)],
      ['Canonical', detected.canonicalModelId || '— not in registry'],
      ['Family / variant', [detected.family, detected.variant].filter(Boolean).join(' / ') || '—'],
      ['Selected mode', detected.selectedMode],
      ['Effective model', detected.effectiveModel || '— not exposed'],
      ['Reasoning (raw)', detected.reasoningModeLabel || detected.reasoningEffortLabel || '— not exposed'],
      ['Reasoning (class)', detected.reasoningClass || '— not exposed'],
      ['Reasoning locked by', detected.reasoningLockedBy || '—'],
      ['Tools', detected.tools.length ? detected.tools.join(', ') : 'none'],
      ['Detection source', SOURCE_NAME[detected.detectionSource] || detected.detectionSource],
      ['Verified', detected.verified ? 'yes' : 'no'],
      ['Estimate basis', detected.estimateBasis],
      ['Detection confidence', `${Math.round((detected.confidence || 0) * 100)}%`],
      ['Last change', clock],
      ['Generation', String(detected.generation)],
      ['Conversation', detected.conversationKey || '—'],
      ['Catalog version', `${CAT.schemaVersion} (${CAT.updatedAt})`],
    ];
    if (d.observedRoots != null) rows.push(['Observed roots', String(d.observedRoots)]);
    rows.push(['Signals', detected.rawEvidence.length ? detected.rawEvidence.join(' · ') : 'none captured']);
    return rows.map(([label, value]) => ({ label, value }));
  }

  // ── Naming what we actually know, for the token analyzer ──────────────────
  //
  // The token analyzer needs a different sentence from the environmental panel.
  // That panel answers "what will this cost the planet"; this one answers "whose
  // tokenizer am I counting with, and how sure are you". Those have different
  // failure modes, and the one that matters here is claiming a model we cannot
  // prove — because the tokenizer follows from the model, so a confidently wrong
  // model produces a confidently wrong count.
  //
  // The four honest states, in the order they are checked:
  //
  //   routed          "ChatGPT Auto — exact routed model unavailable"
  //   detected        "Claude Sonnet 5 — detected"
  //   named-unmapped  "GPT-7.2 Nimbus — detected, not in the registry"
  //   unknown         "OpenAI model — estimated tokenization"

  const PRODUCT_NAME = {
    chatgpt: 'ChatGPT',
    'custom-gpt': 'ChatGPT (custom GPT)',
    'claude-web': 'Claude',
    'gemini-web': 'Gemini',
    gem: 'Gemini (Gem)',
  };

  /**
   * Provider -> product -> detected label -> family -> tokenizer, as a chain.
   *
   * Returned as data rather than a formatted string so the panel, the debug
   * rows, and the tests all read the same values. Every field is either
   * something the page told us or `null`; nothing here is inferred.
   */
  function detectionChain(obs, breakdown) {
    const o = obs || {};
    const b = breakdown || {};
    const meta = o.canonicalModel ? CAT.modelMeta(o.provider, o.canonicalModel) : null;
    let state = 'unknown';
    if (o.routing === 'auto') state = 'routed';
    else if (o.canonicalModel) state = 'detected';
    else if (o.selectedLabel) state = 'named-unmapped';

    return {
      provider: PROVIDER_NAME[o.provider] || PROVIDER_NAME.unknown,
      providerId: o.provider || 'unknown',
      product: PRODUCT_NAME[o.surface] || PROVIDER_NAME[o.provider] || 'Unknown product',
      uiLabel: o.selectedLabel || null,
      canonicalModel: o.canonicalModel || null,
      family: meta ? meta.family : null,
      tokenizer: b.tokenizer || null,
      method: b.method || null,
      confidence: b.confidence || null,
      state,
    };
  }

  /**
   * The one line naming the model, written so it can never overstate.
   *
   * Auto is the case this exists for. ChatGPT's router does not expose which
   * model handled a request, so "Auto" is the complete truth and resolving it
   * into a model name would be a fabrication — one that would then silently
   * select a tokenizer and a context window.
   */
  function tokenModelLine(obs) {
    const o = obs || {};
    if (o.effectiveModel) {
      const meta = CAT.modelMeta(o.provider, o.effectiveModel);
      return `${meta ? meta.label : o.effectiveModel} — reported by the provider`;
    }
    if (o.routing === 'auto') {
      const product = PRODUCT_NAME[o.surface] || PROVIDER_NAME[o.provider] || 'This product';
      return `${product} Auto — exact routed model unavailable`;
    }
    if (o.canonicalModel) {
      const meta = CAT.modelMeta(o.provider, o.canonicalModel);
      return `${meta ? meta.label : o.canonicalModel} — detected`;
    }
    if (o.selectedLabel) return `${o.selectedLabel} — detected, not in the registry`;
    const provider = PROVIDER_NAME[o.provider];
    return provider && o.provider !== 'unknown'
      ? `${provider.replace(/^ChatGPT$/, 'OpenAI')} model — estimated tokenization`
      : 'Model not detected — generic estimate';
  }

  /**
   * The accuracy line under the breakdown.
   *
   * Names the WEAKEST thing in the total, because that is what decides how much
   * the number can be trusted — and a PDF's visual half is almost always it.
   */
  function accuracyLine(breakdown) {
    const b = breakdown || {};
    const parts = b.parts || [];
    const pdf = parts.find((p) => p.kind === 'pdf');
    const unreadable = parts.filter((p) => p.unreadable);
    const opaque = parts.find((p) => p.kind === 'opaque' || p.kind === 'unknown');

    if (unreadable.length) {
      return `Estimated — ${unreadable.length} attachment${unreadable.length === 1 ? '' : 's'} `
        + 'could not be read and are not included';
    }
    if (pdf) return 'Estimated — PDF totals include document and visual processing';
    if (opaque) return 'Estimated — a compressed document is estimated from its size, not read';
    if (b.confidence === 'high') {
      return `Estimated — counted locally with the ${b.tokenizer || 'detected'} tokenizer`;
    }
    if (b.method === 'generic-estimate') return 'Rough estimate — provider not identified';
    return 'Estimated — model not identified exactly, so the tokenizer is a best match';
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
      // Test-time compute is the single largest lever on an interaction's energy,
      // so a reasoning switch is called out as a reason the number moved even
      // when the model itself did not change.
      const from = RSN.classify(previous.reasoningMode);
      const to = RSN.classify(current.reasoningMode);
      if (from !== to) parts.push(`That is a different reasoning class (${from || 'not exposed'} → ${to || 'not exposed'}).`);
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
    PRODUCT_NAME,
    detectionChain,
    tokenModelLine,
    accuracyLine,
    escapeHtml,
    modelLabel,
    pillLabel,
    reasoningLabel,
    toolsLabel,
    collapsedSummary,
    expandedRows,
    debugRows,
    changeExplanation,
  };

  if (root) root.PFModelPresent = PFModelPresent;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFModelPresent;
})(typeof self !== 'undefined' ? self : this);
