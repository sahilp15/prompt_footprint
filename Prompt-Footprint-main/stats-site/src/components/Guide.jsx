import { Hash, Zap, Droplets, Wind, Clock, Lightbulb, Scissors, Repeat, Layers, Gauge } from 'lucide-react'
import './Guide.css'

const STATS = [
  { icon: Hash, color: '#5b7c3a', name: 'Tokens', text: 'The atomic units a model reads and writes — roughly ¾ of a word each. Both your prompt and the response count. Tokens are the primary driver of every other number on this dashboard.' },
  { icon: Zap, color: '#c17f24', name: 'Energy (Wh)', text: 'Electricity used by the data-center GPUs to process your tokens, in watt-hours. For scale, 1 Wh ≈ 20 minutes of a phone on standby. Slower, heavier (reasoning) responses use more energy per token.' },
  { icon: Droplets, color: '#2e6b8a', name: 'Water (mL)', text: 'Fresh water evaporated to cool those GPUs, in millilitres. Data centers consume water both on-site (cooling towers) and off-site (power generation).' },
  { icon: Wind, color: '#8b7355', name: 'CO₂ (g)', text: 'Greenhouse gas emitted generating the electricity, in grams of CO₂-equivalent. Depends heavily on how clean the local power grid is.' },
  { icon: Clock, color: '#a0522d', name: 'Response time', text: 'How long the model took to answer. PromptFootprint uses it as a proxy for compute intensity: responses that stream slower than the platform baseline are scaled up (capped), because they typically did more work per token.' },
]

const TIPS = [
  { icon: Scissors, title: 'Trim the padding', text: 'Drop greetings, "please/thank you", and filler like "I was wondering if you could…". The built-in prompt optimizer does this automatically and shows the savings before you send.' },
  { icon: Layers, title: 'Batch related questions', text: 'One well-structured prompt with three questions costs far less overhead than three separate sessions — you avoid re-sending context each time.' },
  { icon: Repeat, title: 'Avoid needless regeneration', text: 'Each "regenerate" re-runs the full inference. Refine your prompt instead of rerolling and hoping.' },
  { icon: Gauge, title: 'Match the model to the task', text: 'Reasoning / "thinking" modes can cost several times more per answer. Reserve them for problems that genuinely need them.' },
  { icon: Scissors, title: 'Cap the output', text: 'Responses are usually larger than prompts. Ask for "a 3-bullet summary" or "just the code" when you don\'t need an essay.' },
]

export default function Guide() {
  return (
    <div className="guide-page">
      <div className="page-header">
        <h1 className="page-title">Understanding Your Footprint</h1>
        <p className="page-subtitle">What the numbers mean, and how to shrink them</p>
      </div>

      <section className="guide-section">
        <h2 className="guide-h2">What each stat means</h2>
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

      <section className="guide-section">
        <h2 className="guide-h2">How to read the impact</h2>
        <p className="guide-lead">
          A single prompt is tiny — fractions of a watt-hour. The point isn't any
          one query; it's the <strong>aggregate</strong>. Billions of prompts a day
          add up to data-center-scale energy and water use. PromptFootprint converts
          your totals into familiar equivalents — drops of water, seconds of phone
          screen-on time, metres driven by car — so the trend is tangible. Watch the
          weekly chart: the goal is steady or falling, not a personal high score.
        </p>
      </section>

      <section className="guide-section">
        <h2 className="guide-h2"><Lightbulb size={20} className="guide-h2-icon" /> Reduce your prompt resource use</h2>
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

      <p className="guide-foot">
        Curious how the numbers are derived? See <strong>How It Works</strong> for the
        formulas, constants, sources, and limitations.
      </p>
    </div>
  )
}
