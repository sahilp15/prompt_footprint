import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
// Self-hosted fonts (bundled into the build) — no remote Google Fonts request,
// so the site works offline and nothing about a visit is announced to a third
// party. Only the latin subsets and only the weights the design uses.
//
//   Archivo Narrow — display. Industrial condensed; carries the headlines and
//                    every large measurement.
//   IBM Plex Sans  — body. Humanist utility sans, built for dense UI reading.
//   JetBrains Mono — data. Every number, unit, and engraved micro-label.
import '@fontsource/archivo-narrow/latin-400.css'
import '@fontsource/archivo-narrow/latin-500.css'
import '@fontsource/archivo-narrow/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import './index.css'
import App from './App.jsx'

// HashRouter keeps deep links working on static hosts (GitHub Pages) and as a
// packaged extension page, with no server-side rewrite needed.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
