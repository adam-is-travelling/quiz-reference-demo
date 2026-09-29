import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import type { RecurringSeriesPublic } from "@/client"
import { ApiError, OrganizationsService, SeriesService } from "@/client"
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
import { Labels } from "@/test-ids"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  organization_id: z.string().optional(),
  slug: z.string().optional(),
  type: z.enum(["quiz", "event"]),
})

// On the edit path the Slug field is visible and must not be submitted empty —
// clearing it and saving would otherwise leave the slug silently unchanged.
const editSchema = schema.extend({
  slug: z.string().min(1, "Slug is required"),
})

type FormValues = z.infer<typeof schema>

export const SERIES_HAS_LINKS_DETAIL = "Series has linked quizzes or events"

const SERIES_TYPES = [
  ["quiz", "Quiz", Labels.seriesTypeQuiz],
  ["event", "Event", Labels.seriesTypeEvent],
] as const

interface Props {
  competition?: RecurringSeriesPublic
  /** Type a new competition starts as; the section it was created from. */
  defaultType?: "quiz" | "event"
  trigger: React.ReactNode
}

export function CompetitionDialog({
  competition,
  defaultType = "quiz",
  trigger,
}: Props) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const isEdit = competition !== undefined

  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () =>
      OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
  })

  const defaultValues: FormValues = {
    name: competition?.name ?? "",
    description: competition?.description ?? "",
    organization_id: competition?.organization_id ?? "",
    slug: competition?.slug ?? "",
    type: competition?.type ?? defaultType,
  }

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(isEdit ? editSchema : schema),
    defaultValues,
  })
  const seriesType = watch("type")

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      if (isEdit) {
        return SeriesService.updateSeries({
          id: competition.id,
          requestBody: {
            name: data.name,
            description: data.description || null,
            organization_id: data.organization_id || null,
            slug: data.slug,
            type: data.type,
          },
        })
      }
      return SeriesService.createSeries({
        requestBody: {
          name: data.name,
          description: data.description || null,
          organization_id: data.organization_id || null,
          type: data.type,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitions"] })
      showSuccessToast(isEdit ? "Competition updated" : "Competition created")
      setOpen(false)
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        const detail = (error.body as { detail?: string })?.detail
        if (detail === SERIES_HAS_LINKS_DETAIL) {
          showErrorToast(
            "This competition already has quizzes or events, so its type can't change",
          )
          return
        }
        setError("slug", {
          type: "server",
          message: detail || "Slug is already in use",
        })
        return
      }
      showErrorToast(
        isEdit
          ? "Failed to update competition"
          : "Failed to create competition",
      )
    },
  })

  const handleOpenChange = (v: boolean) => {
    setOpen(v)
    if (v) reset(defaultValues)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Competition" : "New Competition"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) => mutation.mutate(data))}
          className="flex flex-col gap-4 pt-2"
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name")} />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Description</Label>
            <textarea
              {...register("description")}
              rows={2}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Type</Label>
            <div className="flex w-fit rounded-md border overflow-hidden">
              {SERIES_TYPES.map(([value, label, testId]) => (
                <button
                  key={value}
                  type="button"
                  data-testid={testId}
                  aria-pressed={seriesType === value}
                  onClick={() => setValue("type", value)}
                  className={`px-4 py-1.5 text-sm ${seriesType === value ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {seriesType === "event"
                ? "Recurs as events, like a yearly national championship weekend."
                : "Recurs as a single quiz, like a yearly world championship."}
            </p>
          </div>

          {isEdit && (
            <div className="grid gap-1.5">
              <Label>Slug</Label>
              <Input {...register("slug")} />
              {errors.slug && (
                <p className="text-sm text-destructive">
                  {errors.slug.message}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>Organization</Label>
            <select
              {...register("organization_id")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">— none —</option>
              {orgs?.data.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {errors.organization_id && (
              <p className="text-sm text-destructive">
                {errors.organization_id.message}
              </p>
            )}
          </div>

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save"
                : "Create"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
