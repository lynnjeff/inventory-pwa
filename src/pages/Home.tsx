import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { QtyReasonSheet } from '../components/QtyReasonSheet'
import { btnGhost, input } from '../components/ui'
import type { QtyReasonId } from '../lib/quantity'
import { useApp } from '../lib/AppContext'
import { exportOrderList } from '../lib/exportXlsx'
import type { Item } from '../lib/types'

const needs = (i: Item) => i.target_quantity - i.quantity > 0

export default function Home() {
  const { items, loading, org, adjustQuantity, markOrderReceived, unsavedItemIds } = useApp()
  const [q, setQ] = useState('')
  const [onlyNeeds, setOnlyNeeds] = useState(false)
  const [pending, setPending] = useState<{ id: string; from: number; delta: number } | null>(null)
  const nav = useNavigate()
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items
      .filter((i) => !s || [i.part_number, i.brand, i.name, i.barcode].some((v) => (v ?? '').toLowerCase().includes(s)))
      .filter((i) => !onlyNeeds || needs(i))
      .sort((a, b) => Number(needs(b)) - Number(needs(a)) || a.name.localeCompare(b.name))
  }, [items, q, onlyNeeds])

  const received = async () => {
    if (window.confirm('Mark order received? Every item quantity will be set to its target.')) await markOrderReceived()
  }

  return (
    <div className="min-h-screen">
      <Header title="Inventory" showScan />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-24">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-slate-400">Overview · {list.length} item{list.length === 1 ? '' : 's'}</p>
          <button className={`${btnGhost} text-sm ${onlyNeeds ? 'border-amber-500 text-amber-300' : ''}`} onClick={() => setOnlyNeeds((v) => !v)}>Needs ordering</button>
          <button className={`${btnGhost} text-sm`} disabled={!items.length} onClick={() => { if (!exportOrderList(items, org?.name)) alert('Nothing needs ordering.') }}>Export Order List (XLSX)</button>
        </div>
        <input className={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part #, brand, or name" />
        {loading ? <p className="text-slate-400">Loading…</p> : !list.length ? (
          <p className="text-slate-400">No items yet. Scan a barcode or <button className="underline" onClick={() => nav('/new')}>add one</button>.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((i) => {
              const order = Math.max(i.target_quantity - i.quantity, 0)
              const color = i.quantity === 0 ? 'text-red-400' : i.quantity < 5 ? 'text-amber-400' : 'text-emerald-400'
              return (
                <li key={i.id} onClick={() => nav(`/item/${i.id}`)} className="cursor-pointer rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {[i.part_number, i.brand].filter(Boolean).join(' · ') || i.name}
                        {unsavedItemIds.includes(i.id) && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-200">unsaved</span>}
                      </p>
                      <p className="truncate text-sm text-slate-300">{i.name}</p>
                      <p className="truncate text-xs text-slate-500">{i.barcode ? `Barcode ${i.barcode}` : 'No barcode'}{i.location ? ` · ${i.location}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button className="h-9 w-9 rounded-lg bg-slate-800 text-lg disabled:opacity-40" disabled={i.quantity <= 0} onClick={() => setPending({ id: i.id, from: i.quantity, delta: -1 })}>-</button>
                      <button className="h-9 w-9 rounded-lg bg-slate-800 text-lg" onClick={() => setPending({ id: i.id, from: i.quantity, delta: 1 })}>+</button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 text-center text-xs text-slate-400">
                    <div>On hand<p className={`text-base font-semibold ${color}`}>{i.quantity}</p></div>
                    <div>Target<p className="text-base font-semibold text-slate-200">{i.target_quantity}</p></div>
                    <div>Order<p className={`text-base font-semibold ${order ? 'text-amber-300' : 'text-slate-500'}`}>{order}</p></div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {pending && (
          <QtyReasonSheet
            from={pending.from}
            to={Math.max(0, pending.from + pending.delta)}
            onCancel={() => setPending(null)}
            onSave={(reason: QtyReasonId, note) => { void adjustQuantity(pending.id, pending.delta, reason, note || null); setPending(null) }}
          />
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <button className={btnGhost} disabled={!items.length} onClick={() => void received()}>Mark order received (reset to target)</button>
          <button className={btnGhost} onClick={() => nav('/import')}>CSV Import</button>
          <button className={btnGhost} onClick={() => nav('/new')}>New item</button>
        </div>
      </main>
    </div>
  )
}
