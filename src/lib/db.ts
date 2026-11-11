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
    this.version(2).stores({
      items: 'id, org_id, [org_id+name], [org_id+barcode], updated_at',
      outbox: '++seq, org_id, user_id, createdAt',
      meta: 'key',
    })
  }
}

export const cache = new CacheDB()
