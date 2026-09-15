import { useQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { PlayerSearchResult } from "@/client"
import { PlayersService } from "@/client"
import { Button } from "@/components/ui/button"
import { CountrySelect } from "@/components/ui/CountrySelect"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { countryName, resolveCountryCode } from "@/lib/countries"
import {
  buildRowResolutions,
  chunkUniqueNames,
  type ParsedRow,
  type RowResolution,
} from "@/lib/matchPlayers"
import { normalizePlayerName } from "@/lib/normalizePlayerName"
import { namesForRow } from "@/lib/splitPairNames"
import { groupSlotsByTeam, squadStatus, squadSummary } from "@/lib/teamGroups"
import { Labels } from "@/test-ids"
import type {
  ParticipantMode,
  Resolution,
  ReviewClass,
  WizardState,
} from "../types"
import { TeamCard } from "./TeamCard"
import { defaultTeamDetails } from "./TeamsPanel"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

const BATCH_SIZE = 500

const REVIEW_STYLES: Record<
  ReviewClass,
  { border: string; dot: string; label: string }
> = {
  "country-mismatch": {
    border: "border-green-600 dark:border-green-500",
    dot: "bg-green-600 dark:bg-green-500",
    label: "Match found, different country — confirm",
  },
  "single-candidate": {
    border: "border-yellow-500 dark:border-yellow-400",
    dot: "bg-yellow-500 dark:bg-yellow-400",
    label: "One possible match",
  },
  ambiguous: {
    border: "border-destructive",
    dot: "bg-destructive",
    label: "Needs a decision",
  },
}

// A single participant slot within the flattened rows — every row contributes
// one slot per participant (one for individual, up to two for pairs, and a
// whole squad for teams, which is unbounded).
interface ParticipantSlot {
  rowIndex: number
  slot: number
  parsedRow: ParsedRow
  partnerName?: string
}

// Radios sharing a `name` form one DOM radio group, and the browser allows
// only one checked member per group — so two participants that collide on a
// name make it silently clear the first one's dot while React still believes
// it is checked and never repaints it. The resolution itself is unaffected,
// so the symptom is a blank radio on a correctly matched player. A squad has
// more than two members, which is why keying the group by `rowIndex * 2 +
// slot` collided as soon as a row contributed a third participant.
export function radioGroupName(rowIndex: number, slot: number): string {
  return `row-${rowIndex}-slot-${slot}`
}

// One card's worth of team: its name, the slots of its squad, and how that
// squad currently stands.
interface TeamCardModel {
  teamName: string
  slotIndices: number[]
  status: ReturnType<typeof squadStatus>
}

function buildParticipantSlots(rows: ParsedRow[][]): ParticipantSlot[] {
  const slots: ParticipantSlot[] = []
  rows.forEach((row, rowIndex) => {
    row.forEach((parsedRow, slot) => {
      const partner = row.length > 1 ? row[1 - slot] : undefined
      slots.push({
        rowIndex,
        slot,
        parsedRow,
        partnerName: partner?.player_name,
      })
    })
  })
  return slots
}

function RowDisambiguator({
  parsedRow,
  candidates,
  resolution,
  onChange,
  groupName,
  variant = "default",
  participantMode,
  rowIndex,
  slot,
  partnerName,
  teamName,
}: {
  parsedRow: ParsedRow
  candidates: PlayerSearchResult[]
  resolution: Resolution
  onChange: (r: Resolution) => void
  groupName: string
  variant?: "default" | "review"
  participantMode: ParticipantMode
  rowIndex: number
  slot: number
  partnerName?: string
  teamName?: string
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

  const review =
    variant === "review"
      ? REVIEW_STYLES[resolution.reviewClass ?? "ambiguous"]
      : null

  return (
    <div
      className={`border rounded-lg p-4 flex flex-col gap-3 ${
        review ? review.border : ""
      }`}
      title={review?.label}
    >
      {review && <span className="sr-only">{review.label}</span>}
      <p className="text-sm font-medium">
        {parsedRow.player_name} · {parsedRow.country} · Score: {parsedRow.score}
      </p>
      {participantMode === "pairs" && (
        <p className="text-xs text-muted-foreground">
          Row {rowIndex + 1}, quizzer {slot + 1}
          {partnerName ? ` — partner: ${partnerName}` : ""}
        </p>
      )}
      {/* Gathered out of its team's card, a player has to say which team it
          came from to be actionable. */}
      {teamName !== undefined && (
        <p className="text-xs text-muted-foreground">{teamName}</p>
      )}

      <div className="flex flex-col gap-2">
        {candidates.map((c) => (
          <label
            key={c.player.id}
            className="flex items-center gap-3 cursor-pointer"
          >
            <input
              type="radio"
              name={groupName}
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
            name={groupName}
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
  participantSlots,
  candidatesByName,
  getResolution,
  onSlotChange,
  variant,
  participantMode,
  teamNameOf,
}: {
  indices: number[]
  participantSlots: ParticipantSlot[]
  candidatesByName: Record<string, PlayerSearchResult[]>
  getResolution: (flatIndex: number) => Resolution
  onSlotChange: (flatIndex: number, r: Resolution) => void
  variant?: "default" | "review"
  participantMode: ParticipantMode
  teamNameOf?: (flatIndex: number) => string | undefined
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
          const slot = participantSlots[i]
          return (
            <div
              key={i}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-3"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <RowDisambiguator
                parsedRow={slot.parsedRow}
                candidates={candidatesByName[slot.parsedRow.player_name] ?? []}
                resolution={getResolution(i)}
                onChange={(r) => onSlotChange(i, r)}
                groupName={radioGroupName(slot.rowIndex, slot.slot)}
                variant={variant}
                participantMode={participantMode}
                rowIndex={slot.rowIndex}
                slot={slot.slot}
                partnerName={slot.partnerName}
                teamName={teamNameOf?.(i)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The cards are virtualized for the same reason the rows are: a large file
// otherwise mounts every squad at once. measureElement handles a card growing
// when its squad is expanded.
function VirtualTeamList({
  cards,
  renderCard,
}: {
  cards: TeamCardModel[]
  renderCard: (card: TeamCardModel) => ReactNode
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 4,
  })

  return (
    <div ref={parentRef} className="max-h-[50vh] overflow-y-auto pr-1">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={cards[item.index].teamName}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full pb-3"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {renderCard(cards[item.index])}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Step4Disambiguation({ state, update }: Props) {
  const parsedRows: ParsedRow[][] = useMemo(
    () =>
      state.parsedRows.slice(1).map((row) => {
        const names = namesForRow(
          row,
          state.columnMapping,
          state.participantMode,
        )
        const country =
          state.columnMapping.country !== null
            ? (row[state.columnMapping.country] ?? "")
            : ""
        const score = parseFloat(row[state.columnMapping.score] || "0")
        return names.map((player_name) => ({
          player_name: normalizePlayerName(player_name),
          country,
          score,
        }))
      }),
    [state.parsedRows, state.columnMapping, state.participantMode],
  )

  const participantSlots = useMemo(
    () => buildParticipantSlots(parsedRows),
    [parsedRows],
  )

  // Teams have no cross-quiz identity, so there is nothing to match — the
  // panel below only collects a type and country for each distinct name.
  const teamNames = useMemo(() => {
    if (state.participantMode !== "teams") return []
    const col = state.columnMapping.team_name
    if (col === null) return []
    const seen = new Set<string>()
    const names: string[] = []
    for (const row of state.parsedRows.slice(1)) {
      const name = (row[col] ?? "").trim()
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase())
        names.push(name)
      }
    }
    return names
  }, [state.parsedRows, state.columnMapping.team_name, state.participantMode])

  const seededCountries = useMemo(() => {
    const col = state.columnMapping.country
    const out: Record<string, string | null> = {}
    if (state.participantMode !== "teams" || col === null) return out
    const teamCol = state.columnMapping.team_name
    if (teamCol === null) return out
    for (const row of state.parsedRows.slice(1)) {
      const name = (row[teamCol] ?? "").trim()
      if (name && !(name in out)) {
        out[name] = resolveCountryCode(row[col] ?? "")
      }
    }
    return out
  }, [
    state.parsedRows,
    state.columnMapping.country,
    state.columnMapping.team_name,
    state.participantMode,
  ])

  const [resolutions, setResolutions] = useState<RowResolution[]>(
    state.resolutions.length === parsedRows.length ? state.resolutions : [],
  )

  const getResolution = useCallback(
    (flatIndex: number): Resolution => {
      const { rowIndex, slot } = participantSlots[flatIndex]
      return (
        resolutions[rowIndex]?.participants[slot] ?? {
          player_id: null,
          player_create: null,
        }
      )
    },
    [participantSlots, resolutions],
  )

  const names = useMemo(
    () => parsedRows.flat().map((p) => p.player_name),
    [parsedRows],
  )
  const uniqueNameCount = useMemo(() => new Set(names).size, [names])
  const [checkedCount, setCheckedCount] = useState(0)

  // One batched request per BATCH_SIZE unique names instead of one request
  // (and one state update) per row — large CSVs froze the page otherwise.
  // Flattening the participant list means each distinct name is searched
  // once whether it appears as the first or second member of a pair.
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
      prev.length === parsedRows.length
        ? prev
        : buildRowResolutions(parsedRows, candidatesByName),
    )
  }, [candidatesByName, parsedRows])

  // Seed one TeamDetails per distinct team name once the names are known.
  // This effect both reads and writes state.teamsByName, so it only writes
  // when the seeded map actually differs — defaultTeamDetails reuses the
  // admin's existing entries by reference, so identity comparison is exact
  // and a no-op run cannot retrigger itself.
  useEffect(() => {
    if (state.participantMode !== "teams") return
    const next = defaultTeamDetails(
      teamNames,
      state.defaultTeamType,
      seededCountries,
      state.teamsByName,
    )
    const names = Object.keys(next)
    const unchanged =
      names.length === Object.keys(state.teamsByName).length &&
      names.every((name) => state.teamsByName[name] === next[name])
    if (unchanged) return
    update({ teamsByName: next })
  }, [
    teamNames,
    seededCountries,
    state.participantMode,
    state.defaultTeamType,
    state.teamsByName,
    update,
  ])

  const allSettled =
    candidatesByName !== undefined && resolutions.length === parsedRows.length

  const [showMatched, setShowMatched] = useState(false)
  const [showCreated, setShowCreated] = useState(false)

  const isTeams = state.participantMode === "teams"
  const [teamView, setTeamView] = useState<"by-team" | "needs-attention">(
    "by-team",
  )
  // Expansion is held here rather than in the card: the virtualizer unmounts
  // a card that scrolls out of view, and local state would not survive it.
  // An entry is only written once the admin clicks, so a card the admin has
  // not touched keeps following whether its squad still needs work.
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>(
    {},
  )

  const teamNameByRow = useMemo(() => {
    const col = state.columnMapping.team_name
    if (!isTeams || col === null) return []
    return state.parsedRows.slice(1).map((row) => (row[col] ?? "").trim())
  }, [state.parsedRows, state.columnMapping.team_name, isTeams])

  const teamNameOf = useMemo(() => {
    const groups = groupSlotsByTeam(participantSlots, teamNameByRow)
    const bySlot = new Map<number, string>()
    for (const group of groups) {
      for (const slotIndex of group.slotIndices) {
        bySlot.set(slotIndex, group.teamName)
      }
    }
    return (flatIndex: number) => bySlot.get(flatIndex)
  }, [participantSlots, teamNameByRow])

  const needsReviewIndices = participantSlots
    .map((_, i) => i)
    .filter((i) => getResolution(i).autoResolved !== true)

  const autoMatchedIndices = participantSlots
    .map((_, i) => i)
    .filter((i) => {
      const r = getResolution(i)
      return r.autoResolved === true && r.player_id !== null
    })

  const autoCreateIndices = participantSlots
    .map((_, i) => i)
    .filter((i) => {
      const r = getResolution(i)
      return r.autoResolved === true && r.player_create !== null
    })

  // Every team in the file gets a card, including one whose squad column was
  // empty — that is a supported upload, and its country is still the admin's
  // to set. So the cards are driven by the team names, with the grouped slots
  // looked up, rather than by the groups alone.
  const teamCards = useMemo<TeamCardModel[]>(() => {
    if (!isTeams) return []
    const groups = groupSlotsByTeam(participantSlots, teamNameByRow)
    const byKey = new Map(groups.map((g) => [g.teamName.toLowerCase(), g]))
    const named = teamNames.map((teamName) => {
      const slotIndices = byKey.get(teamName.toLowerCase())?.slotIndices ?? []
      return {
        teamName,
        slotIndices,
        status: squadStatus(slotIndices.map(getResolution)),
      }
    })
    const unnamed = byKey.get("")
    if (unnamed) {
      named.push({
        teamName: "",
        slotIndices: unnamed.slotIndices,
        status: squadStatus(unnamed.slotIndices.map(getResolution)),
      })
    }
    // Teams still carrying work come first; the rest keep file order.
    return named.sort(
      (a, b) =>
        Number(b.status.outstanding > 0) - Number(a.status.outstanding > 0),
    )
  }, [isTeams, participantSlots, teamNameByRow, teamNames, getResolution])

  const overallStatus = useMemo(
    () => squadStatus(participantSlots.map((_, i) => getResolution(i))),
    [participantSlots, getResolution],
  )

  const canProceed =
    allSettled &&
    needsReviewIndices.every((i) => {
      const r = getResolution(i)
      return (
        (r.player_id ?? null) !== null || (r.player_create ?? null) !== null
      )
    })

  const handleSlotChange = (flatIndex: number, r: Resolution) => {
    const { rowIndex, slot } = participantSlots[flatIndex]
    setResolutions((prev) => {
      const next = [...prev]
      const rowRes = next[rowIndex] ?? { participants: [] }
      const participants = [...rowRes.participants]
      const prevR = participants[slot]
      // Use the incoming autoResolved if provided (auto-selection); otherwise
      // preserve the existing bucket so admin overrides stay in their
      // original section
      participants[slot] = {
        ...r,
        autoResolved:
          r.autoResolved !== undefined ? r.autoResolved : prevR?.autoResolved,
        reviewClass: r.reviewClass ?? prevR?.reviewClass,
      }
      next[rowIndex] = { participants }
      return next
    })
  }

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

      {isTeams && allSettled && (
        <div className="flex flex-col gap-3">
          <div className="flex w-fit rounded-md border overflow-hidden">
            {(
              [
                ["by-team", "By team", Labels.step4ViewByTeam],
                [
                  "needs-attention",
                  `Needs attention (${overallStatus.outstanding})`,
                  Labels.step4ViewNeedsAttention,
                ],
              ] as const
            ).map(([view, label, testId]) => (
              <button
                key={view}
                type="button"
                data-testid={testId}
                onClick={() => setTeamView(view)}
                className={`px-4 py-1.5 text-sm ${
                  teamView === view
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {teamView === "by-team" ? (
            <VirtualTeamList
              cards={teamCards}
              renderCard={(card) => (
                <TeamCard
                  teamName={card.teamName}
                  details={
                    state.teamsByName[card.teamName] ?? {
                      team_type: state.defaultTeamType,
                      team_country: null,
                      is_international: false,
                    }
                  }
                  onChange={(patch) =>
                    update({
                      teamsByName: {
                        ...state.teamsByName,
                        [card.teamName]: {
                          ...state.teamsByName[card.teamName],
                          ...patch,
                        },
                      },
                    })
                  }
                  showTypeSelect={state.defaultTeamType === "national"}
                  summary={squadSummary(card.status)}
                  squadCount={card.slotIndices.length}
                  expanded={
                    expandedTeams[card.teamName] ?? card.status.outstanding > 0
                  }
                  onToggle={() =>
                    setExpandedTeams((prev) => ({
                      ...prev,
                      [card.teamName]: !(
                        prev[card.teamName] ?? card.status.outstanding > 0
                      ),
                    }))
                  }
                >
                  {card.slotIndices.map((flatIndex) => {
                    const slot = participantSlots[flatIndex]
                    return (
                      <RowDisambiguator
                        key={flatIndex}
                        parsedRow={slot.parsedRow}
                        candidates={
                          candidatesByName?.[slot.parsedRow.player_name] ?? []
                        }
                        resolution={getResolution(flatIndex)}
                        onChange={(r) => handleSlotChange(flatIndex, r)}
                        groupName={radioGroupName(slot.rowIndex, slot.slot)}
                        variant={
                          getResolution(flatIndex).autoResolved === true
                            ? "default"
                            : "review"
                        }
                        participantMode={state.participantMode}
                        rowIndex={slot.rowIndex}
                        slot={slot.slot}
                      />
                    )
                  })}
                </TeamCard>
              )}
            />
          ) : (
            <div
              data-testid={Labels.step4NeedsAttentionList}
              className="flex flex-col gap-3"
            >
              {needsReviewIndices.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing needs addressing.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {Object.entries(REVIEW_STYLES).map(([key, s]) => (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1.5"
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${s.dot}`}
                          aria-hidden="true"
                        />
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <VirtualRowList
                    indices={needsReviewIndices}
                    participantSlots={participantSlots}
                    candidatesByName={candidatesByName ?? {}}
                    getResolution={getResolution}
                    onSlotChange={handleSlotChange}
                    variant="review"
                    participantMode={state.participantMode}
                    teamNameOf={teamNameOf}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!isTeams && allSettled && needsReviewIndices.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-destructive">
            Needs Review ({needsReviewIndices.length})
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {Object.entries(REVIEW_STYLES).map(([key, s]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${s.dot}`}
                  aria-hidden="true"
                />
                {s.label}
              </span>
            ))}
          </div>
          <VirtualRowList
            indices={needsReviewIndices}
            participantSlots={participantSlots}
            candidatesByName={candidatesByName ?? {}}
            getResolution={getResolution}
            onSlotChange={handleSlotChange}
            variant="review"
            participantMode={state.participantMode}
          />
        </div>
      )}

      {!isTeams && allSettled && autoMatchedIndices.length > 0 && (
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
              participantSlots={participantSlots}
              candidatesByName={candidatesByName ?? {}}
              getResolution={getResolution}
              onSlotChange={handleSlotChange}
              participantMode={state.participantMode}
            />
          )}
        </div>
      )}

      {!isTeams && allSettled && autoCreateIndices.length > 0 && (
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
              participantSlots={participantSlots}
              candidatesByName={candidatesByName ?? {}}
              getResolution={getResolution}
              onSlotChange={handleSlotChange}
              participantMode={state.participantMode}
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
