import { useState } from 'react'
import { useApp } from '../lib/AppContext'
import { mutationItemId } from '../lib/sync'
import { btn, btnGhost } from './ui'

export function SyncIssues() {
  const { syncErrors, items, retrySync } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!syncErrors.length) return null
  const n = syncErrors.length
  return (
    <div className="border-b border-amber-700/70 bg-amber-950 px-4 py-3">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-100">{n} {n === 1 ? 'change' : 'changes'} didn’t save</p>
          <p className="text-sm text-amber-100/80">They’re kept on this phone. Nothing is lost.</p>
        </div>
        <button type="button" className={btn} disabled={busy} onClick={() => { setBusy(true); void retrySync().finally(() => setBusy(false)) }}>Retry</button>
        <button type="button" className={btnGhost} onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Details'}</button>
      </div>
      {open && (
        <ul className="mx-auto mt-3 max-w-2xl space-y-2 text-sm">
          {syncErrors.map((entry) => {
            const id = mutationItemId(entry.mutation)
            const item = items.find((row) => row.id === id)
            const label = item ? [item.part_number, item.brand, item.name].filter(Boolean).join(' · ') : (id ?? 'Change')
            return (
              <li key={entry.seq} className="rounded-lg border border-amber-800 bg-slate-950/50 p-2 text-amber-50">
                <span className="mr-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-200">unsaved</span>
                {label}
                <p className="mt-1 text-amber-200/80">{entry.error}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}