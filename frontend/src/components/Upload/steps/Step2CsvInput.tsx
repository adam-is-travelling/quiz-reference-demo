import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

function parseCsv(raw: string): string[][] {
  return raw
    .trim()
    .split("\n")
    .map((line) => line.split(/,|\t/).map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0))
}

export function Step2CsvInput({ state, update }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      update({ rawCsv: text })
      if (textareaRef.current) textareaRef.current.value = text
    }
    reader.readAsText(file)
  }

  const handleNext = () => {
    const raw = textareaRef.current?.value ?? state.rawCsv
    const parsedRows = parseCsv(raw)
    if (parsedRows.length === 0) return
    update({ rawCsv: raw, parsedRows, step: 3 })
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <div className="grid gap-1.5">
        <Label htmlFor="csv-file">Upload CSV or TSV file</Label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,.tsv,.txt"
          onChange={handleFile}
          className="text-sm"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="csv-paste">Or paste data directly</Label>
        <textarea
          id="csv-paste"
          ref={textareaRef}
          defaultValue={state.rawCsv}
          rows={12}
          placeholder={
            "Name,Country,Score,Tiebreaker\nEvan Lynch,Ireland,42,1\n…"
          }
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 1 })}>
          ← Back
        </Button>
        <Button onClick={handleNext}>Next →</Button>
      </div>
    </div>
  )
}
