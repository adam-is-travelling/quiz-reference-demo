import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"

import { Button } from "@/components/ui/button"

interface TablePagerProps {
  /** 1-based. */
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  /** Distinguishes the pagers when a page carries more than one. */
  label: string
}

/**
 * Page N of M plus first/previous/next/last controls.
 *
 * Mirrors the pager on the players page so paginated tables look the same
 * throughout; that one is still wired directly to its TanStack Table instance
 * and has not been moved onto this component.
 */
export function TablePager({
  page,
  pageCount,
  onPageChange,
  label,
}: TablePagerProps) {
  const canPrevious = page > 1
  const canNext = page < pageCount

  return (
    <div className="flex items-center justify-between gap-4 p-4 border-t bg-muted/20">
      <div className="flex items-center gap-x-1 text-sm text-muted-foreground">
        <span>Page</span>
        <span className="font-medium text-foreground">{page}</span>
        <span>of</span>
        <span className="font-medium text-foreground">{pageCount}</span>
      </div>
      <div className="flex items-center gap-x-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onPageChange(1)}
          disabled={!canPrevious}
        >
          <span className="sr-only">{`${label}: go to first page`}</span>
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrevious}
        >
          <span className="sr-only">{`${label}: go to previous page`}</span>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
        >
          <span className="sr-only">{`${label}: go to next page`}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onPageChange(pageCount)}
          disabled={!canNext}
        >
          <span className="sr-only">{`${label}: go to last page`}</span>
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
