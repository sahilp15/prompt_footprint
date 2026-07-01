import { Award, ExternalLink, Trophy } from 'lucide-react'
import './Awards.css'

export default function Awards() {
  return (
    <div className="awards-page">
      <div className="page-header">
        <h1 className="page-title">Recognition</h1>
        <p className="page-subtitle">Awards and honors PromptFootprint has received</p>
      </div>

      <div className="awards-grid">
        <div className="award-card highlight">
          <div className="award-icon"><Trophy size={28} /></div>
          <div className="award-body">
            <div className="award-rank">3rd Place Winner</div>
            <div className="award-event">Climate ChangeMakers Challenge 2026</div>
            <p className="award-desc">
              Recognized for making the hidden environmental cost of everyday AI
              use visible and actionable — helping people understand and reduce
              the energy, water, and carbon footprint of their prompts.
            </p>
          </div>
        </div>

        <div className="award-card">
          <div className="award-icon"><Award size={28} /></div>
          <div className="award-body">
            <div className="award-event">Featured on Devpost</div>
            <p className="award-desc">
              See the full project write-up, demo, and build story on Devpost.
            </p>
            <a
              className="award-link"
              href="https://devpost.com/software/prompt-footprint"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Devpost <ExternalLink size={15} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
