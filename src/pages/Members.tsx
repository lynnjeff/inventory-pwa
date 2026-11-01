import { useCallback, useEffect, useState } from 'react'
import { Header } from '../components/Header'
import { btn, card, input } from '../components/ui'
import { useApp } from '../lib/AppContext'
import { supabase } from '../lib/supabase'
import type { Role } from '../lib/types'

interface Member { user_id: string; email: string; role: Role }
interface Invite { id: string; email: string; role: Role; created_at: string }

export default function Members() {
  const { org, session, online } = useApp()
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [err, setErr] = useState<string | null>(null)
  const isAdmin = org?.role === 'owner' || org?.role === 'admin'
  const isOwner = org?.role === 'owner'

  const load = useCallback(async () => {
    if (!org || !online) return
    const [m, i] = await Promise.all([
      supabase.rpc('org_member_list', { p_org_id: org.id }),
      supabase.from('org_invites').select('id, email, role, created_at').eq('org_id', org.id).is('accepted_at', null).order('created_at'),
    ])
    if (m.error) setErr(m.error.message); else setMembers((m.data ?? []) as Member[])
    if (!i.error) setInvites((i.data ?? []) as Invite[])
  }, [org, online])
  useEffect(() => { void load() }, [load])

  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (!org) return
    const { error } = await supabase.from('org_invites').insert({ org_id: org.id, email: email.trim().toLowerCase(), role })
    if (error) setErr(error.message); else { setEmail(''); void load() }
  }
  const setMemberRole = async (user_id: string, r: Role) => {
    const { error } = await supabase.from('org_members').update({ role: r }).eq('org_id', org!.id).eq('user_id', user_id)
    if (error) setErr(error.message); else void load()
  }
  const removeMember = async (user_id: string) => {
    if (!window.confirm('Remove this member?')) return
    const { error } = await supabase.from('org_members').delete().eq('org_id', org!.id).eq('user_id', user_id)
    if (error) setErr(error.message); else void load()
  }
  const revoke = async (id: string) => {
    const { error } = await supabase.from('org_invites').delete().eq('id', id)
    if (error) setErr(error.message); else void load()
  }

  return (
    <div className="min-h-screen">
      <Header title="Members" back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-24">
        {!online && <p className="text-amber-300">Members can only be managed while online.</p>}
        {err && <p className="text-sm text-red-400">{err}</p>}
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.user_id} className={`${card} flex items-center gap-2`}>
              <span className="flex-1 truncate">{m.email}{m.user_id === session?.user.id ? ' (you)' : ''}</span>
              {isOwner && m.user_id !== session?.user.id ? (
                <select value={m.role} onChange={(e) => void setMemberRole(m.user_id, e.target.value as Role)} className="rounded bg-slate-800 px-2 py-1 text-sm">
                  <option value="owner">owner</option><option value="admin">admin</option><option value="member">member</option>
                </select>
              ) : <span className="text-sm text-slate-400">{m.role}</span>}
              {isAdmin && m.user_id !== session?.user.id && m.role !== 'owner' && (
                <button className="text-sm text-red-300" onClick={() => void removeMember(m.user_id)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <>
            <form onSubmit={invite} className={`${card} space-y-2`}>
              <p className="font-medium">Invite by email</p>
              <p className="text-xs text-slate-400">They join automatically the first time they sign in with this email.</p>
              <div className="flex gap-2">
                <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
                <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg bg-slate-800 px-2">
                  <option value="member">member</option><option value="admin">admin</option>
                </select>
              </div>
              <button className={`${btn} w-full`}>Send invite</button>
            </form>
            {invites.length > 0 && (
              <div className={card}>
                <p className="mb-2 font-medium">Pending invites</p>
                {invites.map((i) => (
                  <div key={i.id} className="flex items-center justify-between border-t border-slate-800 py-2 text-sm">
                    <span>{i.email} · {i.role}</span>
                    <button className="text-red-300" onClick={() => void revoke(i.id)}>Revoke</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
