import { useEffect, useState } from 'react'
import { CloudSun, MapPin, Search, ShieldCheck, X, Loader2 } from 'lucide-react'
import { fetchConfig, saveConfig } from '../lib/api'
import {
  nearestCloudRegion, coarsenCoord, fetchWeather, geocode,
  heatwaveFactor, isHeatwave, HEATWAVE_MODEL,
} from '../lib/heatwave'
import './WeatherCard.css'

// Turns a location (label + coords) into a nearest-region + live-weather view,
// so the impact estimate can reflect hot-weather cooling. Everything here is
// clearly an APPROXIMATION: we can't know the exact data center serving a
// request, so we use the nearest known cloud region as a proxy.
export default function WeatherCard() {
  const [status, setStatus] = useState('idle') // idle | locating | ready | denied | error | general
  const [place, setPlace] = useState(null)     // { label, lat, lon }
  const [region, setRegion] = useState(null)
  const [weather, setWeather] = useState(null)
  const [manual, setManual] = useState('')
  const [error, setError] = useState('')

  const busy = status === 'locating'

  async function load(p, mode) {
    setStatus('locating')
    setError('')
    const reg = nearestCloudRegion(p.lat, p.lon)
    setRegion(reg)
    setPlace(p)
    try {
      // Fetch weather at the nearest region (that's what the overlay models),
      // not the user's exact spot.
      const w = await fetchWeather(reg ? reg.lat : p.lat, reg ? reg.lon : p.lon)
      setWeather(w)
      setStatus('ready')
      await saveConfig({
        heatwaveLocationMode: mode,
        heatwaveLat: coarsenCoord(p.lat),
        heatwaveLon: coarsenCoord(p.lon),
        heatwavePlaceLabel: p.label,
      })
    } catch {
      setStatus('error')
      setError('Could not reach the weather service. Try again, or use a general estimate — your figures fall back to the annual average.')
    }
  }

  function useMyLocation() {
    setError('')
    if (!('geolocation' in navigator)) { setStatus('error'); setError('This browser has no location support. Enter a city or ZIP instead.'); return }
    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => load({ label: 'Near you', lat: pos.coords.latitude, lon: pos.coords.longitude }, 'geo'),
      (err) => {
        if (err && err.code === 1) { setStatus('denied'); setError('') }
        else { setStatus('error'); setError('Location lookup timed out. Enter a city or ZIP instead.') }
      },
      { timeout: 9000, maximumAge: 10 * 60 * 1000 }
    )
  }

  async function lookupManual(e) {
    e.preventDefault()
    if (!manual.trim() || busy) return
    setStatus('locating'); setError('')
    try {
      const g = await geocode(manual.trim())
      if (!g) { setStatus('error'); setError(`Couldn't find “${manual.trim()}”. Try a city name or ZIP/postal code.`); return }
      await load(g, 'manual')
    } catch {
      setStatus('error'); setError('The location lookup service is unavailable right now. Try again in a moment.')
    }
  }

  async function useGeneral() {
    setStatus('general'); setPlace(null); setRegion(null); setWeather(null); setError('')
    await saveConfig({ heatwaveLocationMode: 'general', heatwaveLat: null, heatwaveLon: null, heatwavePlaceLabel: '' })
  }

  async function reset() {
    setStatus('idle'); setPlace(null); setRegion(null); setWeather(null); setManual(''); setError('')
    await saveConfig({ heatwaveLocationMode: 'off', heatwaveLat: null, heatwaveLon: null, heatwavePlaceLabel: '' })
  }

  // Restore a previously chosen location on mount.
  useEffect(() => {
    fetchConfig().then((c) => {
      if (c.heatwaveLocationMode === 'general') { setStatus('general'); return }
      if (typeof c.heatwaveLat === 'number' && typeof c.heatwaveLon === 'number') {
        load({ label: c.heatwavePlaceLabel || 'Saved location', lat: c.heatwaveLat, lon: c.heatwaveLon }, c.heatwaveLocationMode || 'manual')
      }
    })
  }, [])

  const feels = weather ? weather.feelsLikeC : null
  const factor = feels != null ? heatwaveFactor(feels) : 1
  const pct = Math.round((factor - 1) * 100)
  const hot = feels != null && isHeatwave(feels)

  // The picker (buttons + manual + general) stays reachable in every state
  // except once we have a reading or the user picked "general" — so the UI can
  // never get stuck on "checking…".
  const showPicker = status !== 'ready' && status !== 'general'

  return (
    <div className={`hw-card${hot ? ' hw-card-hot' : ''}`}>
      <div className="hw-head">
        <CloudSun size={18} />
        <h3>Weather-aware estimate</h3>
        <span className="hw-approx">approximate</span>
      </div>

      <p className="hw-lead">
        Cooling a data center takes more energy and water in hot weather, so the
        same prompt can cost a little more on a scorching day. Share a rough
        location and PromptFootprint checks the weather near the closest known
        cloud region and adjusts the estimate when it’s warranted.
      </p>

      {showPicker && (
        <>
          <div className="hw-actions">
            <button className="hw-btn hw-btn-primary" onClick={useMyLocation} disabled={busy}>
              <MapPin size={15} /> Use my location
            </button>
            <form className="hw-manual" onSubmit={lookupManual}>
              <input
                type="text"
                placeholder="City or ZIP / postal code"
                value={manual}
                disabled={busy}
                onChange={(e) => setManual(e.target.value)}
                aria-label="City or ZIP code"
              />
              <button className="hw-btn" type="submit" disabled={busy}><Search size={15} /> Look up</button>
            </form>
            <button className="hw-link" onClick={useGeneral} disabled={busy}>Use a general estimate</button>
          </div>

          {busy && <p className="hw-note hw-checking"><Loader2 size={14} className="hw-spin" /> Checking the weather…</p>}
          {status === 'denied' && (
            <p className="hw-note">
              Location was declined — no problem. Enter a city or ZIP above, or use a
              general estimate. Nothing is looked up without your say.
            </p>
          )}
          {error && <p className="hw-error">{error}</p>}
        </>
      )}

      {status === 'ready' && weather && (
        <div className="hw-result">
          <div className="hw-readout">
            <div className="hw-temp">
              <span className="hw-temp-val">{feels != null ? Math.round(feels) : '—'}°C</span>
              <span className="hw-temp-lbl">feels-like now</span>
            </div>
            <div className={`hw-verdict ${hot ? 'hot' : 'mild'}`}>
              {hot ? (
                <>It’s hot near this region. Cooling could push energy &amp; water roughly
                  <strong> +{pct}%</strong> above the annual-average estimate right now.</>
              ) : (
                <>Weather is mild near this region — the standard (annual-average)
                  estimate applies. No adjustment needed right now.</>
              )}
            </div>
          </div>
          <div className="hw-region">
            <MapPin size={13} />
            <span>Nearest cloud region: <strong>{region ? region.label : place?.label}</strong>{region ? ` · ~${Math.round(region.distanceKm)} km away` : ''}</span>
          </div>
          <p className="hw-fineprint">
            Approximation only. We can’t see which data center actually handled your
            request, so this reads live weather at the nearest known cloud region and
            models peak cooling (PUE up to ~{HEATWAVE_MODEL.PEAK_PUE}).
          </p>
          <button className="hw-link" onClick={reset}><X size={13} /> Change location</button>
        </div>
      )}

      {status === 'general' && (
        <div className="hw-result">
          <p className="hw-note">
            Using a general estimate — no location, no weather lookup. Figures use the
            annual-average cooling assumption everywhere.
          </p>
          <button className="hw-link" onClick={reset}>Set a location instead</button>
        </div>
      )}

      <div className="hw-privacy">
        <ShieldCheck size={13} />
        <span>
          Optional. We store a rounded location (about 11 km), never a precise one,
          on this device only — never your address. Weather comes from Open-Meteo
          (no account, no key).
        </span>
      </div>
    </div>
  )
}
