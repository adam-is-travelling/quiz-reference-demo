import type { ColumnMapping, ParticipantMode } from "@/components/Upload/types"
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
  participantMode: ParticipantMode,
): RowError[] {
  const errors: RowError[] = []
  // Teams only: a team, and a player, may each appear once in the file.
  const seenTeams = new Map<string, number>()
  const seenPlayers = new Map<string, number>()

  resolutions.forEach((resolution, i) => {
    const row = parsedRows[i + 1]
    if (!row) return

    const displayNumber = i + 1
    const names = namesForRow(row, columnMapping, participantMode)
    const created = resolution.participants
      .map((p) => p.player_create?.display_name)
      .filter((n): n is string => Boolean(n))
    const effective = names.length > 0 ? names : created

    if (participantMode === "teams") {
      const teamCell =
        columnMapping.team_name !== null
          ? (row[columnMapping.team_name] ?? "").trim()
          : ""
      if (!teamCell) {
        errors.push({ row: displayNumber, message: "Team name is missing" })
      } else {
        const key = teamCell.toLowerCase()
        const first = seenTeams.get(key)
        if (first === undefined) {
          seenTeams.set(key, displayNumber)
        } else {
          errors.push({
            row: displayNumber,
            message: `Team "${teamCell}" already appears in row ${first}`,
          })
        }
      }

      const lowered = effective.map((n) => n.toLowerCase())
      if (new Set(lowered).size !== lowered.length) {
        errors.push({
          row: displayNumber,
          message: "The same quizzer appears twice in this row",
        })
      } else {
        // Only look across rows once this row is internally consistent, so a
        // doubled name doesn't produce two errors saying the same thing.
        for (const name of effective) {
          const key = name.toLowerCase()
          const first = seenPlayers.get(key)
          if (first === undefined) {
            seenPlayers.set(key, displayNumber)
          } else {
            errors.push({
              row: displayNumber,
              message: `"${name}" already appears in row ${first}`,
            })
          }
        }
      }
      // An empty squad is deliberate: the lineup is filled in later from
      // the results page. No error here.
    } else if (effective.length === 0) {
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
