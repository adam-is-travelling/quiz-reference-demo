import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { SeriesService } from "@/client"

function getSeriesQueryOptions() {
  return {
    queryFn: () => SeriesService.readSeries({ skip: 0, limit: 100 }),
    queryKey: ["series"],
  }
}

export const Route = createFileRoute("/_public/series")({
  component: SeriesPage,
  head: () => ({ meta: [{ title: "Series" }] }),
})

function SeriesListContent() {
  const { data } = useSuspenseQuery(getSeriesQueryOptions())

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground py-4">No series published yet.</p>
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
          {data.data.map((series) => (
            <tr
              key={series.id}
              className="border-b hover:bg-muted/50 transition-colors"
            >
              <td className="py-3 px-4">
                <Link
                  to="/series/$id"
                  params={{ id: series.id }}
                  className="font-medium hover:underline"
                >
                  {series.name}
                </Link>
              </td>
              <td className="py-3 px-4 text-muted-foreground">
                {series.description ?? "—"}
              </td>
              <td className="py-3 px-4 text-muted-foreground">
                {series.organization_name ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SeriesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Series</h1>
        <p className="text-muted-foreground">Quiz series and tournaments</p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <SeriesListContent />
      </Suspense>
    </div>
  )
}
