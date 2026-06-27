import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import type { QuizSeriesPublic } from "@/client"
import { OrganizationsService, SeriesService } from "@/client"
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
  organization_id: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  series?: QuizSeriesPublic
  trigger: React.ReactNode
}

export function SeriesDialog({ series, trigger }: Props) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const isEdit = series !== undefined

  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
  })

  const defaultValues: FormValues = {
    name: series?.name ?? "",
    description: series?.description ?? "",
    organization_id: series?.organization_id ?? "",
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      const organization_id = data.organization_id || null
      if (isEdit) {
        return SeriesService.updateSeries({
          id: series.id,
          requestBody: {
            name: data.name,
            description: data.description || null,
            organization_id,
          },
        })
      }
      return SeriesService.createSeries({
        requestBody: {
          name: data.name,
          description: data.description || null,
          organization_id,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["series"] })
      showSuccessToast(isEdit ? "Series updated" : "Series created")
      setOpen(false)
    },
    onError: () =>
      showErrorToast(
        isEdit ? "Failed to update series" : "Failed to create series",
      ),
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
          <DialogTitle>{isEdit ? "Edit Series" : "New Series"}</DialogTitle>
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
            <Label>Organization</Label>
            <select
              {...register("organization_id")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">None</option>
              {orgs?.data.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
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
