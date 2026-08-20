export function formatDateRange(start: string, end: string): string {
  return start === end ? start : `${start} – ${end}`
}
