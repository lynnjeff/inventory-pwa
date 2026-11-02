import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from '../lib/AppContext'
import { downloadLegacyBackup } from '../lib/exportXlsx'
import {
  dismissLegacyBanner,
  importLegacyItems,
  legacyBannerDismissed,
  readLegacyItems,
  type LegacyItem,
} from '../lib/legacy'
import { btn, btnGhost, card } from './ui'

interface RescueState {
  rows: LegacyItem[]
  checked: boolean
  dismissed: boolean
  busy: boolean
  progress: { done: number; total: number } | null
  result: string | null
  error: string | null
  dismiss: () => void
  importIntoOrg: () => Promise<void>
  download: () => void
}

const RescueCtx = createContext<RescueState | undefined>(undefined)

export function LegacyRescueProvider({ children }: { children: ReactNode }) {
  const { org, items, addItem } = useApp()
  const [rows, setRows] = useState<LegacyItem[]>([])
  const [checked, setChecked] = useState(false)
  const [dismissed, setDismissed] = useState(() => legacyBannerDismissed())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    readLegacyItems()
      .then((found) => { if (live) setRows(found) })
      .catch((err) => {
        console.error(err)
        if (live) setError('Could not read the old app database.')
      })
      .finally(() => { if (live) setChecked(true) })
    return () => { live = false }
  }, [])

  const dismiss = useCallback(() => {
    dismissLegacyBanner()
    setDismissed(true)
  }, [])

  const importIntoOrg = useCallback(async () => {
    if (!org) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const { created, skipped } = await importLegacyItems(rows, org.id, items, addItem, (done, total) => {
        setProgress({ done, total })
      })
      const createdLabel = created === 1 ? '1 item' : `${created} items`
      const skippedLabel = skipped === 1 ? '1 duplicate' : `${skipped} duplicates`
      setResult(`Imported ${createdLabel}. Skipped ${skippedLabel}.`)
    } catch (err) {
      console.error(err)
      setError('Import stopped before it finished. Items already copied stay in this organization. Try again to continue.')
    } finally {
      setBusy(false)
    }
  }, [addItem, items, org, rows])

  const download = useCallback(() => {
    setError(null)
    try {
      downloadLegacyBackup(rows)
    } catch (err) {
      console.error(err)
      setError('Could not download the backup.')
    }
  }, [rows])

  const value = useMemo<RescueState>(() => ({
    rows, checked, dismissed, busy, progress, result, error, dismiss, importIntoOrg, download,
  }), [rows, checked, dismissed, busy, progress, result, error, dismiss, importIntoOrg, download])

  return <RescueCtx.Provider value={value}>{children}</RescueCtx.Provider>
}

export function useLegacyRescue() {
  const ctx = useContext(RescueCtx)
  if (!ctx) throw new Error('useLegacyRescue must be used within LegacyRescueProvider')
  return ctx
}

export function LegacyBanner() {
  const rescue = useLegacyRescue()
  if (!rescue.checked || rescue.dismissed || rescue.rows.length === 0) return null
  const noun = rescue.rows.length === 1 ? 'item' : 'items'
  return (
    <div className="border-b border-amber-700/60 bg-amber-950/80 px-4 py-3">
      <div className="mx-auto max-w-2xl space-y-3">
        <p className="font-medium text-amber-100">Found {rescue.rows.length} {noun} from the old app</p>
        <LegacyActions />
        <button type="button" className="text-sm text-amber-200/80 underline" onClick={rescue.dismiss} disabled={rescue.busy}>Dismiss</button>
      </div>
    </div>
  )
}

export function LegacyActions() {
  const { org } = useApp()
  const rescue = useLegacyRescue()
  if (!rescue.checked) return <p className="text-sm text-slate-400">Checking this device for the old app…</p>
  if (rescue.rows.length === 0) {
    return rescue.error
      ? <p className="text-sm text-red-400">{rescue.error}</p>
      : <p className="text-sm text-slate-400">No data from the old app was found on this device.</p>
  }
  const label = org ? `Import into ${org.name}` : 'Import into an organization'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={rescue.busy || !org} onClick={() => void rescue.importIntoOrg()}>
          {rescue.busy && rescue.progress ? `Importing ${rescue.progress.done} of ${rescue.progress.total}…` : label}
        </button>
        <button type="button" className={btnGhost} disabled={rescue.busy} onClick={rescue.download}>Download backup</button>
      </div>
      {!org && <p className="text-sm text-slate-400">Create or choose an organization before importing.</p>}
      {rescue.result && <p className="text-sm text-emerald-400">{rescue.result}</p>}
      {rescue.error && <p className="text-sm text-red-400">{rescue.error}</p>}
    </div>
  )
}

export function LegacySettingsCard() {
  const rescue = useLegacyRescue()
  const count = rescue.rows.length
  return (
    <div className={card}>
      <p className="font-medium">Old app data</p>
      {rescue.checked && count > 0 && (
        <p className="mt-1 text-sm text-slate-300">Found {count} {count === 1 ? 'item' : 'items'} from the old app on this device. The original database is left untouched.</p>
      )}
      <div className="mt-3">
        <LegacyActions />
      </div>
    </div>
  )
}
