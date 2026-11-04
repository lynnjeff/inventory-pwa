import { useState } from 'react'
import { QTY_REASONS, type QtyReasonId } from '../lib/quantity'
import { input } from './ui'

export function QtyReasonSheet({
  from, to, onSave, onCancel,
}: {
  from: number
  to: number
  onSave: (reason: QtyReasonId, note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  const delta = to - from
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/70 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-center text-3xl font-semibold">{from} → {to} boxes</p>
        <p className="mt-1 text-center text-sm text-amber-300">{delta > 0 ? `+${delta}` : delta} pending reason</p>
        <p className="mt-4 mb-2 text-sm text-slate-300">Why did it change?</p>
        <div className="space-y-2">
          {QTY_REASONS.map((r) => (
            <button key={r.id} type="button" onClick={() => onSave(r.id, note.trim())}
              className="w-full rounded-lg border border-slate-700 px-3 py-2 text-left text-slate-100 hover:border-sky-500">
              {r.label}
            </button>
          ))}
        </div>
        <label className="mt-3 block space-y-1">
          <span className="text-sm text-slate-400">Optional note</span>
          <textarea className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
        </label>
        <button type="button" className="mt-3 text-sm text-slate-400 underline" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}