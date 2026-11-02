import { useState } from 'react'
import { Header } from '../components/Header'
import { btn, card } from '../components/ui'
import { useApp } from '../lib/AppContext'
import { parseInventoryCsv } from '../lib/csv'
import { mapLegacyItem, readLegacyItems } from '../lib/legacy'
import type { ItemFields } from '../lib/types'

export default function Import() {
  const { items, addItem, updateItem, syncNow } = useApp()
  const [rows, setRows] = useState<ItemFields[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onFile = (f: File | undefined) => {
    setErr(null); setMsg(null); setRows([])
    if (!f) return
    if (f.size > 5 * 1024 * 1024) return setErr('File is larger than 5MB.')
    const r = new FileReader()
    r.onload = () => { try { setRows(parseInventoryCsv(String(r.result))) } catch (e) { setErr((e as Error).message) } }
    r.onerror = () => setErr('Failed to read file. Please try again.')
    r.readAsText(f)
  }

  const loadLegacy = async () => {
    setErr(null); setMsg(null)
    const legacy = await readLegacyItems()
    if (!legacy.length) return setErr('No data from the old app was found on this device.')
    setRows(legacy.map((row) => mapLegacyItem(row)))
  }

  const run = async () => {
    setBusy(true); setErr(null)
    try {
      let created = 0, updated = 0
      for (const r of rows) {
        const hit = r.barcode ? items.find((i) => i.barcode === r.barcode) : undefined
        if (hit) { await updateItem(hit.id, r); updated++ } else { await addItem(r); created++ }
      }
      await syncNow().catch(() => undefined)
      setMsg(`Import complete: ${created} created, ${updated} updated.`); setRows([])
    } catch (e) {
      console.error(e); setErr('Import failed. Please try again.')
    } finally { setBusy(false) }
  }

  const updates = rows.filter((r) => r.barcode && items.some((i) => i.barcode === r.barcode)).length

  return (
    <div className="min-h-screen">
      <Header title="CSV Import" back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-24">
        <div className={card}>
          <p>Upload a CSV file to bulk add or update items.</p>
          <p className="mt-1 text-xs text-slate-400">.csv up to 5MB · Columns: barcode, name, quantity, targetQuantity, location, notes</p>
          <input className="mt-3 block w-full text-sm" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <div className={card}>
          <p className="text-sm">Moving from the old single-device app? Load its data from this phone.</p>
          <button className="mt-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm" onClick={() => void loadLegacy()}>Load old app data</button>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        {rows.length > 0 && (
          <div className={card}>
            <p className="mb-2 font-medium">Preview · {rows.length - updates} new, {updates} updates</p>
            <div className="max-h-80 overflow-auto text-sm">
              <table className="w-full text-left">
                <thead className="text-slate-400"><tr><th>barcode</th><th>name</th><th>qty</th><th>target</th></tr></thead>
                <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i} className="border-t border-slate-800"><td>{r.barcode ?? '—'}</td><td>{r.name}</td><td>{r.quantity}</td><td>{r.target_quantity}</td></tr>)}</tbody>
              </table>
            </div>
            <button className={`${btn} mt-3 w-full`} disabled={busy} onClick={() => void run()}>{busy ? 'Importing…' : 'Import'}</button>
          </div>
        )}
      </main>
    </div>
  )
}
