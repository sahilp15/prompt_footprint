import { BookOpen, Zap, Droplets, Wind, ExternalLink, FileText } from 'lucide-react'
import { ContainerScroll, Header } from './ui/container-scroll-animation'
import './HowItWorks.css'

const INTENSITIES = [
  { model: 'GPT-3.5 Turbo', energyPer1k: '0.001–0.003', water: '~0.5', co2: '~0.4', tier: 'low' },
  { model: 'GPT-4 (8K)',    energyPer1k: '0.003–0.009', water: '~1.5', co2: '~1.2', tier: 'medium' },
  { model: 'GPT-4 (32K)',   energyPer1k: '0.009–0.025', water: '~4.0', co2: '~3.5', tier: 'high' },
  { model: 'Claude 3 Haiku', energyPer1k: '0.001–0.002', water: '~0.4', co2: '~0.3', tier: 'low' },
  { model: 'Claude 3 Sonnet', energyPer1k: '0.003–0.007', water: '~1.2', co2: '~1.0', tier: 'medium' },
  { model: 'Claude 3 Opus',  energyPer1k: '0.008–0.020', water: '~3.5', co2: '~2.8', tier: 'high' },
  { model: 'Gemini Pro',    energyPer1k: '0.002–0.006', water: '~1.0', co2: '~0.8', tier: 'medium' },
  { model: 'Llama 3 (70B)', energyPer1k: '0.005–0.015', water: '~2.5', co2: '~2.0', tier: 'high' },
]

const REFS = [
  {
    id: 1,
    authors: 'Luccioni, A. S., Viguier, S., & Ligozat, A.-L.',
    year: 2023,
    title: 'Estimating the Carbon Footprint of BLOOM, a 176B Parameter Language Model',
    journal: 'Journal of Machine Learning Research',
    url: 'https://jmlr.org/papers/v24/23-0069.html',
  },
  {
    id: 2,
    authors: 'Patterson, D., et al.',
    year: 2022,
    title: 'The Carbon Footprint of Machine Learning Training Will Plateau, Then Shrink',
    journal: 'IEEE Computer',
    url: 'https://arxiv.org/abs/2204.05149',
  },
  {
    id: 3,
    authors: 'Li, P., et al.',
    year: 2023,
    title: "Making AI Less 'Thirsty': Uncovering and Addressing the Secret Water Footprint of AI Models",
    journal: 'arXiv preprint',
    url: 'https://arxiv.org/abs/2304.03271',
  },
  {
    id: 4,
    authors: 'Strubell, E., Ganesh, A., & McCallum, A.',
    year: 2019,
    title: 'Energy and Policy Considerations for Deep Learning in NLP',
    journal: 'ACL 2019',
    url: 'https://arxiv.org/abs/1906.02629',
  },
  {
    id: 5,
    authors: 'IEA',
    year: 2023,
    title: 'Data Centres and Data Transmission Networks — Electricity consumption report',
    journal: 'International Energy Agency',
    url: 'https://www.iea.org/energy-system/buildings/data-centres-and-data-transmission-networks',
  },
]

const PDF_URL = 'https://drive.google.com/file/d/1nDAt8aSZNNfovCfc_9QFwZ_-LtZ_wdB1/view?usp=sharing'

function TierBadge({ tier }) {
  const map = { low: 'Low', medium: 'Medium', high: 'High' }
  return <span className={`tier-badge tier-${tier}`}>{map[tier]}</span>
}

