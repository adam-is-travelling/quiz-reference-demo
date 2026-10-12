import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { HelpCircle, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { useFieldArray, useForm } from "react-hook-form"
import { z } from "zod"
import type { QuizFormatPublic } from "@/client"
import { FormatsService } from "@/client"
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import useCustomToast from "@/hooks/useCustomToast"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  rounds: z
    .array(
      z.object({
        value: z.string().min(1, "Round name cannot be empty"),
        short: z.string().trim().max(4, "Short names are at most 4 characters"),
      }),
    )
    .min(1, "At least one round is required")
    .max(20, "Maximum 20 rounds allowed"),
  per_round_stats_eligible: z.boolean(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  format?: QuizFormatPublic
  trigger: React.ReactNode
}

export function FormatDialog({ format, trigger }: Props) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const isEdit = format !== undefined

  const defaultValues: FormValues = {
    name: format?.name ?? "",
    description: format?.description ?? "",
    rounds:
      format?.rounds && format.rounds.length > 0
        ? format.rounds.map((r, i) => ({
            value: r,
            short: format.round_abbreviations?.[i] ?? "",
          }))
        : [{ value: "", short: "" }],
    per_round_stats_eligible: format?.per_round_stats_eligible ?? false,
  }

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: "rounds",
  })

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      const rounds = data.rounds.map((r) => r.value)
      // Blank means "no short name"; the header falls back to the full name.
      const round_abbreviations = data.rounds.map((r) => r.short || null)
      if (isEdit) {
        return FormatsService.updateFormat({
          id: format.id,
          requestBody: {
            name: data.name,
            description: data.description || null,
            rounds,
            round_abbreviations,
            per_round_stats_eligible: data.per_round_stats_eligible,
          },
        })
      }
      return FormatsService.createFormat({
        requestBody: {
          name: data.name,
          description: data.description || undefined,
          rounds,
          round_abbreviations,
          per_round_stats_eligible: data.per_round_stats_eligible,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formats"] })
      showSuccessToast(isEdit ? "Format updated" : "Format created")
      setOpen(false)
    },
    onError: () =>
      showErrorToast(
        isEdit ? "Failed to update format" : "Failed to create format",
      ),
  })

  const handleOpenChange = (v: boolean) => {
    setOpen(v)
    if (v) {
      reset(defaultValues)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Format" : "New Format"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) => mutation.mutate(data))}
          className="flex flex-col gap-4 pt-2"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="format-name">Name</Label>
            <Input id="format-name" {...register("name")} />
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
            <div className="flex items-center justify-between">
              <Label>Rounds</Label>
              <span className="text-xs text-muted-foreground ml-auto mr-3">
                Short name (optional, ≤4)
              </span>
              <span className="text-xs text-muted-foreground">
                {fields.length}/20
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {fields.map((field, index) => (
                <div key={field.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground w-5 shrink-0 text-right">
                      {index + 1}.
                    </span>
                    <Input
                      {...register(`rounds.${index}.value`)}
                      placeholder={`Round ${index + 1}`}
                      className="flex-1"
                    />
                    {/* Shown in results-table headers, where a long category
                      name would overflow. */}
                    <Input
                      {...register(`rounds.${index}.short`)}
                      aria-label={`Abbreviation for round ${index + 1}`}
                      placeholder="Abbr"
                      maxLength={4}
                      className="w-16 shrink-0"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(index)}
                      disabled={fields.length === 1}
                      className="shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {errors.rounds?.[index]?.short && (
                    <p className="text-sm text-destructive ml-7">
                      {errors.rounds[index].short.message}
                    </p>
                  )}
                </div>
              ))}
              {errors.rounds && !Array.isArray(errors.rounds) && (
                <p className="text-sm text-destructive">
                  {errors.rounds.message}
                </p>
              )}
            </div>
            {fields.length < 20 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ value: "", short: "" })}
                className="mt-1"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Round
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              id="per-round-stats"
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              {...register("per_round_stats_eligible")}
            />
            <Label htmlFor="per-round-stats" className="cursor-pointer">
              Rounds represent categories with individual champions
            </Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="More information"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Select this option if each round is meant to represent a
                particular category of question, for which the top three are
                recognized. If the quiz is just a set of different rounds (i.e.
                Round 1, Round 2, etc), this option is less useful and could be
                confusing
              </TooltipContent>
            </Tooltip>
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
