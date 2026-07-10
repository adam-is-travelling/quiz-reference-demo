import type { ColumnMapping, Resolution } from "@/components/Upload/types"

export interface RowError {
  row: number
  message: string
}

export function validateUploadRows(
  parsedRows: string[][],
  columnMapping: ColumnMapping,
  resolutions: Resolution[],
): RowError[] {
  const errors: RowError[] = []

  resolutions.forEach((resolution, i) => {
    const row = parsedRows[i + 1]
    if (!row) return

    const displayNumber = i + 1
    const name =
      resolution.player_create?.display_name ?? row[columnMapping.player_name]
    if (!name?.trim()) {
      errors.push({ row: displayNumber, message: "Player name is missing" })
    }

    const rawScore = row[columnMapping.score]
    if (!rawScore?.trim()) {
      errors.push({ row: displayNumber, message: "Score is missing" })
    } else if (Number.isNaN(parseFloat(rawScore))) {
      errors.push({
        row: displayNumber,
        message: `Score "${rawScore}" is not a number`,
      })
    }

    columnMapping.rounds.forEach((colIdx, roundIdx) => {
      if (colIdx === null) return
      const raw = row[colIdx]
      if (raw?.trim() && Number.isNaN(parseFloat(raw))) {
        errors.push({
          row: displayNumber,
          message: `Round ${roundIdx + 1} score "${raw}" is not a number`,
        })
      }
    })
  })

  return errors
}
