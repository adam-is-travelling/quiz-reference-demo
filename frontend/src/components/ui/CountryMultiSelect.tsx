import { COUNTRIES, countryName } from "@/lib/countries"

interface CountryMultiSelectProps {
  value: string[]
  onChange: (codes: string[]) => void
}

export function CountryMultiSelect({ value, onChange }: CountryMultiSelectProps) {
  const available = COUNTRIES.filter((c) => !value.includes(c.code))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">
            No countries added
          </span>
        )}
        {value.map((code, i) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          >
            {i === 0 ? (
              <span className="text-amber-500" title="Primary">
                ★
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Make ${countryName(code)} primary`}
                title="Make primary"
                onClick={() =>
                  onChange([code, ...value.filter((c) => c !== code)])
                }
                className="text-muted-foreground hover:text-amber-500"
              >
                ☆
              </button>
            )}
            {countryName(code)}
            <button
              type="button"
              aria-label={`Remove ${countryName(code)}`}
              onClick={() => onChange(value.filter((c) => c !== code))}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <select
        value=""
        aria-label="Add country"
        onChange={(e) => {
          if (e.target.value) onChange([...value, e.target.value])
        }}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">+ Add country…</option>
        {available.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}
