import { useState } from 'react'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { btn, card, input } from '../components/ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } })
    setBusy(false)
    if (error) setErr(error.message); else setSent(true)
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-6 text-2xl font-semibold">Inventory Tracker</h1>
      {!supabaseConfigured && <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.</p>}
      <div className={card}>
        {sent ? <p>Check <b>{email}</b> for a sign-in link.</p> : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm text-slate-300">Email</label>
            <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            {err && <p className="text-sm text-red-400">{err}</p>}
            <button className={`${btn} w-full`} disabled={busy}>Send magic link</button>
          </form>
        )}
      </div>
    </div>
  )
}
