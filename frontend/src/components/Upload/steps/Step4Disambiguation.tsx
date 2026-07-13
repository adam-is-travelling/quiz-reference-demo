import { useQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useMemo, useRef, useState } from "react"
import type { PlayerSearchResult } from "@/client"
import { PlayersService } from "@/client"
import { Button } from "@/components/ui/button"
import { CountrySelect } from "@/components/ui/CountrySelect"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { countryName, resolveCountryCode } from "@/lib/countries"
import {
  buildResolutions,
  chunkUniqueNames,
  type ParsedRow,
} from "@/lib/matchPlayers"
import type { Resolution, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

const BATCH_SIZE = 500

function RowDisambiguator({
  parsedRow,
  candidates,
  resolution,
  onChange,
  index,
  variant = "default",
}: {
  parsedRow: ParsedRow
  candidates: PlayerSearchResult[]
  resolution: Resolution
  onChange: (r: Resolution) => void
  index: number
  variant?: "default" | "review"
}) {
  const [creating, setCreating] = useState(resolution.player_create !== null)
  const [newName, setNewName] = useState(
    resolution.player_create?.display_name ?? parsedRow.player_name,
  )
  const [newCountry, setNewCountry] = useState<string | null>(
    () =>
      resolution.player_create?.countries?.[0] ??
      resolveCountryCode(parsedRow.country),
  )

  const selectExisting = (id: string) => {
    setCreating(false)
    onChange({ player_id: id, player_create: null })
  }

  const selectNew = () => {
    setCreating(true)
    onChange({
      player_id: null,
      player_create: {
        display_name: newName,
        countries: newCountry ? [newCountry] : undefined,
      },
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
                ({countryName(c.player.countries?.[0])}
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
                    countries: newCountry ? [newCountry] : undefined,
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
                    countries: code ? [code] : undefined,
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

function VirtualRowList({
  indices,
  parseRows,
  candidatesByName,
  resolutions,
  onRowChange,
  variant,
}: {
  indices: number[]
  parseRows: ParsedRow[]
  candidatesByName: Record<string, PlayerSearchResult[]>
  resolutions: Resolution[]
  onRowChange: (i: number, r: Resolution) => void
  variant?: "default" | "review"
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: indices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 130,
    overscan: 8,
  })

  return (
    <div ref={parentRef} className="max-h-[50vh] overflow-y-auto pr-1">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const i = indices[item.index]
          return (
            <div
              key={i}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-3"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <RowDisambiguator
                parsedRow={parseRows[i]}
                candidates={candidatesByName[parseRows[i].player_name] ?? []}
                resolution={
                  resolutions[i] ?? { player_id: null, player_create: null }
                }
                onChange={(r) => onRowChange(i, r)}
                index={i}
                variant={variant}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Step4Disambiguation({ state, update }: Props) {
  const parseRows: ParsedRow[] = useMemo(
    () =>
      state.parsedRows.slice(1).map((row) => ({
        player_name: row[state.columnMapping.player_name] ?? "",
        country: row[state.columnMapping.country] ?? "",
        score: parseFloat(row[state.columnMapping.score] || "0"),
      })),
    [state.parsedRows, state.columnMapping],
  )

  const [resolutions, setResolutions] = useState<Resolution[]>(
    state.resolutions.length === parseRows.length ? state.resolutions : [],
  )

  const names = useMemo(() => parseRows.map((r) => r.player_name), [parseRows])
  const uniqueNameCount = useMemo(() => new Set(names).size, [names])
  const [checkedCount, setCheckedCount] = useState(0)

  // One batched request per BATCH_SIZE unique names instead of one request
  // (and one state update) per row — large CSVs froze the page otherwise
  const {
    data: candidatesByName,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["players", "search-batch", names],
    queryFn: async () => {
      setCheckedCount(0)
      const all: Record<string, PlayerSearchResult[]> = {}
      for (const chunk of chunkUniqueNames(names, BATCH_SIZE)) {
        const response = await PlayersService.searchPlayersBatchRoute({
          requestBody: { names: chunk },
        })
        Object.assign(all, response.results)
        setCheckedCount((count) => count + chunk.length)
      }
      return all
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(() => {
    if (candidatesByName === undefined) return
    setResolutions((prev) =>
      prev.length === parseRows.length
        ? prev
        : buildResolutions(parseRows, candidatesByName),
    )
  }, [candidatesByName, parseRows])

  const allSettled =
    candidatesByName !== undefined && resolutions.length === parseRows.length

  const [showMatched, setShowMatched] = useState(false)
  const [showCreated, setShowCreated] = useState(false)

  const needsReviewIndices = parseRows
    .map((_, i) => i)
    .filter((i) => resolutions[i]?.autoResolved !== true)

  const autoMatchedIndices = parseRows
    .map((_, i) => i)
    .filter(
      (i) =>
        resolutions[i]?.autoResolved === true &&
        resolutions[i]?.player_id !== null,
    )

  const autoCreateIndices = parseRows
    .map((_, i) => i)
    .filter(
      (i) =>
        resolutions[i]?.autoResolved === true &&
        resolutions[i]?.player_create !== null,
    )

  const canProceed =
    allSettled &&
    needsReviewIndices.every(
      (i) =>
        (resolutions[i]?.player_id ?? null) !== null ||
        (resolutions[i]?.player_create ?? null) !== null,
    )

  const handleChange = (i: number, r: Resolution) =>
    setResolutions((prev) => {
      const next = [...prev]
      // Use the incoming autoResolved if provided (auto-selection); otherwise preserve
      // the existing bucket so admin overrides stay in their original section
      next[i] = {
        ...r,
        autoResolved:
          r.autoResolved !== undefined ? r.autoResolved : prev[i]?.autoResolved,
      }
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

      {!allSettled && !isError && (
        <p className="text-sm text-muted-foreground">
          Matching players… ({checkedCount} / {uniqueNameCount})
        </p>
      )}

      {isError && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-destructive">
            Player matching failed. Check your connection and try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {allSettled && needsReviewIndices.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-destructive">
            Needs Review ({needsReviewIndices.length})
          </p>
          <VirtualRowList
            indices={needsReviewIndices}
            parseRows={parseRows}
            candidatesByName={candidatesByName}
            resolutions={resolutions}
            onRowChange={handleChange}
            variant="review"
          />
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
            <VirtualRowList
              indices={autoMatchedIndices}
              parseRows={parseRows}
              candidatesByName={candidatesByName}
              resolutions={resolutions}
              onRowChange={handleChange}
            />
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
            <VirtualRowList
              indices={autoCreateIndices}
              parseRows={parseRows}
              candidatesByName={candidatesByName}
              resolutions={resolutions}
              onRowChange={handleChange}
            />
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
