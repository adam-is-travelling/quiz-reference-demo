import { Briefcase, FolderOpen } from "lucide-react"
import { Labels } from "@/test-ids"
import type { WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

export function Step0ModeSelect({ update }: Props) {
  const select = (mode: "new" | "existing") => {
    update({ quizMode: mode, step: 1 })
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Are you uploading results for a new quiz, or adding to one that already
        exists?
      </p>
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          data-testid={Labels.uploadModeNew}
          onClick={() => select("new")}
          className="flex flex-col items-center gap-3 rounded-lg border-2 border-muted p-6 text-center hover:border-primary hover:bg-muted/50 transition-colors"
        >
          <Briefcase className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-semibold">New quiz</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create a new quiz and upload results
            </p>
          </div>
        </button>
        <button
          type="button"
          data-testid={Labels.uploadModeExisting}
          onClick={() => select("existing")}
          className="flex flex-col items-center gap-3 rounded-lg border-2 border-muted p-6 text-center hover:border-primary hover:bg-muted/50 transition-colors"
        >
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-semibold">Existing quiz</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add or replace results for a quiz already in the system
            </p>
          </div>
        </button>
      </div>
    </div>
  )
}
