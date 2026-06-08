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
    const candidate = highConf[0]
    const csvCountry = resolveCountryCode(parsedRow.country)
    const countryMismatch =
      csvCountry !== null &&
      candidate.player.country !== null &&
      csvCountry !== candidate.player.country
    if (countryMismatch) {
      // Pre-select the name match so admin can confirm, but flag for review
      return { player_id: candidate.player.id, player_create: null, autoResolved: false }
    }
    return {
      player_id: candidate.player.id,
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
        // No country filter — we want all name matches so getAutoResolution
        // can compare countries client-side and flag mismatches for review
      }),
    queryKey: ["players", "search", parsedRow.player_name],
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
    score: parseFloat(row[state.columnMapping.score] || "0"),
    tiebreaker_rank: parseInt(
      row[state.columnMapping.tiebreaker_rank] || "1",
      10,
    ),
  }))

  const [resolutions, setResolutions] = useState<Resolution[]>(
    state.resolutions.length === parseRows.length
      ? state.resolutions
      : parseRows.map(() => ({ player_id: null, player_create: null })),
  )

  const [showMatched, setShowMatched] = useState(false)
  const [showCreated, setShowCreated] = useState(false)

  const needsReviewIndices = parseRows
    .map((_, i) => i)
    .filter((i) => resolutions[i]?.autoResolved !== true)

  const autoMatchedIndices = parseRows
    .map((_, i) => i)
    .filter((i) => resolutions[i]?.autoResolved === true && resolutions[i]?.player_id !== null)

  const autoCreateIndices = parseRows
    .map((_, i) => i)
    .filter((i) => resolutions[i]?.autoResolved === true && resolutions[i]?.player_create !== null)

  const canProceed = needsReviewIndices.every(
    (i) =>
      (resolutions[i]?.player_id ?? null) !== null ||
      (resolutions[i]?.player_create ?? null) !== null,
  )

  // Auto-open both sections once everything has settled and nothing needs review
  useEffect(() => {
    const allSettled = resolutions.every((r) => r.autoResolved !== undefined)
    const anyStillUnresolved = resolutions.some(
      (r) => r.autoResolved !== true && r.player_id === null && r.player_create === null,
    )
    if (allSettled && !anyStillUnresolved) {
      if (resolutions.some((r) => r.autoResolved === true && r.player_id !== null)) setShowMatched(true)
      if (resolutions.some((r) => r.autoResolved === true && r.player_create !== null)) setShowCreated(true)
    }
  }, [resolutions])

  const handleChange = (i: number, r: Resolution) =>
    setResolutions((prev) => {
      const next = [...prev]
      // Use the incoming autoResolved if provided (auto-selection); otherwise preserve
      // the existing bucket so admin overrides stay in their original section
      next[i] = { ...r, autoResolved: r.autoResolved !== undefined ? r.autoResolved : prev[i]?.autoResolved }
      return next
    })

  const handleNext = () => {
    update({ resolutions, step: 5 })
  }

  const allSettled = resolutions.every((r) => r.autoResolved !== undefined)
  const settledCount = resolutions.filter((r) => r.autoResolved !== undefined).length

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Confirm or correct each player match. Select "Create new player" for
        anyone not yet in the system.
      </p>

      {/* Always render rows so their queries fire; hidden until fully settled */}
      {!allSettled && (
        <>
          <p className="text-sm text-muted-foreground">
            Matching players… ({settledCount} / {parseRows.length})
          </p>
          <div className="hidden">
            {parseRows.map((_, i) => (
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
        </>
      )}

      {allSettled && needsReviewIndices.length > 0 && (
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

      {allSettled && autoMatchedIndices.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowMatched((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-left w-fit"
          >
            <span>{showMatched ? "▾" : "▸"}</span>
            Matched existing players ({autoMatchedIndices.length})
          </button>
          {showMatched && (
            <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto pr-1">
              {autoMatchedIndices.map((i) => (
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

      {allSettled && autoCreateIndices.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowCreated((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-left w-fit"
          >
            <span>{showCreated ? "▾" : "▸"}</span>
            New players to be created ({autoCreateIndices.length})
          </button>
          {showCreated && (
            <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto pr-1">
              {autoCreateIndices.map((i) => (
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
        <Button onClick={handleNext} disabled={!allSettled || !canProceed}>
          Next →
        </Button>
      </div>
    </div>
  )
}
