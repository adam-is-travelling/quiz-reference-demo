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
import {
  COUNTRY_HEADER_NAMES,
  detectColumn,
  detectExactColumn,
  PLAYER_NAME_HEADER_NAMES,
  POSITION_HEADER_NAMES,
  resolveCountryColumn,
  SCORE_HEADER_NAMES,
} from "@/lib/columnDetection"
import { detectPairsLayout } from "@/lib/detectPairsLayout"
import { normalizePlayerName } from "@/lib/normalizePlayerName"
import { namesForRow } from "@/lib/splitPairNames"
import { Labels } from "@/test-ids"
import type { ColumnMapping, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

type CoreMappingKey = "player_name" | "score"

const DEFAULT_INDEX: Record<CoreMappingKey | "country", number> = {
  player_name: 0,
  country: 1,
  score: 2,
}

const REQUIRED_FIELDS: Array<{
  key: CoreMappingKey
  label: string
  testId: string
  candidates: string[]
}> = [
  {
    key: "player_name",
    label: "Player name",
    testId: Labels.columnMappingPlayerName,
    candidates: PLAYER_NAME_HEADER_NAMES,
  },
  {
    key: "score",
    label: "Score",
    testId: Labels.columnMappingScore,
    candidates: SCORE_HEADER_NAMES,
  },
]

export function Step3ColumnMapping({ state, update }: Props) {
  const numRounds = state.selectedFormat?.rounds?.length ?? 0

  const [mapping, setMapping] = useState<ColumnMapping>(() => {
    const existing = state.columnMapping
    const rounds =
      existing.rounds.length === numRounds
        ? [...existing.rounds]
        : Array<number | null>(numRounds).fill(null)
    const header = state.parsedRows[0] ?? []
    const claimed = new Set<number>()

    const core = { ...existing }
    for (const field of REQUIRED_FIELDS) {
      // Only auto-detect while the field still holds its compiled-in
      // default. Once it's been changed (by the user or a prior
      // detection pass), leave it alone so remounting the step doesn't
      // silently override a manual choice.
      if (existing[field.key] !== DEFAULT_INDEX[field.key]) {
        claimed.add(existing[field.key])
        continue
      }
      const detected = detectColumn(header, field.candidates, claimed)
      if (detected !== null) {
        claimed.add(detected)
        core[field.key] = detected
      }
    }

    // Country is optional for pairs, so it lives outside REQUIRED_FIELDS.
    // Same "only auto-detect while still at the compiled-in default" rule;
    // resolveCountryColumn keeps the mode-dependent failure fallback
    // (individual never goes null, pairs may) out of this component so it
    // can be unit tested directly.
    const countryDetected =
      existing.country === DEFAULT_INDEX.country
        ? detectColumn(header, COUNTRY_HEADER_NAMES, claimed)
        : null
    const country = resolveCountryColumn(
      existing.country,
      countryDetected,
      state.participantMode,
      DEFAULT_INDEX.country,
    )
    if (country !== null) claimed.add(country)

    let pairsLayout = existing.pairsLayout
    let player_name_2 = existing.player_name_2
    if (
      state.participantMode === "pairs" &&
      existing.player_name_2 === null &&
      existing.pairsLayout === "combined"
    ) {
      const detection = detectPairsLayout(
        state.parsedRows,
        core.player_name,
        header,
        claimed,
      )
      pairsLayout = detection.layout
      player_name_2 = detection.player_name_2
      if (player_name_2 !== null) claimed.add(player_name_2)
    }

    const position =
      existing.position !== null
        ? existing.position
        : detectExactColumn(header, POSITION_HEADER_NAMES, claimed)
    if (position !== null) claimed.add(position)

    const formatRounds = state.selectedFormat?.rounds ?? []
    for (let i = 0; i < rounds.length; i++) {
      if (rounds[i] !== null) {
        claimed.add(rounds[i] as number)
        continue
      }
      const roundName = formatRounds[i]
      if (!roundName) continue
      const detected = detectExactColumn(header, roundName, claimed)
      if (detected !== null) {
        claimed.add(detected)
        rounds[i] = detected
      }
    }

    return { ...core, country, position, rounds, pairsLayout, player_name_2 }
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
    const nameCol2 = mapping.player_name_2
    const normalizeSecondColumn =
      state.participantMode === "pairs" &&
      mapping.pairsLayout === "two-columns" &&
      nameCol2 !== null
    const normalizedRows = state.parsedRows.map((row, i) => {
      if (i === 0) return row
      const updated = [...row]
      updated[nameCol] = normalizePlayerName(updated[nameCol] ?? "")
      if (normalizeSecondColumn) {
        updated[nameCol2 as number] = normalizePlayerName(
          updated[nameCol2 as number] ?? "",
        )
      }
      return updated
    })
    update({ columnMapping: mapping, parsedRows: normalizedRows, step: 4 })
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="grid gap-4">
        {REQUIRED_FIELDS.map(({ key, label, testId }) => (
          <div key={key} className="grid gap-1.5">
            <Label>{label} column *</Label>
            <Select
              value={String(mapping[key])}
              onValueChange={(v) =>
                setMapping((m) => ({ ...m, [key]: Number(v) }))
              }
            >
              <SelectTrigger data-testid={testId}>
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
        <Label>
          {state.participantMode === "pairs"
            ? "Country column (optional)"
            : "Country column *"}
        </Label>
        <Select
          value={
            mapping.country !== null ? String(mapping.country) : "__none__"
          }
          onValueChange={(v) =>
            setMapping((m) => ({
              ...m,
              country: v === "__none__" ? null : Number(v),
            }))
          }
        >
          <SelectTrigger data-testid={Labels.columnMappingCountry}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {state.participantMode === "pairs" && (
              <SelectItem value="__none__">Not mapped</SelectItem>
            )}
            {header.map((col, i) => (
              <SelectItem key={i} value={String(i)}>
                {col || `Column ${i + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {state.participantMode === "pairs" && (
          <p className="text-xs text-muted-foreground">
            Optional for pairs — leave unmapped and each quizzer's own country
            is used.
          </p>
        )}
      </div>

      {state.participantMode === "pairs" && (
        <div className="grid gap-1.5">
          <Label>Pairs layout</Label>
          <div className="flex w-fit rounded-md border overflow-hidden">
            {(
              [
                [
                  "combined",
                  "One column, split on & / and",
                  Labels.pairsLayoutCombined,
                ],
                [
                  "two-columns",
                  "Two separate columns",
                  Labels.pairsLayoutTwoColumns,
                ],
              ] as const
            ).map(([layout, label, testId]) => (
              <button
                key={layout}
                type="button"
                data-testid={testId}
                onClick={() =>
                  setMapping((m) => ({ ...m, pairsLayout: layout }))
                }
                className={`px-4 py-1.5 text-sm ${
                  mapping.pairsLayout === layout
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {state.participantMode === "pairs" &&
        mapping.pairsLayout === "two-columns" && (
          <div className="grid gap-1.5">
            <Label>Player 2 column *</Label>
            <Select
              value={
                mapping.player_name_2 !== null
                  ? String(mapping.player_name_2)
                  : "__none__"
              }
              onValueChange={(v) =>
                setMapping((m) => ({
                  ...m,
                  player_name_2: v === "__none__" ? null : Number(v),
                }))
              }
            >
              <SelectTrigger data-testid={Labels.columnMappingPlayerName2}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not mapped</SelectItem>
                {header.map((col, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {col || `Column ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

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
                  {(state.participantMode === "pairs"
                    ? ["Pos", "Player 1", "Player 2", "Country", "Score"]
                    : ["Pos", "Player", "Country", "Score"]
                  ).map((h) => (
                    <th key={h} className="px-2 py-1 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => {
                  const names = namesForRow(row, mapping, state.participantMode)
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1">
                        {mapping.position !== null
                          ? (row[mapping.position] ?? "—")
                          : "—"}
                      </td>
                      <td className="px-2 py-1">{names[0] ?? "—"}</td>
                      {state.participantMode === "pairs" && (
                        <td className="px-2 py-1">{names[1] ?? "—"}</td>
                      )}
                      <td className="px-2 py-1">
                        {mapping.country !== null
                          ? (row[mapping.country] ?? "")
                          : ""}
                      </td>
                      <td className="px-2 py-1">{row[mapping.score]}</td>
                    </tr>
                  )
                })}
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
