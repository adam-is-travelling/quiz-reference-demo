import { COUNTRIES } from "@/lib/countries"

interface CountrySelectProps {
  value: string | null | undefined
  onChange: (code: string | null) => void
  className?: string
}

export function CountrySelect({ value, onChange, className }: CountrySelectProps) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={
        className ??
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      <option value="">— Unknown —</option>
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
