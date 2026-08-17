import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { CompetitionsService } from "@/client"

function getCompetitionsQueryOptions() {
  return {
    queryFn: () =>
      CompetitionsService.readCompetitions({ skip: 0, limit: 100 }),
    queryKey: ["competitions"],
  }
}

export const Route = createFileRoute("/_public/competitions")({
  component: CompetitionsPage,
  head: () => ({ meta: [{ title: "Competitions" }] }),
})

function CompetitionListContent() {
  const { data } = useSuspenseQuery(getCompetitionsQueryOptions())

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground py-4">
        No competitions published yet.
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
              Organization
            </th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((competition) => (
            <tr
              key={competition.id}
              className="border-b hover:bg-muted/50 transition-colors"
            >
              <td className="py-3 px-4">
                <Link
                  to="/competitions/$slug"
                  params={{ slug: competition.slug }}
                  className="font-medium hover:underline"
                >
                  {competition.name}
                </Link>
              </td>
              <td className="py-3 px-4 text-muted-foreground">
                {competition.description ?? "—"}
              </td>
              <td className="py-3 px-4 text-muted-foreground">
                {competition.organization_name ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CompetitionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Competitions</h1>
        <p className="text-muted-foreground">
          Quiz competitions and tournaments
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <CompetitionListContent />
      </Suspense>
    </div>
  )
}
