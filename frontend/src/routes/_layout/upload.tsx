import { createFileRoute, redirect } from "@tanstack/react-router"

import { UsersService } from "@/client"
import { UploadWizard } from "@/components/Upload/UploadWizard"

export const Route = createFileRoute("/_layout/upload")({
  component: UploadPage,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser && !user.is_organizer) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({ meta: [{ title: "Upload Results" }] }),
})

function UploadPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload Results</h1>
        <p className="text-muted-foreground">
          Submit quiz competition results for review
        </p>
      </div>
      <UploadWizard />
    </div>
  )
}
