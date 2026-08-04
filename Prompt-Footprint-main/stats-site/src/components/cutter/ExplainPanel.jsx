import { AlertTriangle, ChevronDown, Lightbulb } from 'lucide-react'
import { ROLE_LABELS } from '../../lib/tokenCutter/explain.ts'

const ENTITY_LABELS = {
  number: 'Number',
  date: 'Date',
  url: 'Link',
  email: 'Email',
  'file-type': 'File',
  technology: 'Technology',
  'proper-noun': 'Name',
  quoted: 'Quoted',
  'length-limit': 'Limit',
}

function Field({ label, value }) {
  return (
    <div className="tc-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/**
 * What the cutter thinks the prompt is asking for.
 *
 * Every reduction rests on this reading, so showing it lets the user check the
 * tool understood them before they accept anything.
 */
export default function ExplainPanel({ explanation, open, onToggle }) {
  if (!explanation) return null
  const { task, audience, tone, format, intent, constraints, entities, conflicts, sections } = explanation

  return (
    <section className={`tc-explain${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="tc-explain-toggle"
        aria-expanded={open}
        aria-controls="tc-explain-body"
        onClick={onToggle}
      >
        <Lightbulb size={15} aria-hidden="true" />
        <span className="tc-explain-title">Explain my prompt</span>
        <span className="tc-explain-hint">{task}</span>
        <ChevronDown size={16} className="tc-explain-chev" aria-hidden="true" />
      </button>

      <div id="tc-explain-body" className="tc-explain-body" hidden={!open}>
        {conflicts.length > 0 && (
          <div className="tc-alert" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <div>
              <strong>Conflicting requirements</strong>
              <ul>{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          </div>
        )}

        <dl className="tc-fields">
          <Field label="Main task" value={task} />
          <Field label="Tone" value={tone} />
          <Field label="Output format" value={format} />
          <Field label="Audience" value={audience} />
        </dl>

        <p className="tc-explain-intent">{intent}</p>

        {sections.length > 0 && (
          <>
            <h4 className="tc-subhead">Structure</h4>
            <ul className="tc-taglist">
              {sections.map((s) => (
                <li className="tc-tag" key={s.role}>
                  {ROLE_LABELS[s.role] ?? s.role}
                  <span className="tc-tag-count">{s.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {constraints.length > 0 && (
          <>
            <h4 className="tc-subhead">Constraints found ({constraints.length})</h4>
            <ul className="tc-taglist">
              {constraints.map((c) => (
                <li className="tc-tag tc-tag-constraint" key={c.key} title={c.label}>
                  {c.text}
                </li>
              ))}
            </ul>
          </>
        )}

        {entities.length > 0 && (
          <>
            <h4 className="tc-subhead">Details that must survive ({entities.length})</h4>
            <ul className="tc-taglist">
              {entities.map((e) => (
                <li className="tc-tag tc-tag-entity" key={`${e.kind}-${e.key}`}>
                  <span className="tc-tag-kind">{ENTITY_LABELS[e.kind] ?? e.kind}</span>
                  {e.text}
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="tc-footnote">
          This reading is produced on your device from the prompt’s structure. If
          it is wrong, the suggestions above are probably wrong too — say what you
          mean more explicitly and it will update.
        </p>
      </div>
    </section>
  )
}
