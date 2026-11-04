import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Header } from '../components/Header'
import { useApp } from '../lib/AppContext'
import { listItemHistory, type StockEvent } from '../lib/history'
import { eventMatchesFilter, formatActor, formatEventWhen, quantityBefore, reasonLabel, type HistoryFilter } from '../lib/quantity'

const FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'short_over', label: 'Short/over deliveries' },
  { id: 'used', label: 'Used' },
  { id: 'corrections', label: 'Corrections' },
]

export default function History() {
  const { id } = useParams()
  const { items } = useApp()
  const item = items.find((i) => i.id === id)
  const [events, setEvents] = useState<StockEvent[]>([])
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    let live = true
    setLoading(true)
    listItemHistory(id)
      .then((rows) => { if (live) setEvents(rows) })
      .catch((e) => { console.error(e); if (live) setErr('Could not load history.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [id])

  const shown = events.filter((e) => eventMatchesFilter(e.reason, filter))
  const title = item ? `${item.part_number ? item.part_number + ' · ' : ''}${item.brand ? item.brand + ' · ' : ''}${item.name}` : 'Item'

  return (
    <div className="min-h-screen">
      <Header title="History" back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-24">
        <p className="text-sm text-slate-300">{title}</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm ${filter === f.id ? 'bg-sky-600 text-white' : 'border border-slate-700 text-slate-300'}`}>
              {f.label}
            </button>
          ))}
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        {loading ? <p className="text-slate-400">Loading…</p> : !shown.length ? (
          <p className="text-slate-400">No matching changes yet.</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((e) => {
              const before = quantityBefore(e.quantity_after, e.delta)
              const up = e.delta > 0
              return (
                <li key={e.id} className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <p className={`text-lg font-semibold ${up ? 'text-emerald-400' : 'text-amber-300'}`}>
                    {e.delta > 0 ? `+${e.delta}` : e.delta} boxes
                  </p>
                  <p className="text-slate-100">{reasonLabel(e.reason)}</p>
                  <p className="text-sm text-slate-400">
                    {formatActor(e.email)} · {formatEventWhen(e.created_at)}
                    {before != null && e.quantity_after != null ? ` · ${before} → ${e.quantity_after}` : ''}
                  </p>
                  {e.note && <p className="mt-1 text-sm text-slate-300">“{e.note}”</p>}
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}