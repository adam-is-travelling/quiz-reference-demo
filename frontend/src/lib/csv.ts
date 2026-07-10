function detectDelimiter(raw: string): string {
  const firstLine = raw.split("\n")[0] ?? ""
  const tabCount = (firstLine.match(/\t/g) ?? []).length
  const commaCount = (firstLine.match(/,/g) ?? []).length
  return tabCount > commaCount ? "\t" : ","
}

function parseDelimited(raw: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (inQuotes) {
      if (char === '"' && raw[i + 1] === '"') {
        cell += '"'
        i++
        continue
      }
      if (char === '"') {
        inQuotes = false
        continue
      }
      cell += char
      continue
    }
    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === delimiter) {
      row.push(cell.trim())
      cell = ""
      continue
    }
    if (char === "\r") continue
    if (char === "\n") {
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ""
      continue
    }
    cell += char
  }
  row.push(cell.trim())
  rows.push(row)

  return rows.filter((r) => r.some((c) => c.length > 0))
}

export function parseCsv(raw: string): string[][] {
  const trimmed = raw.trim()
  return parseDelimited(trimmed, detectDelimiter(trimmed))
}
