import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense } from "react"
import type { QuizFormatPublic } from "@/client"
import { FormatsService } from "@/client"
import { FormatDialog } from "@/components/Admin/FormatDialog"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"

export const Route = createFileRoute("/_layout/admin_/formats")({
  component: AdminFormats,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Formats - Admin" }],
  }),
})

function FormatRow({ format }: { format: QuizFormatPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => FormatsService.deleteFormat({ id: format.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formats"] })
      showSuccessToast("Format deleted")
    },
    onError: (error: unknown) => {
      const status =
        error instanceof Error && "status" in error
          ? (error as { status: number }).status
          : undefined
      if (status === 409) {
        showErrorToast("Format is in use")
      } else {
        showErrorToast("Failed to delete format")
      }
    },
  })

  const roundCount = format.rounds?.length ?? 0

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">{format.name}</td>
      <td className="py-3 px-4 text-muted-foreground">
        {format.description ?? "—"}
      </td>
      <td className="py-3 px-4">
        {roundCount === 1 ? "1 round" : `${roundCount} rounds`}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <FormatDialog
            format={format}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm(`Delete format "${format.name}"?`)) {
                deleteMutation.mutate()
              }
            }}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function FormatsTableContent() {
  const { data } = useSuspenseQuery({
    queryKey: ["formats"],
    queryFn: () => FormatsService.readFormats({ skip: 0, limit: 100 }),
  })

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        No formats yet. Create one to get started.
      </p>
    )
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Name</th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Description
            </th>
            <th className="py-3 px-4 text-left text-sm font-medium">Rounds</th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((format) => (
            <FormatRow key={format.id} format={format} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminFormats() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Formats</h1>
          <p className="text-muted-foreground">
            Manage quiz format templates with round definitions.
          </p>
        </div>
        <FormatDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              New Format
            </Button>
          }
        />
      </div>

      <Suspense
        fallback={
          <div className="animate-pulse h-40 w-full rounded bg-muted" />
        }
      >
        <FormatsTableContent />
      </Suspense>
    </div>
  )
}
