import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { CompetitionsService, OrganizationsService } from "@/client"

function getOrgQueryOptions(id: string) {
  return {
    queryFn: () => OrganizationsService.readOrganization({ id }),
    queryKey: ["organizations", id],
  }
}

function getCompetitionsQueryOptions() {
  return {
    queryFn: () =>
      CompetitionsService.readCompetitions({ skip: 0, limit: 100 }),
    queryKey: ["competitions"],
  }
}

export const Route = createFileRoute("/_public/organizations_/$id")({
  component: OrgDetailPage,
})

function OrgDetail({ id }: { id: string }) {
  const { data: org } = useSuspenseQuery(getOrgQueryOptions(id))
  const { data: allCompetitions } = useSuspenseQuery(
    getCompetitionsQueryOptions(),
  )
  const orgCompetitions = allCompetitions.data.filter(
    (s) => s.organization_id === id,
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
        {org.website && (
          <a
            href={org.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:underline"
          >
            {org.website}
          </a>
        )}
        {org.description && (
          <p className="mt-2 text-muted-foreground">{org.description}</p>
        )}
      </div>

      {orgCompetitions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Competitions</h2>
          <ul className="flex flex-col gap-2">
            {orgCompetitions.map((s) => (
              <li key={s.id}>
                <Link
                  to="/competitions/$id"
                  params={{ id: s.id }}
                  className="text-sm font-medium hover:underline"
                >
                  {s.name}
                </Link>
                {s.description && (
                  <p className="text-xs text-muted-foreground">
                    {s.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function OrgDetailPage() {
  const { id } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <OrgDetail id={id} />
    </Suspense>
  )
}
