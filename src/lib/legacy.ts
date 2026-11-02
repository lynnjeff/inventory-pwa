import Dexie from 'dexie'
import { cache } from './db'
import type { Item, ItemFields } from './types'

export const LEGACY_DB = 'inventoryDB'
const DISMISS_KEY = 'inventory.legacyBannerDismissed'

export interface LegacyItem {
  id?: string | number
  name?: string
  barcode?: string
  quantity?: number
  targetQuantity?: number
  location?: string
  notes?: string
  lastUpdated?: number | string
}

type IdFactory = IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }

/** True when the named database already exists. Never creates one. */
export async function databaseExists(name: string): Promise<boolean> {
  const factory = indexedDB as IdFactory
  if (typeof factory.databases === 'function') {
    try {
      const list = await factory.databases()
      return list.some((db) => db.name === name)
    } catch {
      return databaseExistsByOpen(name)
    }
  }
  return databaseExistsByOpen(name)
}

/**
 * Open fallback for browsers without indexedDB.databases().
 * Opening a missing database fires an upgrade; that transaction is aborted and
 * the empty database we just created is removed. An existing database is only closed.
 */
export function databaseExistsByOpen(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    let created = false
    let settled = false
    const finish = (exists: boolean) => {
      if (settled) return
      settled = true
      resolve(exists)
    }
    const removeIfCreated = () => {
      if (!created) {
        finish(false)
        return
      }
      const del = indexedDB.deleteDatabase(name)
      del.onsuccess = () => finish(false)
      del.onerror = () => finish(false)
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(name)
    } catch {
      finish(false)
      return
    }
    request.onupgradeneeded = () => {
      created = true
      try { request.transaction?.abort() } catch { /* the abort surfaces as onerror */ }
    }
    request.onerror = () => removeIfCreated()
    request.onsuccess = () => {
      request.result.close()
      if (!created) finish(true)
      else removeIfCreated()
    }
  })
}

/** Read-only snapshot of the old app. Does not upgrade, write, or delete inventoryDB. */
export async function readLegacyItems(): Promise<LegacyItem[]> {
  if (!(await databaseExists(LEGACY_DB))) return []
  const legacy = new Dexie(LEGACY_DB, { autoOpen: false })
  try {
    await legacy.open()
    if (!legacy.tables.some((table) => table.name === 'items')) return []
    return await legacy.table('items').toArray() as LegacyItem[]
  } finally {
    legacy.close()
  }
}

export function mapLegacyItem(row: LegacyItem): ItemFields {
  const barcode = String(row.barcode ?? '').trim()
  const location = String(row.location ?? '').trim()
  const notes = String(row.notes ?? '').trim()
  return {
    barcode: barcode && barcode !== 'UNKNOWN' ? barcode : null,
    name: String(row.name ?? '').trim() || 'Unnamed item',
    quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)),
    target_quantity: Math.max(0, Math.floor(Number(row.targetQuantity) || 0)),
    location: location || null,
    notes: notes || null,
  }
}

/** Stable tag: the old id when present, otherwise barcode + name. */
export function legacyTag(row: LegacyItem): string {
  const id = String(row.id ?? '').trim()
  if (id) return `id:${id}`
  return barcodeNameTag(String(row.barcode ?? ''), String(row.name ?? ''))
}

export function barcodeNameTag(barcode: string | null | undefined, name: string): string {
  return `bn:${(barcode ?? '').trim().toLowerCase()}|${name.trim().toLowerCase()}`
}

function importedKey(orgId: string) {
  return `legacyImported:${orgId}`
}

export async function readImportedTags(orgId: string): Promise<Set<string>> {
  const row = await cache.meta.get(importedKey(orgId))
  if (!row) return new Set()
  try {
    const parsed = JSON.parse(row.value) as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : [])
  } catch {
    return new Set()
  }
}

async function writeImportedTags(orgId: string, tags: Set<string>) {
  await cache.meta.put({ key: importedKey(orgId), value: JSON.stringify([...tags]) })
}

export function legacyBannerDismissed(): boolean {
  return localStorage.getItem(DISMISS_KEY) === '1'
}

export function dismissLegacyBanner() {
  localStorage.setItem(DISMISS_KEY, '1')
}

export async function importLegacyItems(
  rows: LegacyItem[],
  orgId: string,
  existing: Item[],
  addItem: (fields: ItemFields) => Promise<unknown>,
  onProgress: (done: number, total: number) => void,
): Promise<{ created: number; skipped: number }> {
  const tags = await readImportedTags(orgId)
  for (const item of existing) tags.add(barcodeNameTag(item.barcode, item.name))
  let created = 0
  let skipped = 0
  const total = rows.length
  onProgress(0, total)
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const fields = mapLegacyItem(row)
    const idTag = legacyTag(row)
    const nameTag = barcodeNameTag(fields.barcode, fields.name)
    if (tags.has(idTag) || tags.has(nameTag)) {
      skipped++
      tags.add(idTag)
      tags.add(nameTag)
      onProgress(index + 1, total)
      continue
    }
    await addItem(fields)
    tags.add(idTag)
    tags.add(nameTag)
    await writeImportedTags(orgId, tags)
    created++
    onProgress(index + 1, total)
  }
  await writeImportedTags(orgId, tags)
  return { created, skipped }
}
