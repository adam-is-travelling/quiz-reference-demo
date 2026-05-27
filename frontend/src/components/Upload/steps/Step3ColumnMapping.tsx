import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ColumnMapping, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

const REQUIRED_FIELDS: Array<{ key: keyof ColumnMapping; label: string }> = [
  { key: "player_name", label: "Player name" },
  { key: "country", label: "Country" },
  { key: "score", label: "Score" },
  { key: "tiebreaker_rank", label: "Tiebreaker rank" },
]

export function Step3ColumnMapping({ state, update }: Props) {
  const [mapping, setMapping] = useState<ColumnMapping>(state.columnMapping)
  const header = state.parsedRows[0] ?? []
  const preview = state.parsedRows.slice(1, 4)

  const handleNext = () => {
    update({ columnMapping: mapping, step: 4 })
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

      {preview.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Preview (first 3 rows)</p>
          <div className="overflow-x-auto rounded border text-xs font-mono">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  {["Player", "Country", "Score", "Tiebreaker"].map((h) => (
                    <th key={h} className="px-2 py-1 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1">{row[mapping.player_name]}</td>
                    <td className="px-2 py-1">{row[mapping.country]}</td>
                    <td className="px-2 py-1">{row[mapping.score]}</td>
                    <td className="px-2 py-1">
                      {row[mapping.tiebreaker_rank]}
                    </td>
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
