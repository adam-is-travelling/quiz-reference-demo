import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { useEffect, useId, useState } from "react"
import type {
  QuizResultWithPlayer,
  ResultParticipantCreate,
  TeamType,
} from "@/client"
import { PlayersService, QuizzesService } from "@/client"
import { Button } from "@/components/ui/button"
import { CountrySelect } from "@/components/ui/CountrySelect"
import { Input } from "@/components/ui/input"
import useCustomToast from "@/hooks/useCustomToast"
import { inferCountryFromTeamName } from "@/lib/countries"
import { handleError } from "@/utils"

const SELECT_CLASS =
  "flex h-8 w-40 rounded-md border border-input bg-background px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"

/**
 * Correct one team's name, type and country, and add or remove its squad
 * members.
 *
 * The team lives on the RESULT, so an edit here touches this quiz only —
 * a team of the same name in any other quiz is a different team and is
 * untouched by construction. Nothing here looks a team up by name.
 *
 * There is no lineup endpoint: PATCH replaces the whole participant set, so
 * both add and remove send the full list. Existing members are re-sent with
 * their stored per-participant country so a replace does not discard it.
 */
export function TeamLineupEditor({
  quizSlug,
  quizId,
  result,
}: {
  quizSlug: string
  quizId: string
  result: QuizResultWithPlayer
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  // A teams quiz renders one editor per row, so the label/control ids have to
  // be unique per instance — hardcoded ids would collide across rows and every
  // label would point at the first row's inputs.
  const fieldId = useId()
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [teamName, setTeamName] = useState(result.team_name ?? "")
  const [teamType, setTeamType] = useState<TeamType | "">(
    result.team_type ?? "",
  )
  const [teamCountry, setTeamCountry] = useState<string | null>(
    result.team_country ?? null,
  )

  const participants = result.participants ?? []

  // Re-seed the fields whenever the saved result changes underneath, so a
  // successful save (or someone else's edit arriving with a refetch) leaves
  // the inputs showing what is actually stored rather than a stale draft.
  useEffect(() => {
    setTeamName(result.team_name ?? "")
    setTeamType(result.team_type ?? "")
    setTeamCountry(result.team_country ?? null)
  }, [result.team_name, result.team_type, result.team_country])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const { data: candidates } = useQuery({
    queryKey: ["players", "search", debounced],
    queryFn: () =>
      PlayersService.searchPlayersRoute({ q: debounced, limit: 5 }),
    enabled: debounced.length >= 2,
  })

  const save = useMutation({
    mutationFn: (nextParticipants: ResultParticipantCreate[]) =>
      QuizzesService.updateQuizResult({
        quizId,
        resultId: result.id,
        requestBody: { participants: nextParticipants },
      }),
    onSuccess: () => {
      showSuccessToast("Squad updated")
      setQuery("")
      // The results table reads ["quizzes", <slug>, "results"], so this is the
      // key that makes the edited row re-render with its new squad.
      //
      // RETURNED, not fired and forgotten: React Query holds the mutation
      // pending until the returned promise settles, which keeps `busy` true
      // across the refetch. Otherwise the controls re-enable while
      // `result.participants` is still the pre-save list, and a second quick
      // add would build its full-set payload from that stale list and drop
      // the player just added.
      return queryClient.invalidateQueries({
        queryKey: ["quizzes", quizSlug, "results"],
      })
    },
    // Surfaces the API's own detail — "Player already has a result in this
    // quiz" is the failure an admin is most likely to hit here.
    onError: handleError.bind(showErrorToast),
  })

  // The same endpoint and the same invalidation as the squad editor; only
  // the fields differ. Kept as its own mutation so a team save neither
  // clears the player search box nor claims the squad changed.
  const saveTeam = useMutation({
    mutationFn: () =>
      QuizzesService.updateQuizResult({
        quizId,
        resultId: result.id,
        requestBody: {
          team_name: teamName.trim(),
          team_type: teamType === "" ? null : teamType,
          team_country: teamCountry,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Team updated")
      return queryClient.invalidateQueries({
        queryKey: ["quizzes", quizSlug, "results"],
      })
    },
    // Surfaces the API's own detail — a name another team in this quiz
    // already holds is the failure an admin is most likely to hit here.
    onError: handleError.bind(showErrorToast),
  })

  const current = (): ResultParticipantCreate[] =>
    participants.map((p) => ({ player_id: p.player_id, country: p.country }))

  const add = (playerId: string) =>
    save.mutate([...current(), { player_id: playerId }])

  const remove = (playerId: string) =>
    save.mutate(current().filter((p) => p.player_id !== playerId))

  const createAndAdd = useMutation({
    mutationFn: async (displayName: string) => {
      const player = await PlayersService.createPlayerRoute({
        requestBody: { display_name: displayName, countries: [] },
      })
      return player.id
    },
    onSuccess: (playerId) => {
      // A brand-new player should show up in the admin players list and in
      // cached searches straight away, not at cache expiry.
      queryClient.invalidateQueries({ queryKey: ["players"] })
      add(playerId)
    },
    onError: () => showErrorToast("Failed to create the player"),
  })

  const alreadyInSquad = new Set(participants.map((p) => p.player_id))
  const suggestions = (candidates?.data ?? []).filter(
    (c) => !alreadyInSquad.has(c.player.id),
  )
  const busy = save.isPending || createAndAdd.isPending || saveTeam.isPending
  const teamChanged =
    teamName.trim() !== (result.team_name ?? "") ||
    teamType !== (result.team_type ?? "") ||
    teamCountry !== (result.team_country ?? null)

  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${fieldId}-name`}
            className="text-muted-foreground text-xs"
          >
            Team name
          </label>
          <Input
            id={`${fieldId}-name`}
            value={teamName}
            className="h-8 w-40"
            disabled={busy}
            onChange={(e) => setTeamName(e.target.value)}
            onBlur={() => {
              // Fill an empty country from the new name, on blur rather than
              // per keystroke so it cannot fight the admin mid-edit. Gated on
              // the name having actually changed: an admin who cleared the
              // country to mark the side international must not have it
              // refilled the next time this input loses focus.
              const renamed = teamName.trim() !== (result.team_name ?? "")
              if (!renamed || teamType !== "national" || teamCountry) return
              setTeamCountry(inferCountryFromTeamName(teamName))
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${fieldId}-type`}
            className="text-muted-foreground text-xs"
          >
            Team type
          </label>
          <select
            id={`${fieldId}-type`}
            value={teamType}
            disabled={busy}
            className={SELECT_CLASS}
            onChange={(e) => setTeamType(e.target.value as TeamType | "")}
          >
            {teamType === "" && <option value="">— Unknown —</option>}
            <option value="national">National</option>
            <option value="club">Club</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${fieldId}-country`}
            className="text-muted-foreground text-xs"
          >
            Team country
          </label>
          <CountrySelect
            id={`${fieldId}-country`}
            value={teamCountry}
            disabled={busy}
            className={SELECT_CLASS}
            onChange={setTeamCountry}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !teamChanged || !teamName.trim() || teamType === ""}
          onClick={() => saveTeam.mutate()}
        >
          Save team
        </Button>
      </div>
      {teamType === "national" && teamCountry === null && (
        // The domain rule, stated where it is acted on: there is no
        // "international" type — a national side with no country IS the
        // international side, and the label is derived from that.
        <p className="text-muted-foreground text-xs">
          A national team with no country reads as International.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {participants.map((p) => (
          <span
            key={p.player_id}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          >
            {p.player_display_name}
            <button
              type="button"
              aria-label={`Remove ${p.player_display_name}`}
              onClick={() => remove(p.player_id)}
              disabled={busy}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {participants.length === 0 && (
          <span className="text-muted-foreground text-xs">
            No squad recorded
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={query}
          // A teams quiz renders one of these per row, and the placeholder is
          // not an accessible name.
          aria-label="Add a player"
          placeholder="Add a player…"
          className="h-8 max-w-xs"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim().length >= 2 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => createAndAdd.mutate(query.trim())}
            disabled={busy}
          >
            <Plus className="mr-1 h-3 w-3" />
            Create "{query.trim()}"
          </Button>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((c) => (
            <Button
              key={c.player.id}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => add(c.player.id)}
              disabled={busy}
            >
              {c.player.display_name}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
