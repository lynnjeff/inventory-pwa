import type { ItemFields } from './types'

function splitLine(line: string): string[] {
  return line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
}

const num = (v: string | undefined) => {
  const n = Number((v ?? '').trim())
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}
const opt = (v: string | undefined) => (v ?? '').trim() || null

/** Columns: barcode, name (required), quantity, targetQuantity|target_quantity, location, notes. */
export function parseInventoryCsv(text: string): ItemFields[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const head = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[\s_]/g, ''))
  const idx = (k: string) => head.indexOf(k)
  const b = idx('barcode'), n = idx('name'), q = idx('quantity'), t = idx('targetquantity'), l = idx('location'), no = idx('notes')
  if (b === -1 || n === -1) throw new Error('Missing required columns: barcode and name.')
  const out: ItemFields[] = []
  for (const line of lines.slice(1)) {
    const c = splitLine(line)
    const barcode = opt(c[b]), name = (c[n] ?? '').trim()
    if (!name) continue
    out.push({
      barcode, name,
      quantity: q >= 0 ? num(c[q]) : 0,
      target_quantity: t >= 0 ? num(c[t]) : 0,
      location: l >= 0 ? opt(c[l]) : null,
      notes: no >= 0 ? opt(c[no]) : null,
    })
  }
  return out
}
