import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import type { QuizPublic, QuizUpdate } from "@/client"
import {
  ApiError,
  FormatsService,
  OrganizationsService,
  QuizzesService,
} from "@/client"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"

interface MetadataEditDialogProps {
  quiz: QuizPublic
  /**
   * Called after a successful save when the slug changed. Only the public
   * route (keyed by slug) supplies this to navigate to the new URL; the
   * admin route keys on the quiz's UUID and must not navigate.
   */
  onSlugChange?: (newSlug: string) => void
}

export function MetadataEditDialog({
  quiz,
  onSlugChange,
}: MetadataEditDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [isMultiDay, setIsMultiDay] = useState(
    quiz.start_date !== quiz.end_date,
  )
  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    quiz.organization_id ?? "__none__",
  )
  const [selectedFormatId, setSelectedFormatId] = useState<string>(
    quiz.format_id ?? "__none__",
  )

  const { data: orgs } = useQuery({
    queryFn: () =>
      OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
    queryKey: ["organizations"],
  })

  const { data: formats, isLoading: formatsLoading } = useQuery({
    queryFn: () => FormatsService.readFormats({ skip: 0, limit: 100 }),
    queryKey: ["formats"],
  })

  const { register, handleSubmit, reset, setValue, setError, formState } =
    useForm({
      defaultValues: {
        name: quiz.name,
        start_date: quiz.start_date,
        end_date: quiz.end_date,
        organization_id: quiz.organization_id ?? "",
        organizer_name: quiz.organizer_name ?? "",
        description: quiz.description ?? "",
        format_id: quiz.format_id ?? "",
        slug: quiz.slug ?? "",
      },
      shouldUnregister: true,
    })

  const handleOrgChange = (v: string) => {
    setSelectedOrgId(v)
    if (v === "__none__") {
      setValue("organization_id", "")
      setValue("organizer_name", "")
    } else {
      const org = orgs?.data.find((o) => o.id === v)
      setValue("organization_id", v)
      setValue("organizer_name", org?.name ?? "")
    }
  }

  const mutation = useMutation({
    mutationFn: (data: QuizUpdate) =>
      QuizzesService.updateQuiz({ id: quiz.id, requestBody: data }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "quiz", quiz.id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "quizzes"] })
      queryClient.invalidateQueries({ queryKey: ["quizzes"] })
      showSuccessToast("Quiz updated")
      setOpen(false)
      if (updated.slug !== quiz.slug) {
        onSlugChange?.(updated.slug)
      }
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        const detail = (error.body as { detail?: string })?.detail
        setError("slug", {
          type: "server",
          message: detail || "Slug is already in use",
        })
        return
      }
      showErrorToast("Failed to update quiz")
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          setSelectedOrgId(quiz.organization_id ?? "__none__")
          setSelectedFormatId(quiz.format_id ?? "__none__")
          reset({
            name: quiz.name,
            start_date: quiz.start_date,
            end_date: quiz.end_date,
            organization_id: quiz.organization_id ?? "",
            organizer_name: quiz.organizer_name ?? "",
            description: quiz.description ?? "",
            format_id: quiz.format_id ?? "",
            slug: quiz.slug ?? "",
          })
        }
        setIsMultiDay(quiz.start_date !== quiz.end_date)
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
          <DialogTitle>Edit Quiz Metadata</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) =>
            mutation.mutate({
              ...data,
              end_date: isMultiDay ? data.end_date : data.start_date,
              organization_id: data.organization_id || null,
              organizer_name: data.organizer_name || null,
              format_id: data.format_id || null,
              slug: data.slug,
            } as QuizUpdate),
          )}
          className="flex flex-col gap-4 pt-2"
        >
          <input type="hidden" {...register("organization_id")} />
          <input type="hidden" {...register("organizer_name")} />
          <input type="hidden" {...register("format_id")} />
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name", { required: true })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Slug</Label>
            <Input {...register("slug", { required: "Slug is required" })} />
            {formState.errors.slug && (
              <p className="text-sm text-destructive">
                {formState.errors.slug.message}
              </p>
            )}
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
            Multi-day quiz
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
            <Label>Organization</Label>
            <Select value={selectedOrgId} onValueChange={handleOrgChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No Organization</SelectItem>
                {orgs?.data.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Format</Label>
            <Select
              value={selectedFormatId}
              onValueChange={(v) => {
                setSelectedFormatId(v)
                setValue("format_id", v === "__none__" ? "" : v)
              }}
              disabled={formatsLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={formatsLoading ? "Loading…" : "Select format"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No Format</SelectItem>
                {formats?.data.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
