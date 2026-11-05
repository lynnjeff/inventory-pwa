import { supabase } from './supabase'

export interface StockEvent {
  id: number
  created_at: string
  delta: number
  quantity_after: number | null
  kind: string
  reason: string | null
  note: string | null
  user_id: string | null
  email: string | null
}

export async function listItemHistory(itemId: string): Promise<StockEvent[]> {
  const { data, error } = await supabase.rpc('item_stock_history', { p_item_id: itemId })
  if (error) throw error
  return (data ?? []) as StockEvent[]
}