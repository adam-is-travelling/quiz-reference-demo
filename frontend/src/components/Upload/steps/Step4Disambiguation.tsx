import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import type { PlayerSearchResult } from "@/client"
import { PlayersService } from "@/client"
import { Button } from "@/components/ui/button"
import { CountrySelect } from "@/components/ui/CountrySelect"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { countryName, resolveCountryCode } from "@/lib/countries"
import type { Resolution, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

interface ParsedRow {
  player_name: string
  country: string
  score: number
  tiebreaker_rank: number
}

const SIMILARITY_THRESHOLD = 0.9

function getAutoResolution(
  parsedRow: ParsedRow,
  candidates: PlayerSearchResult[],
): Resolution {
  if (candidates.length === 0) {
    return {
      player_id: null,
      player_create: {
        display_name: parsedRow.player_name,
        country: resolveCountryCode(parsedRow.country) ?? null,
      },
      autoResolved: true,
    }
  }
  const highConf = candidates.filter(
    (c) => c.similarity >= SIMILARITY_THRESHOLD,
  )
  if (highConf.length === 1) {
    return {
      player_id: highConf[0].player.id,
      player_create: null,
      autoResolved: true,
    }
  }
  return { player_id: null, player_create: null, autoResolved: false }
}

function RowDisambiguator({
  parsedRow,
  resolution,
  onChange,
  index,
  variant = "default",
}: {
  parsedRow: ParsedRow
  resolution: Resolution
  onChange: (r: Resolution) => void
  index: number
  variant?: "default" | "review"
}) {
  const [creating, setCreating] = useState(resolution.player_create !== null)
  const [newName, setNewName] = useState(parsedRow.player_name)
  const [newCountry, setNewCountry] = useState<string | null>(() =>
    resolveCountryCode(parsedRow.country),
  )

  const { data: searchResults } = useQuery({
    queryFn: () =>
      PlayersService.searchPlayersRoute({
        q: parsedRow.player_name,
        country: parsedRow.country,
      }),
    queryKey: ["players", "search", parsedRow.player_name, parsedRow.country],
  })

  const candidates: PlayerSearchResult[] = searchResults?.data ?? []

  const autoApplied = useRef(false)

  useEffect(() => {
    if (autoApplied.current) return
    if (resolution.autoResolved !== undefined) {
      autoApplied.current = true
      return
    }
    if (searchResults === undefined) return
    autoApplied.current = true
    const auto = getAutoResolution(parsedRow, searchResults.data ?? [])
    if (auto.autoResolved && auto.player_create !== null) {
      setCreating(true)
      setNewName(auto.player_create.display_name ?? parsedRow.player_name)
      setNewCountry(auto.player_create.country ?? null)
    } else if (auto.autoResolved && auto.player_id !== null) {
      setCreating(false)
    }
    onChange(auto)
  }, [searchResults, onChange, parsedRow, resolution.autoResolved])

  const selectExisting = (id: string) => {
    setCreating(false)
    onChange({ player_id: id, player_create: null })
  }

  const selectNew = () => {
    setCreating(true)
    onChange({
      player_id: null,
      player_create: { display_name: newName, country: newCountry },
    })
  }

  return (
    <div
      className={`border rounded-lg p-4 flex flex-col gap-3 ${
        variant === "review" ? "border-destructive" : ""
      }`}
    >
      <p className="text-sm font-medium">
        {parsedRow.player_name} · {parsedRow.country} · Score: {parsedRow.score}
      </p>

      <div className="flex flex-col gap-2">
        {candidates.map((c) => (
          <label
            key={c.player.id}
            className="flex items-center gap-3 cursor-pointer"
          >
            <input
              type="radio"
              name={`row-${index}`}
              checked={resolution.player_id === c.player.id}
              onChange={() => selectExisting(c.player.id)}
            />
            <span className="text-sm">
              {c.player.display_name}{" "}
              <span className="text-muted-foreground">
                ({countryName(c.player.country)}
                {c.player.city ? `, ${c.player.city}` : ""}) —{" "}
              </span>
              {!c.player.is_published && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  user has no published results —{" "}
                </span>
              )}
              <span className="text-muted-foreground">
                {Math.round(c.similarity * 100)}% match
              </span>
            </span>
          </label>
        ))}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name={`row-${index}`}
            checked={creating}
            onChange={selectNew}
          />
          <span className="text-sm font-medium">Create new player</span>
        </label>
      </div>

      {creating && (
        <div className="flex gap-3 ml-6">
          <div className="grid gap-1">
            <Label className="text-xs">Name</Label>
            <Input
              className="h-7 text-xs"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                onChange({
                  player_id: null,
                  player_create: {
                    display_name: e.target.value,
                    country: newCountry,
                  },
                })
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Country</Label>
            <CountrySelect
              value={newCountry}
              onChange={(code) => {
                setNewCountry(code)
                onChange({
                  player_id: null,
                  player_create: {
                    display_name: newName,
                    country: code,
                  },
                })
              }}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 py-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function Step4Disambiguation({ state, update }: Props) {
  const parseRows: ParsedRow[] = state.parsedRows.slice(1).map((row) => ({
    player_name: row[state.columnMapping.player_name] ?? "",
    country: row[state.columnMapping.country] ?? "",
    score: parseFloat(row[state.columnMapping.score] ?? "0"),
    tiebreaker_rank: parseInt(
      row[state.columnMapping.tiebreaker_rank] ?? "1",
      10,
    ),
  }))

  const [resolutions, setResolutions] = useState<Resolution[]>(
    state.resolutions.length === parseRows.length
      ? state.resolutions
      : parseRows.map(() => ({ player_id: null, player_create: null })),
  )

  const [showAutoResolved, setShowAutoResolved] = useState(false)

  const needsReviewIndices = parseRows
    .map((_, i) => i)
    .filter((i) => resolutions[i]?.autoResolved !== true)

  const autoResolvedIndices = parseRows
    .map((_, i) => i)
    .filter((i) => resolutions[i]?.autoResolved === true)

  const canProceed = needsReviewIndices.every(
    (i) =>
      (resolutions[i]?.player_id ?? null) !== null ||
      (resolutions[i]?.player_create ?? null) !== null,
  )

  // Auto-open the auto-resolved section once everything has settled and
  // nothing requires manual attention
  useEffect(() => {
    const allSettled = resolutions.every((r) => r.autoResolved !== undefined)
    const anyNeedsReview = resolutions.some((r) => r.autoResolved !== true)
    const hasAutoResolved = resolutions.some((r) => r.autoResolved === true)
    if (allSettled && !anyNeedsReview && hasAutoResolved) {
      setShowAutoResolved(true)
    }
  }, [resolutions])

  const handleChange = (i: number, r: Resolution) =>
    setResolutions((prev) => {
      const next = [...prev]
      // Preserve the autoResolved bucket flag so admin overrides stay in their section
      next[i] = { ...r, autoResolved: prev[i]?.autoResolved }
      return next
    })

  const handleNext = () => {
    update({ resolutions, step: 5 })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Confirm or correct each player match. Select "Create new player" for
        anyone not yet in the system.
      </p>

      {needsReviewIndices.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-destructive">
            Needs Review ({needsReviewIndices.length})
          </p>
          <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto pr-1">
            {needsReviewIndices.map((i) => (
              <RowDisambiguator
                key={i}
                parsedRow={parseRows[i]}
                resolution={
                  resolutions[i] ?? { player_id: null, player_create: null }
                }
                onChange={(r) => handleChange(i, r)}
                index={i}
                variant="review"
              />
            ))}
          </div>
        </div>
      )}

      {autoResolvedIndices.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowAutoResolved((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-left w-fit"
          >
            <span>{showAutoResolved ? "▾" : "▸"}</span>
            Auto-resolved ({autoResolvedIndices.length})
          </button>
          {showAutoResolved && (
            <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto pr-1">
              {autoResolvedIndices.map((i) => (
                <RowDisambiguator
                  key={i}
                  parsedRow={parseRows[i]}
                  resolution={
                    resolutions[i] ?? { player_id: null, player_create: null }
                  }
                  onChange={(r) => handleChange(i, r)}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 3 })}>
          ← Back
        </Button>
        <Button onClick={handleNext} disabled={!canProceed}>
          Next →
        </Button>
      </div>
    </div>
  )
}
