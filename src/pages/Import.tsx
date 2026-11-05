import { useMemo, useState } from 'react'
import { Header } from '../components/Header'
import { btn, card, input } from '../components/ui'
import { useApp } from '../lib/AppContext'
import { draftsToItems, flagImportRows, importFlagLabel, importIsClean, parseImportFile, type ImportDraft } from '../lib/importPreview'
import { readLegacyItems } from '../lib/legacy'

export default function Import() {
  const { items, addItem, syncNow } = useApp()
  const [rows, setRows] = useState<ImportDraft[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const flagged = useMemo(() => flagImportRows(rows, items), [rows, items])
  const clean = importIsClean(flagged)
  const readyCount = flagged.filter((row) => !row.skip && row.flags.length === 0).length
  const flagCount = flagged.filter((row) => !row.skip && row.flags.length > 0).length

  const onFile = (f: File | undefined) => {
    setErr(null); setMsg(null); setRows([])
    if (!f) return
    if (f.size > 5 * 1024 * 1024) return setErr('File is larger than 5MB.')
    const r = new FileReader()
    r.onload = () => {
      try { setRows(parseImportFile(String(r.result))) } catch (e) { setErr((e as Error).message) }
    }
    r.onerror = () => setErr('Failed to read file. Please try again.')
    r.readAsText(f)
  }

  const loadLegacy = async () => {
    setErr(null); setMsg(null)
    const legacy = await readLegacyItems()
    if (!legacy.length) return setErr('No data from the old app was found on this device.')
    setRows(legacy.map((row, i) => ({
      line: i + 1,
      part_number: String(row.barcode ?? '').trim() === 'UNKNOWN' ? '' : String(row.barcode ?? '').trim(),
      brand: '',
      name: String(row.name ?? '').trim(),
      quantityRaw: String(row.quantity ?? ''),
      target_quantity: Math.max(0, Math.floor(Number(row.targetQuantity) || 0)),
      location: String(row.location ?? '').trim() || null,
      notes: String(row.notes ?? '').trim() || null,
      barcode: String(row.barcode ?? '').trim() && String(row.barcode) !== 'UNKNOWN' ? String(row.barcode).trim() : null,
      flags: [],
      skip: false,
    })))
  }

  const patch = (line: number, next: Partial<ImportDraft>) => {
    setRows((current) => current.map((row) => row.line === line ? { ...row, ...next } : row))
  }

  const run = async () => {
    if (!importIsClean(flagged)) return
    setBusy(true); setErr(null)
    try {
      const cleanRows = draftsToItems(flagged)
      for (const row of cleanRows) await addItem(row)
      await syncNow().catch(() => undefined)
      setMsg(`Saved ${cleanRows.length} items. Nothing was written before the rows were clean.`)
      setRows([])
    } catch (e) {
      console.error(e); setErr('Import failed. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen">
      <Header title="Import" back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-24">
        <div className={card}>
          <p>Preview a CSV before anything is saved. Rows are matched on part # and brand.</p>
          <p className="mt-1 text-xs text-slate-400">Columns: part #, brand, name, quantity. Barcode is optional.</p>
          <input className="mt-3 block w-full text-sm" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <div className={card}>
          <p className="text-sm">Load the old app’s on-device items into the same preview. They are not saved until the flags are clear.</p>
          <button className="mt-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm" onClick={() => void loadLegacy()}>Load old app data</button>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        {flagged.length > 0 && (
          <div className={card}>
            <p className="mb-2 font-medium">{readyCount} ready · {flagCount} to fix or skip</p>
            <ul className="max-h-96 space-y-3 overflow-auto text-sm">
              {flagged.map((row) => (
                <li key={row.line} className={`rounded-lg border p-2 ${row.skip ? 'border-slate-800 opacity-50' : row.flags.length ? 'border-amber-600/60' : 'border-slate-800'}`}>
                  <p className="font-medium">{row.part_number || '—'} · {row.brand || 'No brand'}</p>
                  <p className="text-slate-300">{row.name || 'No name'} · qty {row.quantityRaw || '—'}</p>
                  {row.skip && <button type="button" className="text-sm text-slate-400 underline" onClick={() => patch(row.line, { skip: false })}>Undo skip</button>}
                  {!!row.flags.length && !row.skip && (
                    <div className="mt-2 space-y-2">
                      <p className="text-amber-300">{row.flags.map(importFlagLabel).join(' · ')}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input className={input} value={row.part_number} placeholder="Part #" onChange={(e) => patch(row.line, { part_number: e.target.value })} />
                        <input className={input} value={row.brand} placeholder="Brand" onChange={(e) => patch(row.line, { brand: e.target.value })} />
                        <input className={input} value={row.name} placeholder="Name" onChange={(e) => patch(row.line, { name: e.target.value })} />
                        <input className={input} value={row.quantityRaw} placeholder="Qty" inputMode="numeric" onChange={(e) => patch(row.line, { quantityRaw: e.target.value })} />
                      </div>
                      <button type="button" className="text-sm text-slate-400 underline" onClick={() => patch(row.line, { skip: true })}>Skip row</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <button className={`${btn} mt-3 w-full`} disabled={busy || !clean} onClick={() => void run()}>
              {busy ? 'Saving…' : clean ? `Save ${readyCount} items` : `Fix or skip ${flagCount} flagged rows`}
            </button>
            <p className="mt-2 text-xs text-slate-500">Nothing is written until every remaining row is clean.</p>
          </div>
        )}
      </main>
    </div>
  )
}
