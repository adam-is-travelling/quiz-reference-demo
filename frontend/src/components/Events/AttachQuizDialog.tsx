import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

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
import { Input } from "@/components/ui/input"
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
  const [selected, setSelected] = useState<AttachableQuizOption | null>(null)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(t)
  }, [query])

  // Server-side search: the full quiz list is unbounded, so filtering a capped
  // page in the browser would silently hide older quizzes from the results.
  const { data } = useQuery({
    queryFn: () =>
      QuizzesService.readQuizzes({ q: debounced, skip: 0, limit: 20 }),
    queryKey: ["quizzes", "search", debounced],
    enabled: open && !selected && debounced.length > 0,
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
      setSelected(null)
      setQuery("")
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
          <Label htmlFor="attach-quiz-search">Quiz</Label>
          {selected ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{selected.label}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelected(null)
                  setQuery("")
                }}
              >
                Change
              </Button>
            </div>
          ) : (
            <>
              <Input
                id="attach-quiz-search"
                data-testid={Labels.attachQuizSearch}
                placeholder="Search quizzes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="flex flex-col gap-1">
                {options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelected(option)}
                    className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {option.label}
                  </button>
                ))}
                {debounced.length > 0 && options.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-1">
                    No quizzes found
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selected || attachMutation.isPending}
            onClick={() => selected && attachMutation.mutate(selected.id)}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
