import { useState } from "react"
import { Step1EventMeta } from "./steps/Step1EventMeta"
import { Step2CsvInput } from "./steps/Step2CsvInput"
import { Step3ColumnMapping } from "./steps/Step3ColumnMapping"
import { Step4Disambiguation } from "./steps/Step4Disambiguation"
import { Step5Preview } from "./steps/Step5Preview"
import { INITIAL_STATE, type WizardState } from "./types"

const STEP_LABELS = [
  "Event details",
  "Results data",
  "Column mapping",
  "Match players",
  "Review & submit",
]

export function UploadWizard() {
  const [state, setState] = useState<WizardState>(INITIAL_STATE)

  const update = (patch: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...patch }))

  return (
    <div className="flex flex-col gap-6">
      {/* Step indicator */}
      <ol className="flex gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1
          const active = n === state.step
          const done = n < state.step
          return (
            <li
              key={label}
              className={`flex items-center gap-1.5 text-sm ${
                active
                  ? "font-semibold text-foreground"
                  : done
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  done
                    ? "bg-primary text-primary-foreground"
                    : active
                      ? "border-2 border-primary text-primary"
                      : "border border-muted-foreground/30"
                }`}
              >
                {done ? "✓" : n}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </li>
          )
        })}
      </ol>

      {/* Active step */}
      {state.step === 1 && <Step1EventMeta state={state} update={update} />}
      {state.step === 2 && <Step2CsvInput state={state} update={update} />}
      {state.step === 3 && <Step3ColumnMapping state={state} update={update} />}
      {state.step === 4 && (
        <Step4Disambiguation state={state} update={update} />
      )}
      {state.step === 5 && <Step5Preview state={state} update={update} />}
    </div>
  )
}
