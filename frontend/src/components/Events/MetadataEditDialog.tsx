import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import type { QuizEventPublic, QuizEventUpdate } from "@/client"
import { EventsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"

export function MetadataEditDialog({ event }: { event: QuizEventPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [isMultiDay, setIsMultiDay] = useState(
    event.start_date !== event.end_date,
  )
  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      name: event.name,
      start_date: event.start_date,
      end_date: event.end_date,
      organizer_name: event.organizer_name,
      description: event.description ?? "",
    },
    shouldUnregister: true,
  })

  const mutation = useMutation({
    mutationFn: (data: QuizEventUpdate) =>
      EventsService.updateEvent({ id: event.id, requestBody: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", event.id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      queryClient.invalidateQueries({ queryKey: ["events", event.id] })
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast("Event updated")
      setOpen(false)
    },
    onError: () => showErrorToast("Failed to update event"),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          reset({
            name: event.name,
            start_date: event.start_date,
            end_date: event.end_date,
            organizer_name: event.organizer_name,
            description: event.description ?? "",
          })
        }
        setIsMultiDay(event.start_date !== event.end_date)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4 mr-1" />
          Edit Metadata
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Event Metadata</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) =>
            mutation.mutate({
              ...data,
              end_date: isMultiDay ? data.end_date : data.start_date,
            }),
          )}
          className="flex flex-col gap-4 pt-2"
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name", { required: true })} />
          </div>
          <div className="grid gap-1.5">
            <Label>{isMultiDay ? "Start Date" : "Date"}</Label>
            <Input
              type="date"
              {...register("start_date", { required: true })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMultiDay}
              onChange={(e) => setIsMultiDay(e.target.checked)}
            />
            Multi-day event
          </label>
          {isMultiDay && (
            <div className="grid gap-1.5">
              <Label>End Date</Label>
              <Input
                type="date"
                {...register("end_date", { required: isMultiDay })}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Organizer Name</Label>
            <Input {...register("organizer_name")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <textarea
              {...register("description")}
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
