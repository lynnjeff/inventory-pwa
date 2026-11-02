import * as XLSX from 'xlsx'
import type { LegacyItem } from './legacy'
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

const LEGACY_HEADER = ['id', 'name', 'barcode', 'quantity', 'targetQuantity', 'location', 'notes', 'lastUpdated'] as const

function backupStamp() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Full copy of the old app's items: an XLSX workbook plus a JSON file. */
export function downloadLegacyBackup(rows: LegacyItem[]) {
  const sheetRows = rows.map((row) => ({
    id: row.id ?? '',
    name: row.name ?? '',
    barcode: row.barcode ?? '',
    quantity: row.quantity ?? '',
    targetQuantity: row.targetQuantity ?? '',
    location: row.location ?? '',
    notes: row.notes ?? '',
    lastUpdated: row.lastUpdated ?? '',
  }))
  const ws = XLSX.utils.json_to_sheet(sheetRows, { header: [...LEGACY_HEADER] })
  ws['!cols'] = LEGACY_HEADER.map((header) => ({
    wch: sheetRows.reduce((width, row) => Math.max(width, String(row[header]).length), header.length) + 2,
  }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Old app')
  const stamp = backupStamp()
  XLSX.writeFile(wb, `inventory-legacy-backup-${stamp}.xlsx`)

  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `inventory-legacy-backup-${stamp}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
