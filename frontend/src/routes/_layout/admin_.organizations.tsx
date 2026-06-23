import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense } from "react"
import type { OrganizationPublic } from "@/client"
import { OrganizationsService } from "@/client"
import { OrganizationDialog } from "@/components/Admin/OrganizationDialog"
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

export const Route = createFileRoute("/_layout/admin_/organizations")({
  component: AdminOrganizations,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Organizations - Admin" }],
  }),
})

function OrgRow({ org }: { org: OrganizationPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => OrganizationsService.deleteOrganization({ id: org.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] })
      showSuccessToast("Organization deleted")
    },
    onError: () => showErrorToast("Failed to delete organization"),
  })

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">{org.name}</td>
      <td className="py-3 px-4 text-muted-foreground">
        {org.description ?? "—"}
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        {org.website ? (
          <a
            href={org.website}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {org.website}
          </a>
        ) : (
          "—"
        )}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <OrganizationDialog
            org={org}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete organization?</AlertDialogTitle>
                <AlertDialogDescription>
                  Deleting "{org.name}" will remove it from any associated
                  quizzes. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </td>
    </tr>
  )
}

function OrgsTableContent() {
  const { data } = useSuspenseQuery({
    queryKey: ["organizations"],
    queryFn: () =>
      OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
  })

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        No organizations yet. Create one to get started.
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
            <th className="py-3 px-4 text-left text-sm font-medium">
              Website
            </th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((org) => (
            <OrgRow key={org.id} org={org} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminOrganizations() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
          <p className="text-muted-foreground">
            Manage quiz governing bodies and associations.
          </p>
        </div>
        <OrganizationDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              New Organization
            </Button>
          }
        />
      </div>

      <Suspense
        fallback={
          <div className="animate-pulse h-40 w-full rounded bg-muted" />
        }
      >
        <OrgsTableContent />
      </Suspense>
    </div>
  )
}
