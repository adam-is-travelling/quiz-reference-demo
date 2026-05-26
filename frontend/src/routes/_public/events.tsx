import { createFileRoute } from "@tanstack/react-router"

// Placeholder route – full implementation added in Task 9
export const Route = createFileRoute("/_public/events")({
  component: EventsPage,
})

function EventsPage() {
  return <div>Events</div>
}
