import type { ColumnMapping } from "@/components/Upload/types"
import type { RowResolution } from "@/lib/matchPlayers"
import { namesForRow } from "@/lib/splitPairNames"

export interface RowError {
  row: number
  message: string
}

export function validateUploadRows(
  parsedRows: string[][],
  columnMapping: ColumnMapping,
  resolutions: RowResolution[],
  participantMode: "individual" | "pairs",
): RowError[] {
  const errors: RowError[] = []

  resolutions.forEach((resolution, i) => {
    const row = parsedRows[i + 1]
    if (!row) return

    const displayNumber = i + 1
    const names = namesForRow(row, columnMapping, participantMode)
    const created = resolution.participants
      .map((p) => p.player_create?.display_name)
      .filter((n): n is string => Boolean(n))
    const effective = names.length > 0 ? names : created

    if (effective.length === 0) {
      errors.push({ row: displayNumber, message: "Player name is missing" })
    } else if (participantMode === "pairs" && effective.length > 2) {
      errors.push({
        row: displayNumber,
        message: `Expected at most two quizzers, found ${effective.length} ("${row[columnMapping.player_name]}")`,
      })
    } else if (
      participantMode === "pairs" &&
      effective.length === 2 &&
      effective[0].toLowerCase() === effective[1].toLowerCase()
    ) {
      errors.push({
        row: displayNumber,
        message: "The same quizzer appears twice in this row",
      })
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
