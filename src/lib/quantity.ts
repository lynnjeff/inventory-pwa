/** Delta for a typed quantity edit, measured from the quantity the form loaded. */
export function typedQuantityDelta(loaded: number, typed: number): number {
  return typed - loaded
}

export const QTY_REASONS = [
  { id: 'received', label: 'Received' },
  { id: 'short_delivery', label: 'Short delivery (vendor)' },
  { id: 'over_delivery', label: 'Over delivery (vendor)' },
  { id: 'used', label: 'Used/pulled' },
  { id: 'damaged', label: 'Damaged/scrapped' },
  { id: 'count_correction', label: 'Count correction' },
  { id: 'other', label: 'Other' },
] as const

export type QtyReasonId = (typeof QTY_REASONS)[number]['id']

export function reasonLabel(id: string | null | undefined): string {
  return QTY_REASONS.find((r) => r.id === id)?.label ?? (id ? id : 'Quantity change')
}

export type HistoryFilter = 'all' | 'short_over' | 'used' | 'corrections'

export function eventMatchesFilter(reason: string | null | undefined, filter: HistoryFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'short_over') return reason === 'short_delivery' || reason === 'over_delivery'
  if (filter === 'used') return reason === 'used'
  return reason === 'count_correction'
}

export function formatEventWhen(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (day === today) return `Today ${time}`
  if (day === today - 86_400_000) return `Yesterday ${time}`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatActor(email: string | null | undefined): string {
  if (!email) return 'Someone'
  const local = email.split('@')[0] ?? email
  return local.replace(/[._]+/g, ' ')
}

export function quantityBefore(quantityAfter: number | null, delta: number): number | null {
  if (quantityAfter == null) return null
  return quantityAfter - delta
}
