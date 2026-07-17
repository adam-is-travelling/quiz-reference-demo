import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"
import type { PlayerPublic } from "@/client"
import { PlayersService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { countryName } from "@/lib/countries"
import { handleError } from "@/utils"

type MergeSearch = {
  source?: string
  target?: string
}

export const Route = createFileRoute("/_layout/admin_/players/merge")({
  component: AdminPlayerMerge,
  validateSearch: (search: Record<string, unknown>): MergeSearch => ({
    source: typeof search.source === "string" ? search.source : undefined,
    target: typeof search.target === "string" ? search.target : undefined,
  }),
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Merge Players - Admin" }],
  }),
})

function PlayerSummary({ player }: { player: PlayerPublic }) {
  return (
    <div className="flex flex-col">
      <span className="font-medium">{player.display_name}</span>
      <span className="text-xs text-muted-foreground">
        {[
          player.countries?.map((c) => countryName(c)).join(", "),
          player.city,
          player.club,
        ]
          .filter(Boolean)
          .join(" · ") || "No profile details"}
      </span>
    </div>
  )
}

function PlayerSearchPicker({
  label,
  hint,
  value,
  onSelect,
  excludeId,
}: {
  label: string
  hint: string
  value: PlayerPublic | null
  onSelect: (p: PlayerPublic | null) => void
  excludeId?: string
}) {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const { data } = useQuery({
    queryKey: ["players", "search", debounced],
    queryFn: () =>
      PlayersService.searchPlayersRoute({ q: debounced, limit: 8 }),
    enabled: !value && debounced.length > 0,
  })

  const results = (data?.data ?? []).filter((r) => r.player.id !== excludeId)

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4 flex-1 min-w-64">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {value ? (
        <div className="flex items-center justify-between gap-2">
          <PlayerSummary player={value} />
          <Button variant="outline" size="sm" onClick={() => onSelect(null)}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <Input
            placeholder="Search players…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`${label} player search`}
          />
          <div className="flex flex-col gap-1">
            {results.map((r) => (
              <button
                key={r.player.id}
                type="button"
                onClick={() => onSelect(r.player)}
                className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <PlayerSummary player={r.player} />
              </button>
            ))}
            {debounced.length > 0 && results.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">
                No players found
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function usePrefillPlayer(
  id: string | undefined,
  current: PlayerPublic | null,
  set: (p: PlayerPublic) => void,
) {
  const { data } = useQuery({
    queryKey: ["players", "prefill", id],
    queryFn: () => PlayersService.getPlayer({ playerId: id! }),
    enabled: !!id && !current,
  })
  useEffect(() => {
    if (data) set(data)
  }, [data, set])
}

function AdminPlayerMerge() {
  const searchParams = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [source, setSource] = useState<PlayerPublic | null>(null)
  const [target, setTarget] = useState<PlayerPublic | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  usePrefillPlayer(searchParams.source, source, setSource)
  usePrefillPlayer(searchParams.target, target, setTarget)

  const bothSelected = source !== null && target !== null

  const previewQuery = useQuery({
    queryKey: ["players", "merge-preview", source?.id, target?.id],
    queryFn: () =>
      PlayersService.previewMergePlayersRoute({
        requestBody: {
          source_player_id: source!.id,
          target_player_id: target!.id,
        },
      }),
    enabled: bothSelected,
  })

  const mergeMutation = useMutation({
    mutationFn: () =>
      PlayersService.mergePlayersRoute({
        requestBody: {
          source_player_id: source!.id,
          target_player_id: target!.id,
        },
      }),
    onSuccess: (merged) => {
      setConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ["players"] })
      showSuccessToast(
        `Merged ${source?.display_name} into ${merged.display_name}`,
      )
      if (merged.slug) {
        navigate({ to: "/players/$slug", params: { slug: merged.slug } })
      } else {
        setSource(null)
        setTarget(null)
      }
    },
    onError: handleError.bind(showErrorToast),
  })

  const preview = previewQuery.data

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Merge Players</h1>
        <p className="text-muted-foreground">
          Move all quiz results from a duplicate player onto the canonical one,
          then delete the duplicate.
        </p>
      </div>

      <div className="flex flex-wrap items-stretch gap-3">
        <PlayerSearchPicker
          label="Source (will be deleted)"
          hint="The duplicate record"
          value={source}
          onSelect={setSource}
          excludeId={target?.id}
        />
        <div className="flex items-center">
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <PlayerSearchPicker
          label="Target (will be kept)"
          hint="The canonical record"
          value={target}
          onSelect={setTarget}
          excludeId={source?.id}
        />
      </div>

      {bothSelected && preview && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border p-4 text-sm flex flex-col gap-1">
            <p>
              <span className="font-medium">{preview.moved_results_count}</span>{" "}
              quiz result{preview.moved_results_count === 1 ? "" : "s"} will
              move to {target.display_name}.
            </p>
            {preview.added_countries.length > 0 && (
              <p>
                Countries added:{" "}
                {preview.added_countries.map((c) => countryName(c)).join(", ")}
              </p>
            )}
            {preview.filled_fields.length > 0 && (
              <p>
                Blank fields filled from source:{" "}
                {preview.filled_fields.join(", ")}
              </p>
            )}
          </div>

          {preview.conflicts.length > 0 && (
            <div className="rounded-lg border border-destructive p-4 text-sm flex flex-col gap-2">
              <p className="font-medium text-destructive">
                {preview.conflicts.length} conflicting result
                {preview.conflicts.length === 1 ? "" : "s"} will be permanently
                deleted
              </p>
              <p className="text-muted-foreground">
                Both players have a result in these quizzes. The target&apos;s
                result is kept; the source&apos;s is deleted.
              </p>
              <ul className="flex flex-col gap-1">
                {preview.conflicts.map((c) => (
                  <li key={c.quiz_id}>
                    <span className="font-medium">{c.quiz_name}</span>{" "}
                    <span className="text-muted-foreground">
                      ({c.start_date}) — deleting source score {c.source_score},
                      keeping target score {c.target_score}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            className="self-start"
            variant={preview.conflicts.length > 0 ? "destructive" : "default"}
            onClick={() => setConfirmOpen(true)}
          >
            Merge players
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge players?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {source?.display_name}
            </span>{" "}
            will be deleted and its results moved to{" "}
            <span className="font-medium text-foreground">
              {target?.display_name}
            </span>
            .
            {preview && preview.conflicts.length > 0 && (
              <>
                {" "}
                {preview.conflicts.length} conflicting source result
                {preview.conflicts.length === 1 ? "" : "s"} will be permanently
                deleted.
              </>
            )}{" "}
            This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <LoadingButton
              variant="destructive"
              loading={mergeMutation.isPending}
              onClick={() => mergeMutation.mutate()}
            >
              Merge
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
