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
  TEAM_HEADER_NAMES,
} from "@/lib/columnDetection"
import { detectLineupLayout } from "@/lib/detectLineupLayout"
import { detectPairsLayout } from "@/lib/detectPairsLayout"
import { normalizePlayerName } from "@/lib/normalizePlayerName"
import { namesForRow } from "@/lib/splitPairNames"
import { Labels } from "@/test-ids"
import type { ColumnMapping, ParticipantMode, WizardState } from "../types"

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

/**
 * The mapping Step 3 opens with: the wizard's stored mapping, with every
 * field still holding its compiled-in default filled in by auto-detection.
 *
 * It lives outside the component, and is exported, so the detection order —
 * which field claims which column, and in what sequence — can be unit
 * tested without rendering the step.
 */
export function computeInitialMapping(
  state: WizardState,
  numRounds: number,
): ColumnMapping {
  const existing = state.columnMapping
  const rounds =
    existing.rounds.length === numRounds
      ? [...existing.rounds]
      : Array<number | null>(numRounds).fill(null)
  const header = state.parsedRows[0] ?? []
  const claimed = new Set<number>()

  const core = { ...existing }
  for (const field of REQUIRED_FIELDS) {
    // A teams file has no player-name column: namesForRow builds a team's
    // squad from lineup_combined / lineup_columns and never reads
    // player_name. Detecting it here would still *claim* a column, and the
    // headers it matches ("Players", "Player 1") are exactly the ones the
    // lineup detector needs — leaving the squad unmapped or half-mapped.
    // So skip the field outright in teams mode, claiming nothing; the
    // stored value keeps its compiled-in default, unread.
    if (state.participantMode === "teams" && field.key === "player_name") {
      continue
    }
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

  let team_name = existing.team_name
  let lineupLayout = existing.lineupLayout
  let lineup_combined = existing.lineup_combined
  let lineup_columns = existing.lineup_columns
  if (
    state.participantMode === "teams" &&
    existing.team_name === null &&
    existing.lineup_combined === null &&
    existing.lineup_columns.length === 0
  ) {
    team_name = detectColumn(header, TEAM_HEADER_NAMES, claimed)
    if (team_name !== null) claimed.add(team_name)
    const detection = detectLineupLayout(state.parsedRows, header, claimed)
    lineupLayout = detection.layout
    lineup_combined = detection.lineup_combined
    lineup_columns = detection.lineup_columns
    if (lineup_combined !== null) claimed.add(lineup_combined)
    for (const idx of lineup_columns) claimed.add(idx)
  }

  return {
    ...core,
    country,
    position,
    rounds,
    pairsLayout,
    player_name_2,
    team_name,
    lineupLayout,
    lineup_combined,
    lineup_columns,
  }
}

/**
 * Title-case the name columns of the rows Step 3 hands on to Step 4, so a
 * file typed entirely in caps or entirely in lower case does not create
 * players spelled that way.
 *
 * Teams are exempt. A teams file has no player-name column, so `player_name`
 * always holds its compiled-in default — column 0, which in a teams file is
 * the team's own name — and normalizing it would rewrite "USA" as "Usa" and
 * "ENGLAND A" as "England A", which is then the name Step 4 submits. The
 * squad names live in the lineup columns and are left exactly as typed.
 */
export function normalizeNameColumns(
  rows: string[][],
  mapping: ColumnMapping,
  participantMode: ParticipantMode,
): string[][] {
  if (participantMode === "teams") return rows

  const nameCol = mapping.player_name
  const nameCol2 = mapping.player_name_2
  const normalizeSecondColumn =
    participantMode === "pairs" &&
    mapping.pairsLayout === "two-columns" &&
    nameCol2 !== null

  return rows.map((row, i) => {
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
}

export function Step3ColumnMapping({ state, update }: Props) {
  const numRounds = state.selectedFormat?.rounds?.length ?? 0

  const [mapping, setMapping] = useState<ColumnMapping>(() =>
    computeInitialMapping(state, numRounds),
  )

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
    const normalizedRows = normalizeNameColumns(
      state.parsedRows,
      mapping,
      state.participantMode,
    )
    update({ columnMapping: mapping, parsedRows: normalizedRows, step: 4 })
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="grid gap-4">
        {REQUIRED_FIELDS.filter(
          // Teams read their squads from the Squad controls below and never
          // read player_name, so showing it here would be a required-looking
          // field pointing at an arbitrary column.
          ({ key }) =>
            !(state.participantMode === "teams" && key === "player_name"),
        ).map(({ key, label, testId }) => (
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
          {state.participantMode === "individual"
            ? "Country column *"
            : "Country column (optional)"}
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
            {state.participantMode !== "individual" && (
              <SelectItem value="__none__">Not mapped</SelectItem>
            )}
            {header.map((col, i) => (
              <SelectItem key={i} value={String(i)}>
                {col || `Column ${i + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {state.participantMode !== "individual" && (
          <p className="text-xs text-muted-foreground">
            Optional here — leave it unmapped and each quizzer's own country is
            used.
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

      {state.participantMode === "teams" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Team column</Label>
            <Select
              value={
                mapping.team_name !== null
                  ? String(mapping.team_name)
                  : "__none__"
              }
              onValueChange={(v) =>
                setMapping((m) => ({
                  ...m,
                  team_name: v === "__none__" ? null : Number(v),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Not mapped" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not mapped</SelectItem>
                {header.map((h, i) => (
                  <SelectItem key={`team-${i}`} value={String(i)}>
                    {h || `Column ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Squad layout</Label>
            <div className="flex gap-2">
              {(
                [
                  ["combined", "One column, names separated"],
                  ["numbered-columns", "One column per member"],
                ] as const
              ).map(([layout, label]) => (
                <Button
                  key={layout}
                  type="button"
                  size="sm"
                  data-testid={
                    layout === "combined"
                      ? Labels.lineupLayoutCombined
                      : Labels.lineupLayoutNumbered
                  }
                  variant={
                    mapping.lineupLayout === layout ? "default" : "outline"
                  }
                  onClick={() =>
                    setMapping((m) => ({ ...m, lineupLayout: layout }))
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {mapping.lineupLayout === "combined" ? (
            <div className="space-y-2">
              <Label>Squad column</Label>
              <Select
                value={
                  mapping.lineup_combined !== null
                    ? String(mapping.lineup_combined)
                    : "__none__"
                }
                onValueChange={(v) =>
                  setMapping((m) => ({
                    ...m,
                    lineup_combined: v === "__none__" ? null : Number(v),
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not mapped" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not mapped</SelectItem>
                  {header.map((h, i) => (
                    <SelectItem key={`lineup-${i}`} value={String(i)}>
                      {h || `Column ${i + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Leave unmapped to record the teams without their squads — you
                can add players from the results page afterwards.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Squad columns</Label>
              <div className="flex flex-wrap gap-2">
                {header.map((h, i) => (
                  <Button
                    key={`lineup-col-${i}`}
                    type="button"
                    size="sm"
                    variant={
                      mapping.lineup_columns.includes(i) ? "default" : "outline"
                    }
                    onClick={() =>
                      setMapping((m) => ({
                        ...m,
                        lineup_columns: m.lineup_columns.includes(i)
                          ? m.lineup_columns.filter((c) => c !== i)
                          : [...m.lineup_columns, i].sort((a, b) => a - b),
                      }))
                    }
                  >
                    {h || `Column ${i + 1}`}
                  </Button>
                ))}
              </div>
            </div>
          )}
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
                    : state.participantMode === "teams"
                      ? ["Pos", "Team", "Player", "Lineup", "Country", "Score"]
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
                      {state.participantMode === "teams" && (
                        <td className="px-2 py-1">
                          {mapping.team_name !== null
                            ? (row[mapping.team_name] ?? "—")
                            : "—"}
                        </td>
                      )}
                      <td className="px-2 py-1">{names[0] ?? "—"}</td>
                      {state.participantMode === "pairs" && (
                        <td className="px-2 py-1">{names[1] ?? "—"}</td>
                      )}
                      {state.participantMode === "teams" && (
                        <td className="px-2 py-1 text-muted-foreground">
                          {names.length > 0 ? names.join(", ") : "—"}
                        </td>
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
