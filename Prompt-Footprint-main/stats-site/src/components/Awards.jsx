import { RecognitionShowcase } from '../marketing/Recognition'

/**
 * The dashboard's Awards view. It renders the same editorial showcase as the
 * public /recognition page, so the two can never disagree; inside the
 * extension the closing section points at the source rather than an install.
 */
export default function Awards() {
  return (
    <div className="rc rc-in-app">
      <RecognitionShowcase variant="app" />
    </div>
  )
}
