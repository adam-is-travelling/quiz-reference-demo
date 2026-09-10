import { useState } from "react"
import type { QuizResultWithPlayer } from "@/client"
import { PlayerLinks } from "@/components/Common/PlayerLinks"
import { TeamLineupEditor } from "@/components/Quizzes/TeamLineupEditor"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { teamLabel } from "@/lib/countries"

/** What the collapsed squad trigger reads, given how many turned out. */
export function squadTriggerLabel(count: number): string {
  if (count === 0) return "Add squad"
  return count === 1 ? "1 player" : `${count} players`
}

/**
 * A team's squad, collapsed behind a trigger so the table reads as a list of
 * teams rather than a wall of names.
 *
 * Hovering previews the squad as plain text; clicking opens the panel, where
 * the names are real links and an admin gets the full team editor. The peek
 * is deliberately non-interactive — a tooltip cannot hold reliable click
 * targets, so anything you need to click lives in the panel.
 *
 * An admin always gets a trigger, even at zero players: filling in a squad
 * that an upload never listed is the whole reason the empty state exists, so
 * it must have a way in. A visitor looking at an empty squad gets plain text.
 */
export function SquadCell({
  result,
  quizId,
  resultsQueryKey,
  canEdit,
}: {
  result: QuizResultWithPlayer
  quizId?: string
  /** The results query the host page renders from; see TeamLineupEditor. */
  resultsQueryKey?: readonly unknown[]
  canEdit?: boolean
}) {
  const [open, setOpen] = useState(false)
  const participants = result.participants ?? []
  const editable = Boolean(canEdit && quizId && resultsQueryKey)

  if (participants.length === 0 && !editable) {
    return (
      <span className="text-muted-foreground text-xs">No squad recorded</span>
    )
  }

  const names = participants.map((p) => p.player_display_name).join(", ")
  const trigger = (
    <Button
      variant="link"
      size="sm"
      className="h-auto p-0 text-sm"
      onClick={() => setOpen(true)}
    >
      {squadTriggerLabel(participants.length)}
    </Button>
  )

  return (
    <div className="flex items-center gap-2">
      {participants.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{names}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}

      {/* An explicit way in, because a count alone reads as something to look
          at rather than something to change. Not shown at zero players: the
          trigger there already says "Add squad", which is its own invitation. */}
      {editable && participants.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setOpen(true)}
        >
          Edit team
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {result.team_name}{" "}
              <span className="text-muted-foreground text-sm font-normal">
                {teamLabel(result)}
              </span>
            </DialogTitle>
          </DialogHeader>
          {editable ? (
            <TeamLineupEditor
              quizId={quizId as string}
              result={result}
              resultsQueryKey={resultsQueryKey as readonly unknown[]}
            />
          ) : (
            <PlayerLinks players={participants} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
