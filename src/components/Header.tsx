import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../lib/AppContext'

export function Header({ title, showScan, back }: { title: string; showScan?: boolean; back?: boolean }) {
  const nav = useNavigate()
  const { orgs, org, setOrgId, online, pending, syncNow } = useApp()
  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        {back && <button onClick={() => nav(-1)} className="rounded-lg px-2 py-1 text-slate-300 hover:bg-slate-800">←</button>}
        <h1 className="flex-1 truncate text-lg font-semibold">{title}</h1>
        <button onClick={() => void syncNow()} title="Sync now"
          className={`rounded-full px-2 py-0.5 text-xs ${online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
          {online ? 'Online' : 'Offline'}{pending ? ` · ${pending} pending` : ''}
        </button>
        {showScan && <Link to="/scan" className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium">Scan</Link>}
      </div>
      {orgs.length > 0 && (
        <div className="mx-auto mt-2 flex max-w-2xl items-center gap-2 text-sm">
          <select value={org?.id ?? ''} onChange={(e) => setOrgId(e.target.value)}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5">
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.role})</option>)}
          </select>
          <Link to="/orgs" className="rounded-lg border border-slate-700 px-2 py-1.5 text-slate-300">Orgs</Link>
          <Link to="/members" className="rounded-lg border border-slate-700 px-2 py-1.5 text-slate-300">Members</Link>
        </div>
      )}
    </header>
  )
}
