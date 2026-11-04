import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Header } from '../components/Header'
import { btn, card, input } from '../components/ui'
import { useApp } from '../lib/AppContext'

export default function ItemForm() {
  const { id, barcode: routeBarcode } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { items, org, addItem, saveItem, deleteItem } = useApp()
  const item = useMemo(() => items.find((i) => i.id === id), [items, id])
  const editing = Boolean(id)
  const [barcode, setBarcode] = useState(routeBarcode ?? sp.get('barcode') ?? '')
  const [name, setName] = useState('')
  const [qty, setQty] = useState('0')
  const [loadedQty, setLoadedQty] = useState(0)
  const [target, setTarget] = useState('0')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (item && !loaded) {
      setBarcode(item.barcode ?? ''); setName(item.name); setQty(String(item.quantity)); setLoadedQty(item.quantity)
      setTarget(String(item.target_quantity)); setLocation(item.location ?? ''); setNotes(item.notes ?? '')
      setLoaded(true)
    }
  }, [item, loaded])

  const canDelete = org?.role === 'owner' || org?.role === 'admin'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    const q = Number(qty), t = Number(target || '0')
    if (!name.trim()) return setErr('Name is required')
    if (!Number.isInteger(q) || q < 0) return setErr('Quantity must be a whole number ≥ 0')
    if (!Number.isInteger(t) || t < 0) return setErr('Target quantity must be a whole number ≥ 0')
    const bc = barcode.trim() || null
    if (bc && items.some((i) => i.barcode === bc && i.id !== id)) return setErr('Another item already uses this barcode')
    const fields = { barcode: bc, name: name.trim(), quantity: q, target_quantity: t, location: location.trim() || null, notes: notes.trim() || null }
    try {
      if (editing && item) await saveItem(item.id, fields, loadedQty)
      else await addItem(fields)
      nav('/')
    } catch (ex) {
      console.error(ex); setErr('Failed to save item. Please try again.')
    }
  }

  const remove = async () => {
    if (item && window.confirm('Delete this item? This cannot be undone.')) { await deleteItem(item.id); nav('/') }
  }

  if (editing && !item) return <div className="min-h-screen"><Header title="Edit Item" back /><p className="p-4 text-slate-400">Item not found.</p></div>

  const field = (label: string, el: React.ReactNode) => <label className="block space-y-1"><span className="text-sm text-slate-300">{label}</span>{el}</label>

  return (
    <div className="min-h-screen">
      <Header title={editing ? 'Edit Item' : 'New Item'} back />
      <main className="px-4 pt-4 pb-32">
        <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
          {err && <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">{err}</div>}
          {item && (
            <div className={card}>
              <p className="text-sm text-slate-400">Stock summary</p>
              <p className="mt-1">On hand <b>{item.quantity}</b> · Target <b>{item.target_quantity}</b> · Order <b>{Math.max(item.target_quantity - item.quantity, 0)}</b></p>
              <Link to={`/item/${item.id}/history`} className="mt-2 inline-block text-sm text-sky-400">History</Link>
            </div>
          )}
          {field('Barcode', <input className={input} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Optional" />)}
          {field('Name', <input className={input} value={name} onChange={(e) => setName(e.target.value)} required />)}
          <div className="grid grid-cols-2 gap-3">
            {field('Quantity', <input className={input} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />)}
            {field('Target quantity', <input className={input} inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />)}
          </div>
          {field('Location', <input className={input} value={location} onChange={(e) => setLocation(e.target.value)} />)}
          {field('Notes', <textarea className={input} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />)}
          <div className="flex gap-2">
            <button className={`${btn} flex-1`}>Save</button>
            {item && canDelete && <button type="button" onClick={() => void remove()} className="rounded-lg border border-red-500/50 px-4 py-2 text-red-300">Delete</button>}
          </div>
        </form>
      </main>
    </div>
  )
}
