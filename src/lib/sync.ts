import { cache } from './db'
import { typedQuantityDelta } from './quantity'
import { supabase } from './supabase'
import { uuid } from './uuid'
import type { Item, ItemFields, Mutation } from './types'

const COLS = 'id, org_id, part_number, brand, barcode, name, quantity, target_quantity, location, notes, updated_at'

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
      await cache.items.where('org_id').equals(m.org_id).modify((it) => {
        if (it.quantity >= it.target_quantity) return false
        it.quantity = it.target_quantity
      })
      break
  }
}

export async function enqueue(org_id: string, m: Mutation) {
  const { data } = await supabase.auth.getSession()
  const user_id = data.session?.user.id
  // Per-mutation idempotency key so a retried request cannot apply a quantity change twice.
  if (m.kind === 'adjust' && !m.key) m = { ...m, key: uuid() }
  await applyLocal(m)
  await cache.outbox.add({ org_id, user_id, createdAt: Date.now(), mutation: m })
  void flushOutbox()
}

/** Save an item edit. Quantity is a delta from the loaded value, via the same adjust queue as +/-. */
export async function saveItemEdit(
  orgId: string,
  id: string,
  fields: ItemFields,
  loadedQuantity: number,
  reason?: string | null,
  note?: string | null,
) {
  const { quantity, ...patch } = fields
  await enqueue(orgId, { kind: 'update', id, patch })
  const delta = typedQuantityDelta(loadedQuantity, quantity)
  if (delta !== 0) await enqueue(orgId, { kind: 'adjust', id, delta, reason: reason ?? null, note: note ?? null })
}

async function send(m: Mutation) {
  switch (m.kind) {
    case 'insert': {
      const { updated_at: _u, ...row } = m.item
      void _u
      const { error } = await supabase.from('items').upsert(row, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw error
      return
    }
    case 'update': {
      // quantity/org_id are server-controlled (quantity only via adjust_quantity); never send them in an edit.
      const { quantity: _q, org_id: _o, ...patch } = m.patch as Record<string, unknown>
      void _q; void _o
      const { error } = await supabase.from('items').update(patch).eq('id', m.id)
      if (error) throw error
      return
    }
    case 'adjust': {
      const { error } = await supabase.rpc('adjust_quantity', {
        p_item_id: m.id, p_delta: m.delta, p_reason: m.reason ?? null, p_note: m.note ?? null,
        p_idempotency_key: m.key ?? null,
      })
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

/** Send queued mutations in order. Network errors stop the flush. Server rejections stay on this device. */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    try {
      if (!navigator.onLine) return
      const { data } = await supabase.auth.getSession()
      if (!data.session) return
      const uid = data.session.user.id
      // Outbox is scoped per user: never send (or show) another account's queued changes.
      // Entries queued before scoping existed have no owner; they belong to this device's current user.
      const all = await cache.outbox.orderBy('seq').toArray()
      for (const e of all) if (!e.user_id && e.seq != null) { await cache.outbox.update(e.seq, { user_id: uid }); e.user_id = uid }
      const entries = all.filter((e) => e.user_id === uid)
      for (const e of entries) {
        if (e.error) continue
        // Queued adjusts from before idempotency keys existed: assign and persist a key so retries stay safe.
        if (e.mutation.kind === 'adjust' && !e.mutation.key && e.seq != null) {
          e.mutation = { ...e.mutation, key: uuid() }
          await cache.outbox.update(e.seq, { mutation: e.mutation })
        }
        try {
          await send(e.mutation)
          await cache.outbox.delete(e.seq!)
        } catch (err) {
          if (isNetworkError(err)) break
          console.error('Sync rejected', e, err)
          await cache.outbox.update(e.seq!, { error: String((err as Error)?.message ?? err) })
        }
      }
    } finally {
      flushing = null
      notify()
    }
  })()
  return flushing
}

export async function listSyncErrors() {
  const uid = await currentUserId()
  return (await cache.outbox.toArray()).filter((entry) => entry.error && (!entry.user_id || entry.user_id === uid))
}

async function currentUserId() {
  return (await supabase.auth.getSession()).data.session?.user.id
}

export function mutationItemId(m: Mutation): string | null {
  if (m.kind === 'insert') return m.item.id
  if (m.kind === 'update' || m.kind === 'adjust' || m.kind === 'delete') return m.id
  return null
}

export async function retryFailed(): Promise<void> {
  const failed = await listSyncErrors()
  await cache.transaction('rw', cache.outbox, async () => {
    for (const entry of failed) {
      if (entry.seq == null) continue
      await cache.outbox.where('seq').equals(entry.seq).modify((row) => { delete row.error })
    }
  })
  await flushOutbox()
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
  const uid = await currentUserId()
  return (await cache.outbox.toArray()).filter((e) => !e.user_id || e.user_id === uid).length
}

const ORG_KEY = 'inventory.currentOrg'

/** Remove every locally stored trace of the session: cached items, outbox, orgs, saved org. */
export async function wipeLocalData() {
  try { await cache.transaction('rw', cache.items, cache.outbox, cache.meta, async () => {
    await Promise.all([cache.items.clear(), cache.outbox.clear(), cache.meta.clear()])
  }) } catch (e) { console.warn('wipe failed', e) }
  localStorage.removeItem(ORG_KEY)
}

/** If a different user signs in on this device, drop the previous user's cache/outbox first. */
export async function adoptUser(userId: string) {
  const prev = await cache.meta.get('userId')
  if (prev && prev.value !== userId) await wipeLocalData()
  if (!prev || prev.value !== userId) await cache.meta.put({ key: 'userId', value: userId })
}

/** Sign out and clear Dexie/IndexedDB, the outbox and the saved org. Offers to stay if changes are unsynced. */
export async function signOutAndWipe() {
  await flushOutbox().catch(() => undefined)
  const left = await pendingCount()
  if (left > 0 && !window.confirm(`${left} change${left === 1 ? '' : 's'} not yet synced will be lost if you sign out. Sign out anyway?`)) return false
  await supabase.auth.signOut()
  await wipeLocalData()
  return true
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
