import { useEffect, useState } from 'react'
import { UserRound, LogIn, LogOut, RefreshCw, Trash2, Check, X, Eye, EyeOff, Leaf, Pencil } from 'lucide-react'
import { authStatus, signUp, login, logout, deleteAccount, syncNow, setDisplayName, greetingName, isExtensionRuntime } from '../lib/auth'
import './Account.css'

// A sensible baseline shown while typing a new password. Supabase's actual
// project policy may differ; if so, the specific reason from Supabase (surfaced
// via res.message on failure) still tells the user exactly what's missing.
const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'An uppercase and a lowercase letter', test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: 'A number', test: (p) => /[0-9]/.test(p) },
  { label: 'A symbol (e.g. ! ? # @)', test: (p) => /[^A-Za-z0-9]/.test(p) },
]

// Account section rendered inside the Settings page (kept out of the top nav to
// keep it uncluttered). Optional: logged-out users lose nothing.
export default function Account() {
  const runtime = isExtensionRuntime()
  // Initialize synchronously so we never setState inside the effect: in the web
  // build (no runtime) there is no account to manage.
  const [status, setStatus] = useState(() => (runtime ? null : { state: 'logged_out', configured: false }))
  const [mode, setMode] = useState('login')     // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)          // { kind: 'ok'|'err'|'info', text }
  const [showPassword, setShowPassword] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  async function refresh() {
    const s = await authStatus()
    setStatus(s)
  }

  useEffect(() => {
    if (runtime) authStatus().then(setStatus)
  }, [runtime])

  async function onSaveName(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const r = await setDisplayName(nameInput)
    setBusy(false)
    if (r.status === 'ok') {
      setEditingName(false)
      setMsg({
        kind: 'ok',
        text: r.synced === false
          ? 'Name saved on this device. It’ll sync to your account once the display_name column is added.'
          : 'Name saved.',
      })
      await refresh()
    } else {
      setMsg({ kind: 'err', text: r.message || 'Couldn’t save your name right now. Try again later.' })
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const res = mode === 'signup' ? await signUp(email, password) : await login(email, password)
    setBusy(false)
    if (res.status === 'verify_sent') {
      setMsg({ kind: 'info', text: 'Check your email to confirm your account, then log in.' })
    } else if (res.status === 'logged_in') {
      setPassword('')
      setMsg({ kind: 'ok', text: 'Signed in. Syncing your data…' })
      await refresh()
      syncNow().then(() => setMsg({ kind: 'ok', text: 'Signed in and synced.' }))
    } else if (res.error === 'invalid_credentials') {
      setMsg({ kind: 'err', text: res.message || 'Couldn’t sign in. Check your email and password.' })
    } else if (res.error === 'signup_failed') {
      setMsg({ kind: 'err', text: res.message || 'Couldn’t create the account. Try again in a moment.' })
    } else {
      setMsg({ kind: 'err', text: 'The account service isn’t reachable right now. Local features still work.' })
    }
  }

  async function onLogout() {
    setBusy(true)
    await logout()
    setBusy(false); setMsg(null)
    await refresh()
  }

  async function onSync() {
    setBusy(true); setMsg(null)
    const r = await syncNow()
    setBusy(false)
    setMsg(r.ok ? { kind: 'ok', text: 'Synced.' } : { kind: 'err', text: 'Sync isn’t available right now — it will retry later.' })
  }

  async function onDelete() {
    if (!window.confirm('Delete your account and all synced data? Your on-device data stays until you clear it.')) return
    setBusy(true)
    const r = await deleteAccount()
    setBusy(false)
    setMsg(r.status === 'deleted'
      ? { kind: 'ok', text: 'Account deleted. You’re back to local-only mode.' }
      : { kind: 'err', text: 'Couldn’t delete the account right now. Try again later.' })
    await refresh()
  }

  const signedIn = status && (status.state === 'logged_in' || status.state === 'offline')

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <UserRound size={18} /><h2>Account</h2>
        {status && (
          <span className={`settings-pill ${signedIn ? 'on' : 'off'}`}>
            {signedIn ? (status.state === 'offline' ? 'Signed in (offline)' : 'Signed in') : 'Local only'}
          </span>
        )}
      </div>

      <p className="settings-desc">
        PromptFootprint works fully without an account. Sign in only if you want your
        settings and stats to follow you to another device. We sync numbers only —
        <strong> never your prompt text, and never your Gemini key.</strong>
      </p>

      {!runtime && (
        <div className="settings-note">
          Open this page from the PromptFootprint extension to manage your account.
        </div>
      )}

      {runtime && status && status.configured === false && (
        <div className="settings-note">
          Accounts aren’t set up in this build. Everything runs locally on your device.
        </div>
      )}

      {runtime && status && status.configured !== false && !signedIn && (
        <form className="account-form" onSubmit={onSubmit}>
          <div className="account-tabs">
            <button type="button" className={`account-tab${mode === 'login' ? ' active' : ''}`} onClick={() => { setMode('login'); setMsg(null) }}>Log in</button>
            <button type="button" className={`account-tab${mode === 'signup' ? ' active' : ''}`} onClick={() => { setMode('signup'); setMsg(null) }}>Create account</button>
          </div>
          <label className="settings-field">
            <span className="settings-label">Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="settings-field">
            <span className="settings-label">Password</span>
            <div className="account-password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                className="account-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          {mode === 'signup' && (
            <ul className="account-password-rules">
              {PASSWORD_RULES.map((rule) => {
                const met = rule.test(password)
                return (
                  <li key={rule.label} className={met ? 'met' : ''}>
                    {met ? <Check size={13} /> : <X size={13} />} {rule.label}
                  </li>
                )
              })}
            </ul>
          )}
          <button className="account-btn" type="submit" disabled={busy}>
            <LogIn size={15} /> {mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </form>
      )}

      {runtime && signedIn && (
        <div className="account-panel">
          <div className="account-greeting">
            <span className="account-avatar" aria-hidden="true"><Leaf size={20} /></span>
            <div className="account-greeting-text">
              <span className="account-hello">
                {greetingName(status) ? `Hello, ${greetingName(status)}` : 'Hello there'}
              </span>
              <span className="account-email">{status.email || 'Signed in'}</span>
            </div>
            {!editingName && (
              <button
                className="account-name-edit"
                onClick={() => { setNameInput(status.displayName || ''); setEditingName(true) }}
              >
                <Pencil size={13} /> {status.displayName ? 'Edit name' : 'Add your name'}
              </button>
            )}
          </div>

          {editingName && (
            <form className="account-name-form" onSubmit={onSaveName}>
              <input
                type="text"
                value={nameInput}
                maxLength={80}
                autoFocus
                placeholder="What should we call you?"
                onChange={(e) => setNameInput(e.target.value)}
                aria-label="Display name"
              />
              <button className="account-btn" type="submit" disabled={busy}><Check size={15} /> Save</button>
              <button className="account-btn ghost" type="button" onClick={() => setEditingName(false)}>Cancel</button>
            </form>
          )}

          <div className="account-actions">
            <button className="account-btn" onClick={onSync} disabled={busy}><RefreshCw size={15} /> Sync now</button>
            <button className="account-btn ghost" onClick={onLogout} disabled={busy}><LogOut size={15} /> Log out</button>
            <button className="account-btn danger" onClick={onDelete} disabled={busy}><Trash2 size={15} /> Delete account</button>
          </div>
        </div>
      )}

      {msg && (
        <div className={`account-msg ${msg.kind}`}>
          {msg.kind === 'ok' && <Check size={14} />} {msg.text}
        </div>
      )}
    </section>
  )
}
