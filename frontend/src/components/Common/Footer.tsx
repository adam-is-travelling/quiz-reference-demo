import useAuth from "@/hooks/useAuth"

export function Footer() {
  const currentYear = new Date().getFullYear()
  const { user } = useAuth()
  const showDbTarget = Boolean(user?.is_superuser && user.db_target)

  return (
    <footer className="border-t py-4 px-6">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <p className="text-muted-foreground text-sm">
            quiz-reference - {currentYear}
          </p>
          {showDbTarget && (
            <p
              data-testid="footer-db-target"
              className="text-muted-foreground text-sm"
            >
              Database: {user?.db_target}
            </p>
          )}
        </div>
      </div>
    </footer>
  )
}
