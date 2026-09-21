import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Suspense } from "react"

import { CompetitionsService, UsersService } from "@/client"
import { UploadWizard } from "@/components/Upload/UploadWizard"

type UploadSearch = {
  competition?: string
}

export const Route = createFileRoute("/_layout/upload")({
  component: UploadPage,
  validateSearch: (search: Record<string, unknown>): UploadSearch => ({
    competition:
      typeof search.competition === "string" ? search.competition : undefined,
  }),
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser && !user.is_organizer) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({ meta: [{ title: "Upload Results" }] }),
})

/**
 * Resolves ?competition=<slug> before the wizard mounts. The wizard seeds its
 * state once, in a lazy initialiser, so the competition has to be in hand at
 * mount — hence Suspense here rather than a plain useQuery inside the wizard.
 */
function PrefilledWizard({ slug }: { slug: string }) {
  const { data: competition } = useSuspenseQuery({
    queryFn: () => CompetitionsService.readCompetition({ id: slug }),
    queryKey: ["competitions", slug],
  })
  return <UploadWizard prefillCompetition={competition} />
}

function UploadPage() {
  const { competition } = Route.useSearch()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload Results</h1>
        <p className="text-muted-foreground">
          Submit quiz competition results for review
        </p>
      </div>
      {competition ? (
        <Suspense
          fallback={
            <div className="animate-pulse h-40 w-full rounded bg-muted" />
          }
        >
          <PrefilledWizard slug={competition} />
        </Suspense>
      ) : (
        <UploadWizard />
      )}
    </div>
  )
}
