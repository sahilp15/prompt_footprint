import { Hash, Zap, Droplets, Wind, Clock, Eye, Calculator, Scissors, Layers, Repeat, Gauge, ShieldCheck, MonitorSmartphone, PencilLine, AlertTriangle, ExternalLink, FileText } from 'lucide-react'
import './Guide.css'

const STATS = [
  { icon: Hash, color: '#5b7c3a', name: 'Tokens', text: 'The pieces a model reads and writes — about ¾ of a word each. Your prompt and the reply both count. Everything else on the dashboard is derived from this number.' },
  { icon: Zap, color: '#c17f24', name: 'Energy (Wh)', text: 'Electricity the data-center GPUs use to process those tokens, in watt-hours. As a rough feel, 1 Wh is about 20 minutes of a phone sitting on standby.' },
  { icon: Droplets, color: '#2e6b8a', name: 'Water (mL)', text: 'Fresh water evaporated to cool the hardware, in millilitres — both at the data center and at the power plant that feeds it.' },
  { icon: Wind, color: '#8b7355', name: 'CO₂ (g)', text: 'Grams of CO₂-equivalent from generating that electricity. The real figure depends on how clean the local grid is, so treat it as a mid-range estimate.' },
  { icon: Clock, color: '#a0522d', name: 'Response time', text: 'How long the reply took to finish. A reply that streams slower than the platform’s usual speed is scaled up (within a cap), because slow replies usually did more work per token.' },
]

// Per 1,000 tokens. ChatGPT is the anchor; Claude is the anchor × 1.15.
// Matches extension/lib/constants.js.
const PER_1K = [
  { platform: 'ChatGPT — GPT-4o baseline', energy: '1.06 Wh', water: '3.5 mL', co2: '0.38 g' },
  { platform: 'Claude — 3.x Sonnet estimate', energy: '1.22 Wh', water: '4.1 mL', co2: '0.43 g' },
]

const TIPS = [
  { icon: Scissors, title: 'Cut the padding', text: 'Greetings, “please/thank you”, and phrases like “I was wondering if you could…” add tokens without changing the answer. The built-in Energy Saver trims them and shows the difference before you send.' },
  { icon: Layers, title: 'Batch related questions', text: 'One prompt with three questions costs less than three separate chats, because you don’t re-send the context each time.' },
  { icon: Repeat, title: 'Refine instead of regenerating', text: 'Every “regenerate” runs the whole reply again. Adjusting the prompt is usually cheaper than rerolling.' },
  { icon: Gauge, title: 'Match the mode to the task', text: 'Reasoning or “thinking” modes can cost several times more per answer. Use them when the problem actually needs them.' },
  { icon: Scissors, title: 'Ask for less output', text: 'Replies are usually longer than prompts. “Give me three bullets” or “just the code” keeps the response short.' },
]

const LIMITS = [
  'These are estimates to build intuition, not meter readings.',
  'Token counts are approximated from text length and can be off by roughly 15% — more for code or non-English text.',
  'Claude’s numbers are inferred from ChatGPT’s, because Anthropic doesn’t publish per-prompt energy or water figures.',
  'Response time includes network and queue delays, not just the model’s compute, so the time adjustment is capped at 3×.',
  'We can’t see provider-side batching, caching, or which hardware ran the request.',
]

const REFS = [
  { id: 1, authors: 'Parasharami, S.', year: 2025, title: 'A Token-Level Framework for Quantifying ChatGPT’s Environmental Impacts', journal: 'Vanderbilt Young Scientist Journal' },
  { id: 2, authors: 'OpenAI', year: 2025, title: '2025 Sustainability Disclosure (GPT-4o energy, water, and carbon figures)', journal: 'OpenAI' },
  { id: 3, authors: 'Jegham, N., et al.', year: 2025, title: 'How Hungry is AI? Benchmarking Energy, Water, and Carbon Footprint of LLM Inference', journal: 'arXiv:2505.09598', url: 'https://arxiv.org/abs/2505.09598' },
  { id: 4, authors: 'Li, P., et al.', year: 2023, title: "Making AI Less 'Thirsty': Uncovering and Addressing the Secret Water Footprint of AI Models", journal: 'arXiv:2304.03271', url: 'https://arxiv.org/abs/2304.03271' },
  { id: 5, authors: 'International Energy Agency', year: 2023, title: 'Data Centres and Data Transmission Networks', journal: 'IEA', url: 'https://www.iea.org/energy-system/buildings/data-centres-and-data-transmission-networks' },
]

const PDF_URL = 'https://drive.google.com/file/d/1nDAt8aSZNNfovCfc_9QFwZ_-LtZ_wdB1/view?usp=sharing'

