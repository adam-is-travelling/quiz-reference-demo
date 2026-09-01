import { useMutation, useQueryClient } from "@tanstack/react-query"

import type { EventPublic, QuizPodium } from "@/client"
import { QuizzesService } from "@/client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"

export function RemoveQuizButton({
  event,
  quiz,
}: {
  event: EventPublic
  quiz: QuizPodium
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const removeMutation = useMutation({
    // An explicit null clears the attachment; the quiz row is untouched.
    mutationFn: () =>
      QuizzesService.updateQuiz({
        id: quiz.quiz_id,
        requestBody: { event_id: null },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", event.slug] })
      queryClient.invalidateQueries({ queryKey: ["quizzes"] })
      showSuccessToast("Quiz removed from event")
    },
    onError: () => showErrorToast("Failed to remove quiz"),
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={removeMutation.isPending}>
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove quiz from event?</AlertDialogTitle>
          <AlertDialogDescription>
            "{quiz.quiz_name}" will no longer be part of "{event.name}". The
            quiz itself is kept, along with its results, and can be added back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => removeMutation.mutate()}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
