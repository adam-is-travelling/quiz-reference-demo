import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { CompetitionsService, OrganizationsService } from "@/client"

function getOrgQueryOptions(slug: string) {
  return {
    queryFn: () => OrganizationsService.readOrganization({ id: slug }),
    queryKey: ["organizations", slug],
  }
}

function getCompetitionsQueryOptions() {
  return {
    queryFn: () =>
      CompetitionsService.readCompetitions({ skip: 0, limit: 100 }),
    queryKey: ["competitions"],
  }
}

export const Route = createFileRoute("/_public/organizations_/$slug")({
  component: OrgDetailPage,
})

function OrgDetail({ slug }: { slug: string }) {
  const { data: org } = useSuspenseQuery(getOrgQueryOptions(slug))
  const { data: allCompetitions } = useSuspenseQuery(
    getCompetitionsQueryOptions(),
  )
  const orgCompetitions = allCompetitions.data.filter(
    (s) => s.organization_id === org.id,
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
                  to="/competitions/$slug"
                  params={{ slug: s.slug }}
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
  const { slug } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <OrgDetail slug={slug} />
    </Suspense>
  )
}
