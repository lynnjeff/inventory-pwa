import { cache } from './db'
import { typedQuantityDelta } from './quantity'
import { supabase } from './supabase'
import type { Item, ItemFields, Mutation } from './types'

const COLS = 'id, org_id, barcode, name, quantity, target_quantity, location, notes, updated_at'

/** Apply a mutation to the local cache immediately (optimistic). */
export async function applyLocal(m: Mutation) {
  switch (m.kind) {
    case 'insert':
      await cache.items.put(m.item)
      break
    case 'update':
      await cache.items.update(m.id, { ...m.patch, updated_at: new Date().toISOString() })
      break
    case 'adjust': {
      const it = await cache.items.get(m.id)
      if (it) await cache.items.update(m.id, { quantity: Math.max(0, it.quantity + m.delta) })
      break
    }
    case 'delete':
      await cache.items.delete(m.id)
      break
    case 'order_received':
      await cache.items.where('org_id').equals(m.org_id).modify((it) => { it.quantity = it.target_quantity })
      break
  }
}

export async function enqueue(org_id: string, m: Mutation) {
  await applyLocal(m)
  await cache.outbox.add({ org_id, createdAt: Date.now(), mutation: m })
  void flushOutbox()
}

/** Save an item edit. Quantity is a delta from the loaded value, via the same adjust queue as +/-. */
export async function saveItemEdit(orgId: string, id: string, fields: ItemFields, loadedQuantity: number) {
  const { quantity, ...patch } = fields
  await enqueue(orgId, { kind: 'update', id, patch })
  const delta = typedQuantityDelta(loadedQuantity, quantity)
  if (delta !== 0) await enqueue(orgId, { kind: 'adjust', id, delta })
}

async function send(m: Mutation) {
  switch (m.kind) {
    case 'insert': {
      const { updated_at: _u, ...row } = m.item
      void _u
      const { error } = await supabase.from('items').upsert(row, { onConflict: 'id' })
      if (error) throw error
      return
    }
    case 'update': {
      const { error } = await supabase.from('items').update(m.patch).eq('id', m.id)
      if (error) throw error
      return
    }
    case 'adjust': {
      const { error } = await supabase.rpc('adjust_quantity', { p_item_id: m.id, p_delta: m.delta })
      if (error) throw error
      return
    }
    case 'delete': {
      const { error } = await supabase.from('items').delete().eq('id', m.id)
      if (error) throw error
      return
    }
    case 'order_received': {
      const { error } = await supabase.rpc('mark_order_received', { p_org_id: m.org_id })
      if (error) throw error
      return
    }
  }
}

function isNetworkError(e: unknown) {
  const msg = String((e as { message?: string })?.message ?? e)
  return !navigator.onLine || /fetch|network|Failed to fetch|Load failed/i.test(msg)
}

let flushing: Promise<void> | null = null
const listeners = new Set<() => void>()
export function onSyncChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
const notify = () => listeners.forEach((f) => f())

/** Send queued mutations in order. Network errors stop the flush; server rejections are dropped and recorded. */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    try {
      if (!navigator.onLine) return
      const { data } = await supabase.auth.getSession()
      if (!data.session) return
      const entries = await cache.outbox.orderBy('seq').toArray()
      for (const e of entries) {
        try {
          await send(e.mutation)
          await cache.outbox.delete(e.seq!)
        } catch (err) {
          if (isNetworkError(err)) break
          console.error('Sync rejected', e, err)
          await cache.meta.put({ key: `rejected:${e.seq}`, value: JSON.stringify({ e, err: String((err as Error)?.message ?? err) }) })
          await cache.outbox.delete(e.seq!)
        }
      }
    } finally {
      flushing = null
      notify()
    }
  })()
  return flushing
}

/** Replace the cache for an org with server truth, then re-apply any still-pending local mutations. */
export async function pullOrg(org_id: string): Promise<void> {
  const { data, error } = await supabase.from('items').select(COLS).eq('org_id', org_id).order('name')
  if (error) throw error
  const pending = await cache.outbox.where('org_id').equals(org_id).sortBy('seq')
  await cache.transaction('rw', cache.items, async () => {
    await cache.items.where('org_id').equals(org_id).delete()
    await cache.items.bulkPut((data ?? []) as Item[])
  })
  for (const p of pending) await applyLocal(p.mutation)
  notify()
}

export async function pendingCount(): Promise<number> {
  return cache.outbox.count()
}

export function startAutoSync(getOrg: () => string | null) {
  const run = async () => {
    await flushOutbox()
    const org = getOrg()
    if (org && navigator.onLine) await pullOrg(org).catch((e) => console.warn('pull failed', e))
  }
  window.addEventListener('online', run)
  const t = window.setInterval(run, 60_000)
  return () => { window.removeEventListener('online', run); window.clearInterval(t) }
}