export default function Guide() {
  return (
    <div className="guide-page">
      <div className="page-header">
        <h1 className="page-title">How PromptFootprint works</h1>
        <p className="page-subtitle">What the numbers mean, how they’re calculated, and where the estimates end.</p>
      </div>

      {/* What each number means */}
      <section className="guide-section">
        <h2 className="guide-h2">What each number means</h2>
        <div className="guide-cards">
          {STATS.map((s) => (
            <div className="guide-card" key={s.name}>
              <div className="guide-card-icon" style={{ background: `${s.color}18`, color: s.color }}>
                <s.icon size={18} />
              </div>
              <div>
                <div className="guide-card-name">{s.name}</div>
                <p className="guide-card-text">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Measured vs estimated */}
      <section className="guide-section">
        <h2 className="guide-h2">What’s measured and what’s estimated</h2>
        <div className="guide-split">
          <div className="guide-split-card">
            <div className="guide-split-head"><Eye size={16} /> Observed on your device</div>
            <ul className="guide-list">
              <li>The length of your prompt and the reply — used only to count characters, never saved or sent anywhere.</li>
              <li>How long each reply took to stream.</li>
            </ul>
          </div>
          <div className="guide-split-card">
            <div className="guide-split-head"><Calculator size={16} /> Estimated from that</div>
            <ul className="guide-list">
              <li>Token counts, from character length (about 4 characters per token).</li>
              <li>Energy, water, and CO₂, from published per-token figures.</li>
            </ul>
          </div>
        </div>
        <p className="guide-note">None of these are direct measurements of your specific request. They’re a transparent, defensible estimate — good for spotting trends, not for auditing a data center.</p>
      </section>

      {/* How the estimate is built */}
      <section className="guide-section">
        <h2 className="guide-h2">How the estimate is built</h2>
        <p className="guide-lead">Three steps turn a prompt into a footprint:</p>
        <ol className="guide-steps">
          <li><strong>Count the tokens.</strong> The character length of the prompt and reply is divided by four — the rough average for the GPT-4 tokenizer. This happens in your browser; the text itself is never uploaded.</li>
          <li><strong>Multiply by a per-token cost.</strong> ChatGPT is the anchor: OpenAI’s 2025 sustainability figures, divided by an estimate of yearly tokens, work out to roughly 1.06 Wh, 3.5 mL of water, and 0.38 g of CO₂ per 1,000 tokens. Anthropic publishes no figures, so Claude is set 15% above the ChatGPT anchor.</li>
          <li><strong>Adjust for effort.</strong> A reply slower than the platform’s normal speed is scaled up, capped at 3×. Faster replies are never scaled below 1×.</li>
        </ol>

        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead>
              <tr><th>Platform</th><th>Energy / 1k tokens</th><th>Water / 1k tokens</th><th>CO₂ / 1k tokens</th></tr>
            </thead>
            <tbody>
              {PER_1K.map((r) => (
                <tr key={r.platform}>
                  <td>{r.platform}</td>
                  <td><code>{r.energy}</code></td>
                  <td><code>{r.water}</code></td>
                  <td><code>{r.co2}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="guide-formula">
          impact = tokens × per-token cost × time factor
        </div>
      </section>

      {/* Token savings */}
      <section className="guide-section">
        <h2 className="guide-h2">How savings are counted</h2>
        <p className="guide-lead">
          When the Energy Saver suggests a shorter prompt and you click <strong>Apply</strong>, PromptFootprint
          compares the token count before and after and records the difference. Suggestions you ignore don’t
          count, and applying the same fix twice doesn’t count twice — so the Savings page reflects real,
          one-time reductions.
        </p>
      </section>

      {/* Reduce your use */}
      <section className="guide-section">
        <h2 className="guide-h2">Ways to use fewer tokens</h2>
        <div className="guide-tips">
          {TIPS.map((t) => (
            <div className="guide-tip" key={t.title}>
              <t.icon size={18} className="guide-tip-icon" />
              <div>
                <div className="guide-tip-title">{t.title}</div>
                <p className="guide-tip-text">{t.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy */}
      <section className="guide-section">
        <h2 className="guide-h2"><ShieldCheck size={20} className="guide-h2-icon" /> Local-first by default</h2>
        <p className="guide-lead">
          Everything above runs on your device. Token counts and the numbers derived from them live in your
          browser’s local storage; your prompts and the replies are never saved or uploaded. The one exception
          is optional: if you turn on AI writing help, the draft you’re typing is sent to a Cloudflare Worker you
          set up, which passes it to Gemini for a suggestion. It stays off until you add that URL. The Settings
          page has the full breakdown.
        </p>
      </section>

      {/* Platforms + writing assistant */}
      <section className="guide-section">
        <div className="guide-split">
          <div className="guide-split-card">
            <div className="guide-split-head"><MonitorSmartphone size={16} /> Supported platforms</div>
            <p className="guide-split-text">
              PromptFootprint tracks ChatGPT (chatgpt.com and chat.openai.com) and Claude (claude.ai). Other
              sites are left alone.
            </p>
          </div>
          <div className="guide-split-card">
            <div className="guide-split-head"><PencilLine size={16} /> Writing assistant</div>
            <p className="guide-split-text">
              The offline checker — spelling, capitalization, punctuation, repeated words — always runs in your
              browser. The optional Gemini layer rewrites for clarity and tone, and only runs if you’ve set up
              the Worker. If it’s off or unreachable, the offline checks still work.
            </p>
          </div>
        </div>
      </section>

      {/* Limitations */}
      <section className="guide-section">
        <h2 className="guide-h2"><AlertTriangle size={20} className="guide-h2-icon" /> Limitations</h2>
        <ul className="guide-list guide-limits">
          {LIMITS.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </section>

      {/* Sources */}
      <section className="guide-section">
        <h2 className="guide-h2">Sources</h2>
        <p className="guide-lead">The constants come from these sources. The full derivation is in the methodology document.</p>
        <a href={PDF_URL} target="_blank" rel="noopener noreferrer" className="guide-pdf-link">
          <FileText size={16} /><span>Methodology (PDF)</span><ExternalLink size={13} />
        </a>
        <ol className="guide-refs">
          {REFS.map((r) => (
            <li key={r.id} className="guide-ref">
              <span className="guide-ref-num">[{r.id}]</span>
              <span>
                {r.authors} ({r.year}). <em>{r.title}</em>. {r.journal}.
                {r.url && <> <a href={r.url} target="_blank" rel="noopener noreferrer" className="guide-ref-link">{r.url} <ExternalLink size={11} /></a></>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
