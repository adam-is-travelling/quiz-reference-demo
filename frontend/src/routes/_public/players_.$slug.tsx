import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { GitMerge, Trash2 } from "lucide-react"
import { Suspense, useState } from "react"

import type { PlayerHistory, PlayerPublic } from "@/client"
import { PlayersService } from "@/client"
import { EditPlayerDialog } from "@/components/Players/EditPlayerDialog"
import { PlayerProfile } from "@/components/Players/PlayerProfile"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"

function getPlayerQueryOptions(slug: string) {
  return {
    queryFn: () => PlayersService.getPlayerBySlugRoute({ slug }),
    queryKey: ["players", "slug", slug],
  }
}

function getPlayerHistoryQueryOptions(playerId: string) {
  return {
    queryFn: () => PlayersService.getPlayerHistoryRoute({ playerId }),
    queryKey: ["players", playerId, "history"],
  }
}

export const Route = createFileRoute("/_public/players_/$slug")({
  component: PlayerPage,
  head: () => ({ meta: [{ title: "Player" }] }),
})

function AdminControls({
  player,
  history,
}: {
  player: PlayerPublic
  history: PlayerHistory
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => PlayersService.deletePlayerRoute({ playerId: player.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["players"] })
      showSuccessToast("Player deleted")
      navigate({ to: "/players", search: { page: 1 } })
    },
    onError: () => showErrorToast("Failed to delete player"),
  })

  return (
    <>
      <EditPlayerDialog player={player} />

      <Button variant="outline" size="sm" asChild>
        <Link to="/admin/players/merge" search={{ source: player.id }}>
          <GitMerge className="h-4 w-4 mr-1" />
          Merge into…
        </Link>
      </Button>

      {history.data.length === 0 && (
        <>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete player?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This will permanently delete{" "}
                <span className="font-medium text-foreground">
                  {player.display_name}
                </span>
                . This cannot be undone.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  )
}

function PlayerContent({ slug }: { slug: string }) {
  const { user } = useAuth()
  const { data: player } = useSuspenseQuery(getPlayerQueryOptions(slug))
  const { data: history } = useSuspenseQuery(
    getPlayerHistoryQueryOptions(player.id),
  )

  return (
    <div className="flex flex-col gap-2">
      {user?.is_superuser && (
        <div className="flex justify-end gap-2">
          <AdminControls player={player} history={history} />
        </div>
      )}
      <PlayerProfile player={player} history={history} />
    </div>
  )
}

function PlayerPage() {
  const { slug } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <PlayerContent slug={slug} />
    </Suspense>
  )
}