export default function HowItWorks() {
  return (
    <div className="how-page">
      {/* ── Hero with ContainerScroll ── */}
      <ContainerScroll
        titleComponent={
          <Header>
            <div className="how-hero-badge">
              <BookOpen size={13} />
              <span>The Science Behind the Numbers</span>
            </div>
            <h1 className="how-hero-title">
              How Every Prompt<br />Leaves a Trace
            </h1>
            <p className="how-hero-sub">
              From tokens to terawatt-hours — the complete picture of AI's environmental cost
            </p>
            <div className="how-hero-byline">
              <span className="how-hero-author">By Sahil Parasharami</span>
              <span className="how-hero-byline-dot">·</span>
              <span className="how-hero-article">"A Token-Level Framework for Quantifying ChatGPT's Environmental Impacts and a Browser-Based Intervention for Reducing Prompt Resource Use"</span>
            </div>
          </Header>
        }
      >
        <div className="how-hero-card">
          <div className="how-hero-card-inner">
            <div className="how-flow">
              <div className="how-flow-step">
                <div className="how-flow-icon" style={{ background: 'rgba(91,124,58,0.12)', color: 'var(--accent-green)' }}>
                  <span className="how-flow-num">1</span>
                </div>
                <div className="how-flow-label">You type a prompt</div>
                <div className="how-flow-sub">~250 tokens avg</div>
              </div>
              <div className="how-flow-arrow">→</div>
              <div className="how-flow-step">
                <div className="how-flow-icon" style={{ background: 'rgba(193,127,36,0.12)', color: 'var(--accent-amber)' }}>
                  <Zap size={18} />
                </div>
                <div className="how-flow-label">GPU inference</div>
                <div className="how-flow-sub">billions of FLOPs</div>
              </div>
              <div className="how-flow-arrow">→</div>
              <div className="how-flow-step">
                <div className="how-flow-icon" style={{ background: 'rgba(46,107,138,0.12)', color: 'var(--accent-blue)' }}>
                  <Droplets size={18} />
                </div>
                <div className="how-flow-label">Cooling water</div>
                <div className="how-flow-sub">evaporated per query</div>
              </div>
              <div className="how-flow-arrow">→</div>
              <div className="how-flow-step">
                <div className="how-flow-icon" style={{ background: 'rgba(139,115,85,0.12)', color: 'var(--text-muted)' }}>
                  <Wind size={18} />
                </div>
                <div className="how-flow-label">CO₂ emitted</div>
                <div className="how-flow-sub">grid carbon intensity</div>
              </div>
            </div>
          </div>
        </div>
      </ContainerScroll>

      {/* ── Content sections ── */}
      <div className="how-content">

        {/* Token Math */}
        <section className="how-section">
          <div className="how-section-label">Section 01</div>
          <h2 className="how-section-title">Token Math: From Words to Watts</h2>
          <div className="how-section-body">
            <p>
              Large language models process text as <strong>tokens</strong> — roughly 0.75 words each.
              When you send a prompt, the model performs a forward pass: for every token generated,
              it runs through billions of multiply-accumulate operations on GPU tensor cores.
            </p>
            <div className="how-formula-box">
              <div className="how-formula-title">Energy per inference</div>
              <div className="how-formula">
                E (Wh) = (FLOPs × PUE) ÷ (GPU TDP × 3600)
              </div>
              <div className="how-formula-legend">
                <span><strong>FLOPs</strong> = 2 × N_params × N_tokens (forward pass approximation)</span>
                <span><strong>PUE</strong> = Power Usage Effectiveness of data center (~1.1–1.5)</span>
                <span><strong>GPU TDP</strong> = Thermal Design Power of the GPU in watts</span>
              </div>
            </div>
            <p>
              A GPT-4-class model with ~1.8 trillion parameters generates roughly
              <strong> 3.6×10¹⁵ FLOPs per 1,000 tokens</strong>. Running on an H100 GPU (700W TDP)
              with a data center PUE of 1.2, that works out to approximately <strong>0.005–0.010 Wh</strong> per
              1,000 output tokens — before accounting for water cooling and grid carbon intensity.
            </p>
          </div>
        </section>

        {/* Energy Intensities Table */}
        <section className="how-section">
          <div className="how-section-label">Section 02</div>
          <h2 className="how-section-title">Energy Intensities by Model</h2>
          <div className="how-section-body">
            <p>
              The table below shows estimated energy consumption per 1,000 tokens, water use (mL),
              and CO₂ emissions (g) per 1,000 tokens for common models. These are mid-range estimates
              based on published research and vary by data center location, hardware generation, and
              batch size.
            </p>
          </div>
          <div className="how-table-wrap">
            <table className="how-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Energy / 1k tokens (Wh)</th>
                  <th>Water / 1k tokens (mL)</th>
                  <th>CO₂ / 1k tokens (g)</th>
                  <th>Impact</th>
                </tr>
              </thead>
              <tbody>
                {INTENSITIES.map(row => (
                  <tr key={row.model}>
                    <td className="how-table-model">{row.model}</td>
                    <td><code>{row.energyPer1k}</code></td>
                    <td>{row.water}</td>
                    <td>{row.co2}</td>
                    <td><TierBadge tier={row.tier} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="how-table-note">
            * Estimates based on Luccioni et al. (2023), Patterson et al. (2022), and Li et al. (2023).
            Actual values vary by deployment infrastructure.
          </p>
        </section>

        {/* GPT-5 Scaling */}
        <section className="how-section">
          <div className="how-section-label">Section 03</div>
          <h2 className="how-section-title">The Scaling Problem: GPT-5 and Beyond</h2>
          <div className="how-section-body">
            <p>
              Each generation of frontier AI models roughly <strong>10× the compute</strong> of its predecessor.
              GPT-3 required ~3.14×10²³ FLOPs to train. GPT-4 is estimated at 2.15×10²⁵ FLOPs.
              A hypothetical GPT-5 class model could require <strong>10²⁶–10²⁷ FLOPs</strong> — equivalent to
              the annual electricity consumption of a small country just for a single training run.
            </p>
            <div className="how-scaling-grid">
              <div className="how-scaling-card">
                <div className="how-scaling-value" style={{ color: 'var(--accent-green)' }}>GPT-3</div>
                <div className="how-scaling-label">175B parameters</div>
                <div className="how-scaling-sub">~552 MWh training energy</div>
              </div>
              <div className="how-scaling-card">
                <div className="how-scaling-value" style={{ color: 'var(--accent-amber)' }}>GPT-4</div>
                <div className="how-scaling-label">~1.8T parameters (est.)</div>
                <div className="how-scaling-sub">~50,000 MWh estimated</div>
              </div>
              <div className="how-scaling-card">
                <div className="how-scaling-value" style={{ color: 'var(--accent-red)' }}>GPT-5+</div>
                <div className="how-scaling-label">Unknown scale</div>
                <div className="how-scaling-sub">Could exceed 500,000 MWh</div>
              </div>
            </div>
            <p>
              Inference costs scale with usage. As AI becomes embedded in everyday tools —
              search engines, coding assistants, document editors — the cumulative inference footprint
              will dwarf training costs within this decade. Microsoft's Azure alone is adding gigawatts
              of data center capacity specifically for AI workloads.
            </p>
          </div>
        </section>

        {/* References */}
        <section className="how-section">
          <div className="how-section-label">References</div>
          <h2 className="how-section-title">Sources & Further Reading</h2>
          <div className="how-section-body">
            <p>
              The calculations in PromptFootprint are grounded in peer-reviewed research.
              You can also download our full methodology document:
            </p>
            <a
              href={PDF_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="how-pdf-link"
            >
              <FileText size={18} />
              <span>Download Full Methodology PDF</span>
              <ExternalLink size={14} />
            </a>
          </div>
          <ol className="how-refs">
            {REFS.map(r => (
              <li key={r.id} className="how-ref">
                <span className="how-ref-num">[{r.id}]</span>
                <span className="how-ref-body">
                  {r.authors} ({r.year}).{' '}
                  <em>{r.title}</em>.{' '}
                  {r.journal}.{' '}
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="how-ref-link">
                    {r.url} <ExternalLink size={11} />
                  </a>
                </span>
              </li>
            ))}
          </ol>
        </section>

      </div>
    </div>
  )
}
