import { useEffect, useState } from 'react'
import type { AuthError } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { btn, btnGhost, card, input } from '../components/ui'

const RESEND_SECONDS = 60

function messageForAuthError(error: AuthError): string {
  const code = error.code ?? ''
  const raw = error.message?.trim() || 'Something went wrong. Try again.'
  const rateLimited = error.status === 429
    || code === 'over_request_rate_limit'
    || code === 'over_email_send_rate_limit'
    || /rate limit|too many requests/i.test(raw)
  if (rateLimited) {
    const seconds = raw.match(/(\d+)\s+seconds?/i)
    if (seconds) return `Too many emails were requested. Wait ${seconds[1]} seconds, then try again.`
    return 'Too many emails were requested. Wait a minute, then try again.'
  }
  if (code === 'otp_expired' || (/expired/i.test(raw) && /invalid/i.test(raw))) {
    return 'That code is incorrect or has expired. Check the email or send a new one.'
  }
  if (/expired/i.test(raw)) return 'That code has expired. Send a new one and try again.'
  if (code === 'otp_disabled') return 'Email sign-in codes are turned off for this project.'
  if (/invalid|token/i.test(raw)) return 'That code is incorrect. Check the email and try again.'
  return raw
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((current) => current - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const sendCode = async () => {
    setErr(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    })
    setBusy(false)
    if (error) {
      setErr(messageForAuthError(error))
      return
    }
    setSent(true)
    setCooldown(RESEND_SECONDS)
  }

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    await sendCode()
  }

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const token = code.trim()
    if (!/^\d{6}$/.test(token)) {
      setErr('Enter the 6-digit code from the email.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' })
    setBusy(false)
    if (error) setErr(messageForAuthError(error))
  }

  const useDifferentEmail = () => {
    setSent(false)
    setCode('')
    setErr(null)
    setCooldown(0)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-6 text-2xl font-semibold">Inventory Tracker</h1>
      {!supabaseConfigured && <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.</p>}
      <div className={card}>
        {sent ? (
          <form onSubmit={submitCode} className="space-y-3">
            <p>We emailed you a code. Enter it here.</p>
            <p className="text-sm text-slate-400">Sent to <b className="text-slate-200">{email.trim()}</b></p>
            <label className="block text-sm text-slate-300" htmlFor="otp">Code</label>
            <input
              id="otp"
              className={input}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              required
            />
            {err && <p className="text-sm text-red-400" role="alert">{err}</p>}
            <button className={`${btn} w-full`} disabled={busy || code.length !== 6}>Sign in</button>
            <button type="button" className={`${btnGhost} w-full`} disabled={busy || cooldown > 0} onClick={() => { void sendCode() }}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            <button type="button" className="w-full text-sm text-slate-400 underline disabled:opacity-50" disabled={busy} onClick={useDifferentEmail}>
              Use a different email
            </button>
          </form>
        ) : (
          <form onSubmit={submitEmail} className="space-y-3">
            <label className="block text-sm text-slate-300" htmlFor="email">Email</label>
            <input id="email" className={input} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            {err && <p className="text-sm text-red-400" role="alert">{err}</p>}
            <button className={`${btn} w-full`} disabled={busy}>Send code</button>
          </form>
        )}
      </div>
    </div>
  )
}
