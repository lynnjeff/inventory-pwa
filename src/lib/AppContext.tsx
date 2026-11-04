import { liveQuery } from 'dexie'
import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cache } from './db'
import { supabase } from './supabase'
import { enqueue, flushOutbox, listSyncErrors, mutationItemId, onSyncChange, pendingCount, pullOrg, retryFailed, saveItemEdit, startAutoSync } from './sync'
import type { Item, ItemFields, Org, OutboxEntry } from './types'
import { uuid } from './uuid'

interface Ctx {
  session: Session | null
  authLoading: boolean
  orgs: Org[]
  org: Org | null
  setOrgId: (id: string) => void
  refreshOrgs: () => Promise<void>
  createOrg: (name: string) => Promise<Org>
  items: Item[]
  loading: boolean
  online: boolean
  pending: number
  syncErrors: OutboxEntry[]
  unsavedItemIds: string[]
  retrySync: () => Promise<void>
  addItem: (f: ItemFields) => Promise<Item>
  updateItem: (id: string, patch: Partial<ItemFields>) => Promise<void>
  saveItem: (id: string, fields: ItemFields, loadedQuantity: number, reason?: string | null, note?: string | null) => Promise<void>
  adjustQuantity: (id: string, delta: number, reason?: string | null, note?: string | null) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  markOrderReceived: () => Promise<void>
  syncNow: () => Promise<void>
}

const AppCtx = createContext<Ctx | undefined>(undefined)
const ORG_KEY = 'inventory.currentOrg'

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [orgId, setOrgIdState] = useState<string | null>(() => localStorage.getItem(ORG_KEY))
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [syncErrors, setSyncErrors] = useState<OutboxEntry[]>([])
  const orgRef = useRef(orgId)
  orgRef.current = orgId

  useEffect(() => {
    // INITIAL_SESSION restores the PWA localStorage session (and a magic-link
    // URL, via detectSessionInUrl) without a later getSession() call overwriting it.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setAuthLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  const refreshPending = useCallback(() => {
    void pendingCount().then(setPending)
    void listSyncErrors().then(setSyncErrors)
  }, [])
  useEffect(() => onSyncChange(refreshPending), [refreshPending])

  const setOrgId = useCallback((id: string) => { localStorage.setItem(ORG_KEY, id); setOrgIdState(id) }, [])

  const refreshOrgs = useCallback(async () => {
    if (!navigator.onLine) {
      const c = await cache.meta.get('orgs')
      if (c) setOrgs(JSON.parse(c.value))
      return
    }
    await supabase.rpc('accept_invites')
    const { data, error } = await supabase.from('org_members').select('role, organizations(id, name)')
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
    if (error) throw error
    type Row = { role: Org['role']; organizations: { id: string; name: string } | null }
    const list = ((data ?? []) as unknown as Row[]).filter((r) => r.organizations)
      .map((r) => ({ id: r.organizations!.id, name: r.organizations!.name, role: r.role }))
      .sort((a, b) => a.name.localeCompare(b.name))
    setOrgs(list)
    await cache.meta.put({ key: 'orgs', value: JSON.stringify(list) })
  }, [])

  useEffect(() => { if (session) void refreshOrgs().catch(console.error) }, [session, refreshOrgs])

  useEffect(() => {
    if (orgs.length && (!orgId || !orgs.some((o) => o.id === orgId))) setOrgId(orgs[0].id)
  }, [orgs, orgId, setOrgId])

  // Live view of cached items for the current org
  useEffect(() => {
    if (!orgId) { setItems([]); setLoading(false); return }
    setLoading(true)
    const sub = liveQuery(() => cache.items.where('[org_id+name]').between([orgId, ''], [orgId, '\uffff']).toArray())
      .subscribe({ next: (v) => { setItems(v); setLoading(false) }, error: console.error })
    return () => sub.unsubscribe()
  }, [orgId])

  // Pull on org change, realtime updates, auto-sync on reconnect
  useEffect(() => {
    if (!session || !orgId) return
    void flushOutbox().then(() => pullOrg(orgId)).catch(console.warn)
    const ch = supabase.channel(`items:${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `org_id=eq.${orgId}` },
        () => { void pullOrg(orgId).catch(console.warn) })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [session, orgId])

  useEffect(() => (session ? startAutoSync(() => orgRef.current) : undefined), [session])

  const org = useMemo(() => orgs.find((o) => o.id === orgId) ?? null, [orgs, orgId])

  const requireOrg = () => { if (!orgId) throw new Error('No organization selected'); return orgId }

  const value: Ctx = {
    session, authLoading, orgs, org, setOrgId, refreshOrgs,
    createOrg: async (name) => {
      const { data, error } = await supabase.rpc('create_organization', { p_name: name })
      if (error) throw error
      await refreshOrgs()
      const o = data as { id: string; name: string }
      setOrgId(o.id)
      return { id: o.id, name: o.name, role: 'owner' }
    },
    items, loading, online, pending, syncErrors,
    unsavedItemIds: [...new Set(syncErrors.map((entry) => mutationItemId(entry.mutation)).filter((id): id is string => Boolean(id)))],
    retrySync: async () => { await retryFailed() },
    addItem: async (f) => {
      const item: Item = { id: uuid(), org_id: requireOrg(), updated_at: new Date().toISOString(), ...f }
      await enqueue(item.org_id, { kind: 'insert', item })
      return item
    },
    updateItem: async (id, patch) => { await enqueue(requireOrg(), { kind: 'update', id, patch }) },
    saveItem: async (id, fields, loadedQuantity, reason, note) => { await saveItemEdit(requireOrg(), id, fields, loadedQuantity, reason, note) },
    adjustQuantity: async (id, delta, reason, note) => { await enqueue(requireOrg(), { kind: 'adjust', id, delta, reason, note }) },
    deleteItem: async (id) => { await enqueue(requireOrg(), { kind: 'delete', id }) },
    markOrderReceived: async () => { const o = requireOrg(); await enqueue(o, { kind: 'order_received', org_id: o }) },
    syncNow: async () => { await flushOutbox(); if (orgId) await pullOrg(orgId) },
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp must be used within AppProvider')
  return c
}
