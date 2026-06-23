import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import type { OrganizationPublic } from "@/client"
import { OrganizationsService } from "@/client"
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
  website: z.string().optional(),
  logo_url: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  org?: OrganizationPublic
  trigger: React.ReactNode
}

export function OrganizationDialog({ org, trigger }: Props) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const isEdit = org !== undefined

  const defaultValues: FormValues = {
    name: org?.name ?? "",
    description: org?.description ?? "",
    website: org?.website ?? "",
    logo_url: org?.logo_url ?? "",
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
      if (isEdit) {
        return OrganizationsService.updateOrganization({
          id: org.id,
          requestBody: {
            name: data.name,
            description: data.description || null,
            website: data.website || null,
            logo_url: data.logo_url || null,
          },
        })
      }
      return OrganizationsService.createOrganization({
        requestBody: {
          name: data.name,
          description: data.description || null,
          website: data.website || null,
          logo_url: data.logo_url || null,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] })
      showSuccessToast(isEdit ? "Organization updated" : "Organization created")
      setOpen(false)
    },
    onError: () =>
      showErrorToast(
        isEdit ? "Failed to update organization" : "Failed to create organization",
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
          <DialogTitle>
            {isEdit ? "Edit Organization" : "New Organization"}
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
            <Label>Website</Label>
            <Input {...register("website")} placeholder="https://..." />
          </div>

          <div className="grid gap-1.5">
            <Label>Logo URL</Label>
            <Input {...register("logo_url")} placeholder="https://..." />
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
