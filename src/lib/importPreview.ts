import type { Item, ItemFields } from './types'

export type ImportFlag = 'duplicate' | 'duplicate_file' | 'non_numeric' | 'missing_part' | 'missing_name'

export interface ImportDraft {
  line: number
  part_number: string
  brand: string
  name: string
  quantityRaw: string
  target_quantity: number
  location: string | null
  notes: string | null
  barcode: string | null
  flags: ImportFlag[]
  skip: boolean
}

const FLAG_LABEL: Record<ImportFlag, string> = {
  duplicate: 'Duplicate',
  duplicate_file: 'Duplicate in file',
  non_numeric: 'Qty not a number',
  missing_part: 'Missing part #',
  missing_name: 'Missing name',
}

export function importFlagLabel(flag: ImportFlag): string {
  return FLAG_LABEL[flag]
}

function splitLine(line: string): string[] {
  return line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
}

function key(part: string, brand: string) {
  return `${part.trim().toLowerCase()}|${brand.trim().toLowerCase()}`
}

export function parseImportFile(text: string): ImportDraft[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const head = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[\s_#]/g, ''))
  const idx = (...names: string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1
  const part = idx('partnumber', 'part', 'partno')
  const brand = idx('brand')
  const name = idx('name', 'itemname')
  const qty = idx('quantity', 'qty')
  const target = idx('targetquantity', 'target')
  const location = idx('location')
  const notes = idx('notes')
  const barcode = idx('barcode', 'sku')
  if (part < 0 || name < 0) throw new Error('Need part # and name columns.')
  return lines.slice(1).map((line, i) => {
    const c = splitLine(line)
    const targetRaw = target >= 0 ? Number(c[target]) : 0
    return {
      line: i + 2,
      part_number: (c[part] ?? '').trim(),
      brand: brand >= 0 ? (c[brand] ?? '').trim() : '',
      name: (c[name] ?? '').trim(),
      quantityRaw: qty >= 0 ? (c[qty] ?? '').trim() : '',
      target_quantity: Number.isFinite(targetRaw) && targetRaw >= 0 ? Math.floor(targetRaw) : 0,
      location: location >= 0 ? ((c[location] ?? '').trim() || null) : null,
      notes: notes >= 0 ? ((c[notes] ?? '').trim() || null) : null,
      barcode: barcode >= 0 ? ((c[barcode] ?? '').trim() || null) : null,
      flags: [],
      skip: false,
    }
  })
}

export function flagImportRows(rows: ImportDraft[], existing: Pick<Item, 'part_number' | 'brand'>[]): ImportDraft[] {
  const existingKeys = new Set(existing.map((item) => key(item.part_number ?? '', item.brand ?? '')))
  const seen = new Set<string>()
  return rows.map((row) => {
    if (row.skip) return { ...row, flags: [] }
    const flags: ImportFlag[] = []
    if (!row.part_number.trim()) flags.push('missing_part')
    if (!row.name.trim()) flags.push('missing_name')
    if (!/^\d+$/.test(row.quantityRaw)) flags.push('non_numeric')
    if (row.part_number.trim()) {
      const id = key(row.part_number, row.brand)
      if (seen.has(id)) flags.push('duplicate_file')
      else seen.add(id)
      if (existingKeys.has(id)) flags.push('duplicate')
    }
    return { ...row, flags }
  })
}

export function importIsClean(rows: ImportDraft[]): boolean {
  const active = rows.filter((row) => !row.skip)
  return active.length > 0 && active.every((row) => row.flags.length === 0)
}

export function draftsToItems(rows: ImportDraft[]): ItemFields[] {
  return rows.filter((row) => !row.skip && row.flags.length === 0).map((row) => ({
    part_number: row.part_number.trim(),
    brand: row.brand.trim() || null,
    name: row.name.trim(),
    barcode: row.barcode,
    quantity: Number(row.quantityRaw),
    target_quantity: row.target_quantity,
    location: row.location,
    notes: row.notes,
  }))
}
