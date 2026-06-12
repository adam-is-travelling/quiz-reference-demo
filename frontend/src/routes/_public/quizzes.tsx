import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { CalendarDays } from "lucide-react"
import { Suspense } from "react"

import { QuizzesService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { eventColumns } from "@/components/Events/columns"

function getQuizzesQueryOptions() {
  return {
    queryFn: () => QuizzesService.readQuizzes({ skip: 0, limit: 100 }),
    queryKey: ["quizzes"],
  }
}

export const Route = createFileRoute("/_public/quizzes")({
  component: QuizzesPage,
  head: () => ({ meta: [{ title: "Quizzes" }] }),
})

function QuizzesContent() {
  const { data: quizzes } = useSuspenseQuery(getQuizzesQueryOptions())

  if (quizzes.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16">
        <div className="rounded-full bg-muted p-4 mb-4">
          <CalendarDays className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No quizzes yet</h3>
        <p className="text-muted-foreground">
          Published results will appear here.
        </p>
      </div>
    )
  }

  return <DataTable columns={eventColumns} data={quizzes.data} />
}

function QuizzesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Quizzes</h1>
        <p className="text-muted-foreground">
          Browse published quiz competition results
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <QuizzesContent />
      </Suspense>
    </div>
  )
}
