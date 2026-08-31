import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import type { EventPublic, QuizPublic } from "@/client"
import { QuizzesService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"
import { Labels } from "@/test-ids"

export interface AttachableQuizOption {
  id: string
  label: string
}

/**
 * Build the options for the attach picker. Quizzes already on this event are
 * dropped (there is nothing to do), while a quiz attached to a *different*
 * event is offered but labelled with that event, so re-pointing it is a
 * deliberate choice rather than a silent move.
 */
export function buildAttachableQuizOptions(
  quizzes: QuizPublic[],
  eventId: string,
): AttachableQuizOption[] {
  return quizzes
    .filter((quiz) => quiz.event_id !== eventId)
    .map((quiz) => {
      const base = `${quiz.name} (${quiz.start_date})`
      if (!quiz.event_id) return { id: quiz.id, label: base }
      return {
        id: quiz.id,
        label: `${base} — currently: ${quiz.event_name ?? "another event"}`,
      }
    })
}

export function AttachQuizDialog({ event }: { event: EventPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState("")

  const { data } = useQuery({
    queryFn: () => QuizzesService.readQuizzes({ skip: 0, limit: 200 }),
    queryKey: ["quizzes", "all"],
  })

  const options = buildAttachableQuizOptions(data?.data ?? [], event.id)

  const attachMutation = useMutation({
    mutationFn: (quizId: string) =>
      QuizzesService.updateQuiz({
        id: quizId,
        requestBody: { event_id: event.id },
      }),
    onSuccess: () => {
      // Refresh the event's own quiz list and podium, plus the picker source
      // so the just-attached quiz stops being offered.
      queryClient.invalidateQueries({ queryKey: ["events", event.slug] })
      queryClient.invalidateQueries({ queryKey: ["quizzes"] })
      showSuccessToast("Quiz added to event")
      setSelectedId("")
      setOpen(false)
    },
    onError: () => showErrorToast("Failed to add quiz"),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add existing quiz
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an existing quiz</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="attach-quiz-select">Quiz</Label>
          <select
            id="attach-quiz-select"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={Labels.attachQuizSelect}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="" disabled>
              — choose a quiz —
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {options.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Every approved quiz has already been added to this event.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selectedId || attachMutation.isPending}
            onClick={() => attachMutation.mutate(selectedId)}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
