import Dexie, { type Table } from 'dexie'
import type { Item, OutboxEntry } from './types'

/** Local offline cache. Supabase is the source of truth. */
class CacheDB extends Dexie {
  items!: Table<Item, string>
  outbox!: Table<OutboxEntry, number>
  meta!: Table<{ key: string; value: string }, string>
  constructor() {
    super('inventoryCache')
    this.version(1).stores({
      items: 'id, org_id, [org_id+name], [org_id+barcode], updated_at',
      outbox: '++seq, org_id, createdAt',
      meta: 'key',
    })
  }
}

export const cache = new CacheDB()

/** Read the legacy (v1 app) local DB, if present on this device, for one-time upload. */
export async function readLegacyItems(): Promise<Array<Record<string, unknown>>> {
  if (!(await Dexie.exists('inventoryDB'))) return []
  const legacy = new Dexie('inventoryDB')
  legacy.version(2).stores({ items: 'id, name, barcode, quantity, targetQuantity, lastUpdated' })
  try {
    return await legacy.table('items').toArray()
  } finally {
    legacy.close()
  }
}
