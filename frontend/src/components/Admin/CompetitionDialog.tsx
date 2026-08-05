import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import type { CompetitionPublic } from "@/client"
import { ApiError, CompetitionsService, OrganizationsService } from "@/client"
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

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  organization_id: z.string().min(1, "Organization is required"),
  slug: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  competition?: CompetitionPublic
  trigger: React.ReactNode
}

export function CompetitionDialog({ competition, trigger }: Props) {
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
  }

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      if (isEdit) {
        return CompetitionsService.updateCompetition({
          id: competition.id,
          requestBody: {
            name: data.name,
            description: data.description || null,
            organization_id: data.organization_id,
            slug: data.slug || null,
          },
        })
      }
      return CompetitionsService.createCompetition({
        requestBody: {
          name: data.name,
          description: data.description || null,
          organization_id: data.organization_id,
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
              <option value="" disabled>
                — choose an organization —
              </option>
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
