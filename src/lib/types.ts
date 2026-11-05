export type Role = 'owner' | 'admin' | 'member'

export interface Org { id: string; name: string; role: Role }

export interface Item {
  id: string
  org_id: string
  barcode: string | null
  part_number?: string | null
  brand?: string | null
  name: string
  quantity: number
  target_quantity: number
  location: string | null
  notes: string | null
  updated_at: string
}

export type ItemFields = Pick<Item, 'barcode' | 'part_number' | 'brand' | 'name' | 'quantity' | 'target_quantity' | 'location' | 'notes'>

export type Mutation =
  | { kind: 'insert'; item: Item }
  | { kind: 'update'; id: string; patch: Partial<ItemFields> }
  | { kind: 'adjust'; id: string; delta: number; reason?: string | null; note?: string | null }
  | { kind: 'delete'; id: string }
  | { kind: 'order_received'; org_id: string }

export interface OutboxEntry { seq?: number; org_id: string; createdAt: number; mutation: Mutation; error?: string }
