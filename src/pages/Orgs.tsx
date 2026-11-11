import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { btn, card, input } from '../components/ui'
import { useApp } from '../lib/AppContext'
import { signOutAndWipe } from '../lib/sync'

export default function Orgs({ firstRun }: { firstRun?: boolean }) {
  const { orgs, org, setOrgId, createOrg, session } = useApp()
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { await createOrg(name.trim()); setName(''); nav('/') } catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen">
      <Header title={firstRun ? 'Welcome' : 'Organizations'} back={!firstRun} />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-24">
        {firstRun && <p className="text-slate-300">Create an organization to start tracking inventory, or ask an admin to invite <b>{session?.user.email}</b>.</p>}
        {orgs.length > 0 && (
          <ul className="space-y-2">
            {orgs.map((o) => (
              <li key={o.id}>
                <button onClick={() => { setOrgId(o.id); nav('/') }}
                  className={`${card} flex w-full justify-between text-left ${o.id === org?.id ? 'border-sky-600' : ''}`}>
                  <span>{o.name}</span><span className="text-sm text-slate-400">{o.role}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className={`${card} space-y-2`}>
          <p className="font-medium">Create organization</p>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name" required />
          {err && <p className="text-sm text-red-400">{err}</p>}
          <button className={`${btn} w-full`} disabled={busy || !name.trim()}>Create</button>
        </form>
        <button className="text-sm text-slate-400 underline" onClick={() => void signOutAndWipe()}>Sign out</button>
      </main>
    </div>
  )
}
