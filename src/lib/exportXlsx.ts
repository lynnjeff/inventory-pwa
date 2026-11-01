import * as XLSX from 'xlsx'
import type { Item } from './types'

const HEADER = ['Item Name', 'SKU', 'Quantity On Hand', 'Target Quantity', 'Order Quantity'] as const

export function exportOrderList(items: Item[], orgName = 'inventory') {
  const rows = items
    .map((m) => ({ m, order: Math.max(m.target_quantity - m.quantity, 0) }))
    .filter((r) => r.order > 0)
    .map(({ m, order }) => ({
      'Item Name': m.name, SKU: m.barcode ?? '', 'Quantity On Hand': m.quantity,
      'Target Quantity': m.target_quantity, 'Order Quantity': order,
    }))
  if (!rows.length) return false
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...HEADER] })
  ws['!cols'] = HEADER.map((h) => ({ wch: rows.reduce((w, r) => Math.max(w, String(r[h]).length), h.length) + 2 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Order List')
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'inventory'
  XLSX.writeFile(wb, `${slug}-order-list-${ymd}.xlsx`)
  return true
}
