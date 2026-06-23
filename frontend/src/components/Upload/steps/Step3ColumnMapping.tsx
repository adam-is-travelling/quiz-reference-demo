import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { normalizePlayerName } from "@/lib/normalizePlayerName"
import { Labels } from "@/test-ids"
import type { ColumnMapping, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

type CoreMappingKey = "player_name" | "country" | "score"

const REQUIRED_FIELDS: Array<{ key: CoreMappingKey; label: string }> = [
  { key: "player_name", label: "Player name" },
  { key: "country", label: "Country" },
  { key: "score", label: "Score" },
]

const POSITION_HEADER_NAMES = [
  "position",
  "pos",
  "rank",
  "place",
  "#",
  "no",
  "no.",
]

function detectPositionColumn(header: string[]): number | null {
  const idx = header.findIndex((col) =>
    POSITION_HEADER_NAMES.includes(col.trim().toLowerCase()),
  )
  return idx === -1 ? null : idx
}

export function Step3ColumnMapping({ state, update }: Props) {
  const numRounds = state.selectedFormat?.rounds?.length ?? 0

  const [mapping, setMapping] = useState<ColumnMapping>(() => {
    const existing = state.columnMapping
    const rounds =
      existing.rounds.length === numRounds
        ? existing.rounds
        : Array<number | null>(numRounds).fill(null)
    const header = state.parsedRows[0] ?? []
    const position =
      existing.position !== null
        ? existing.position
        : detectPositionColumn(header)
    return { ...existing, rounds, position }
  })

  // Re-initialize rounds array if format changes
  useEffect(() => {
    setMapping((m) => {
      if (m.rounds.length === numRounds) return m
      return { ...m, rounds: Array<number | null>(numRounds).fill(null) }
    })
  }, [numRounds])

  const header = state.parsedRows[0] ?? []
  const preview = state.parsedRows.slice(1, 4)

  const handleNext = () => {
    const nameCol = mapping.player_name
    const normalizedRows = state.parsedRows.map((row, i) => {
      if (i === 0) return row
      const updated = [...row]
      updated[nameCol] = normalizePlayerName(updated[nameCol] ?? "")
      return updated
    })
    update({ columnMapping: mapping, parsedRows: normalizedRows, step: 4 })
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="grid gap-4">
        {REQUIRED_FIELDS.map(({ key, label }) => (
          <div key={key} className="grid gap-1.5">
            <Label>{label} column *</Label>
            <Select
              value={String(mapping[key])}
              onValueChange={(v) =>
                setMapping((m) => ({ ...m, [key]: Number(v) }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {header.map((col, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {col || `Column ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="grid gap-1.5">
        <Label>Position column (optional)</Label>
        <Select
          value={
            mapping.position !== null ? String(mapping.position) : "__none__"
          }
          onValueChange={(v) =>
            setMapping((m) => ({
              ...m,
              position: v === "__none__" ? null : Number(v),
            }))
          }
        >
          <SelectTrigger data-testid={Labels.columnMappingPosition}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not mapped (use row order)</SelectItem>
            {header.map((col, i) => (
              <SelectItem key={i} value={String(i)}>
                {col || `Column ${i + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {numRounds > 0 && (
        <div className="grid gap-4">
          <p className="text-sm font-medium">Round column mapping (optional)</p>
          {state.selectedFormat!.rounds!.map((roundName, i) => (
            <div key={i} className="grid gap-1.5">
              <Label>
                Round {i + 1}
                {roundName ? ` — ${roundName}` : ""}
              </Label>
              <Select
                value={
                  mapping.rounds[i] !== null && mapping.rounds[i] !== undefined
                    ? String(mapping.rounds[i])
                    : "__none__"
                }
                onValueChange={(v) =>
                  setMapping((m) => {
                    const rounds = [...m.rounds]
                    const colIndex = v === "__none__" ? null : Number(v)
                    rounds[i] = colIndex
                    if (
                      i === 0 &&
                      colIndex !== null &&
                      m.rounds.every((r) => r === null)
                    ) {
                      for (let j = 1; j < rounds.length; j++) {
                        const auto = colIndex + j
                        rounds[j] = auto < header.length ? auto : null
                      }
                    }
                    return { ...m, rounds }
                  })
                }
              >
                <SelectTrigger data-testid={`round-column-${i}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not mapped</SelectItem>
                  {header.map((col, ci) => (
                    <SelectItem key={ci} value={String(ci)}>
                      {col || `Column ${ci + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}

      {preview.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Preview (first 3 rows)</p>
          <div className="overflow-x-auto rounded border text-xs font-mono">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  {["Pos", "Player", "Country", "Score"].map((h) => (
                    <th key={h} className="px-2 py-1 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1">
                      {mapping.position !== null
                        ? (row[mapping.position] ?? "—")
                        : "—"}
                    </td>
                    <td className="px-2 py-1">{row[mapping.player_name]}</td>
                    <td className="px-2 py-1">{row[mapping.country]}</td>
                    <td className="px-2 py-1">{row[mapping.score]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 2 })}>
          ← Back
        </Button>
        <Button onClick={handleNext}>Next →</Button>
      </div>
    </div>
  )
}
