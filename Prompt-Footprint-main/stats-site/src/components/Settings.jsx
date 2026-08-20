import { useEffect, useState } from 'react'
import { Keyboard, Shield, PencilLine, Server, Check } from 'lucide-react'
import { fetchConfig, saveConfig, resolveWritingProvider, isExtensionContext } from '../lib/api'
import Account from './Account'
import './Settings.css'

export default function Settings() {
  const [cfg, setCfg] = useState(null)
  const [proxyUrl, setProxyUrl] = useState('')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const extension = isExtensionContext()

  useEffect(() => {
    fetchConfig().then((c) => {
      setCfg(c)
      setProxyUrl(c.proxyUrl || '')
      setGeminiApiKey(c.geminiApiKey || '')
    })
  }, [])

  if (!cfg) return <div className="settings-page"><div className="page-header"><h1 className="page-title">Settings</h1></div></div>

  const provider = resolveWritingProvider({ ...cfg, proxyUrl, geminiApiKey })
  const cloudOn = cfg.cloudAnalysisEnabled === true && provider === 'gemini'

  async function update(patch) {
    const next = await saveConfig(patch)
    setCfg(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1 className="page-title">Settings &amp; Privacy</h1>
        <p className="page-subtitle">Configure the writing assistant and review how your data is handled</p>
      </div>

      {!extension && (
        <div className="settings-note">
          You're viewing the public demo. Open this page from the PromptFootprint
          extension (popup → “View Full Stats”) to change your real settings.
        </div>
      )}

      {/* ── Account (optional) ──────────────────────────────────────────── */}
      <Account />

      {/* ── AI writing help ─────────────────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-head">
          <PencilLine size={18} /><h2>AI writing help</h2>
          <span className={`settings-pill ${cloudOn ? 'on' : 'off'}`}>
            {cloudOn ? 'Cloud on' : 'Local only'}
          </span>
        </div>
        <p className="settings-desc">
          PromptFootprint checks your writing on-device by default — spelling,
          grammar, filler, repetition, and overly long sentences, with nothing
          leaving your browser. For deeper suggestions that read the whole prompt
          for meaning and clarity, you can turn on an optional <strong>cloud
          analysis</strong> layer powered by Gemini. It stays off until you enable
          it below.
        </p>

        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={cfg.cloudAnalysisEnabled === true}
            disabled={!extension}
            onChange={(e) => update({ cloudAnalysisEnabled: e.target.checked })}
          />
          <span>
            Enable cloud analysis — send the draft you’re typing to Gemini
            <strong> when you pause</strong>, to get a meaning-aware rewrite.
            Off by default; your text never leaves the device while this is off.
          </span>
        </label>
        <p className="settings-help">
          Requires a Worker URL (or an advanced key) below. When enabled, the
          current draft is sent on a typing pause, rate-limited, and never stored.
          If the service is unavailable or rate-limited, PromptFootprint silently
          falls back to the on-device checker.
        </p>

        <label className="settings-field">
          <span className="settings-label"><Server size={14} /> Cloudflare Worker URL</span>
          <input
            type="url"
            placeholder="https://promptfootprint-proxy.yourname.workers.dev"
            value={proxyUrl}
            disabled={!extension}
            onChange={(e) => setProxyUrl(e.target.value)}
            onBlur={() => update({ proxyUrl })}
          />
          <span className="settings-help">
            Recommended. The Worker keeps the Gemini API key server-side. See
            <code> proxy/README.md</code>. Leave blank for local-only mode.
          </span>
        </label>

        <details className="settings-advanced">
          <summary>Advanced: use your own Gemini API key</summary>
          <label className="settings-field">
            <span className="settings-label">Gemini API key (stored on this device only)</span>
            <input
              type="password"
              placeholder="AIza…"
              value={geminiApiKey}
              disabled={!extension}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              onBlur={() => update({ geminiApiKey })}
            />
            <span className="settings-help settings-warn">
              Not recommended: a key entered here is kept in <code>chrome.storage.local</code>
              on this device and used directly from your browser. Anyone with
              access to your machine could read it. Prefer the Worker proxy.
            </span>
          </label>
        </details>
        {saved && <div className="settings-saved"><Check size={14} /> Saved</div>}
      </section>

      {/* ── Writing editor ──────────────────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-head">
          <PencilLine size={18} /><h2>Writing editor</h2>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={cfg.writingChecksEnabled !== false}
            disabled={!extension}
            onChange={(e) => update({ writingChecksEnabled: e.target.checked })}
          />
          <span>Show spelling, grammar &amp; clarity suggestions while typing</span>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={cfg.overlayEnabled !== false}
            disabled={!extension}
            onChange={(e) => update({ overlayEnabled: e.target.checked })}
          />
          <span>Show the floating capsule overlay on chat pages</span>
        </label>
      </section>

      {/* ── Keyboard shortcuts ──────────────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-head">
          <Keyboard size={18} /><h2>Keyboard shortcuts</h2>
        </div>
        <ul className="settings-keys">
          <li><kbd>Alt</kbd> + <kbd>P</kbd> — open / close the main PromptFootprint panel</li>
          <li>Drag the floating capsule anywhere; its position is remembered across reloads</li>
          <li>Drag the stats panel’s top-left corner to resize it — the size is remembered too</li>
          <li>The capsule stays keyboard-operable: focus it and press <kbd>Enter</kbd> / <kbd>Space</kbd></li>
        </ul>
      </section>

      {/* ── Privacy ─────────────────────────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-head">
          <Shield size={18} /><h2>Privacy</h2>
        </div>
        <div className="settings-privacy">
          <p><strong>Local-first by design.</strong> PromptFootprint estimates the
            environmental impact of your AI chats and helps you write tighter
            prompts. There is no remote backend for your data.</p>
          <table className="settings-table">
            <thead><tr><th>Data</th><th>Stored where</th><th>Leaves device?</th></tr></thead>
            <tbody>
              <tr><td>Token counts, timing, energy/water/CO₂ metrics</td><td><code>chrome.storage.local</code></td><td>No</td></tr>
              <tr><td>Anonymous install ID, settings, realized savings</td><td><code>chrome.storage.local</code></td><td>No</td></tr>
              <tr><td><strong>Prompt / response text</strong></td><td>Not stored</td><td>No</td></tr>
              <tr><td>Local spell, grammar, clarity &amp; repetition checks</td><td>In-browser (Typo.js + dictionary)</td><td>No</td></tr>
              <tr><td>Cloud analysis (only if you turn it on above)</td><td>Draft sent to your Worker → Gemini</td><td><strong>Yes, when enabled</strong></td></tr>
              <tr><td>Heatwave location (only if you choose one)</td><td>Rounded ~11 km coordinate + label, on device</td><td><strong>Coordinate → Open-Meteo for weather</strong></td></tr>
              <tr><td>Account name &amp; synced summaries (only if you sign in)</td><td>Supabase (numbers only, never prompt text)</td><td><strong>Yes, when signed in</strong></td></tr>
            </tbody>
          </table>
          <p><strong>When text leaves the device:</strong> only if you turn on
            cloud analysis. Then the draft you are typing is sent — when you pause,
            debounced and rate-limited — to the Cloudflare Worker URL you configured,
            which forwards it to Gemini and returns a suggestion. It is not stored by
            PromptFootprint. If cloud analysis is off, or the Worker is missing,
            failing, or rate-limited, the extension silently falls back to the
            offline checker.</p>
          <p><strong>Location &amp; weather.</strong> The heatwave estimate is
            optional. If you choose a location on the “How it Works” page, only a
            rounded coordinate (about 11 km — never your exact position) and a place
            label are kept on this device, and the coordinate (or the city/ZIP you
            type) is sent to <strong>Open-Meteo</strong> to read nearby weather. No
            account or key is involved, and you can switch to a general estimate at
            any time.</p>
          <p><strong>Optional account sync.</strong> If you sign in (Account, above),
            your non-sensitive settings, per-session <em>summaries</em> (numbers only),
            and per-day savings totals sync across your devices. Your prompt and
            response text is never stored or uploaded, and your Gemini key never
            leaves this device.</p>
          <p><strong>How to disable.</strong> Turn off “Writing editor” above to
            stop all suggestions, or clear the Worker URL / Gemini key to use
            offline-only mode. Uninstalling the extension removes all on-device
            data. Full details: <code>docs/PRIVACY.md</code>.</p>
        </div>
      </section>
    </div>
  )
}
