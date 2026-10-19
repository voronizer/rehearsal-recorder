import { useState, type ReactNode } from "react"
import { Minus, Plus } from "lucide-react"
import { TempoUnit } from "@/components/metronome/NoteGlyph"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Signature } from "@/lib/api"
import { clampTempo, parseTempo, tempoRange } from "@/lib/metronome"

/**
 * The tempo: a number field with − and + on either side and its unit
 * after it (spec Part 4). What is typed counts on Enter or on leaving the
 * field: a number is rounded into the signature's range, empty means no
 * tempo, and anything else puts the last one back. ↑ and ↓ in the field
 * and − and + go a click a minute at a time.
 *
 * `onChange` gets each new tempo; the field shows `tempo`, what Python
 * holds, the moment it is not being typed in.
 */
export function TempoField({
  tempo,
  signature,
  onChange,
  disabled = false,
}: {
  tempo: number | null
  signature: Signature
  onChange: (tempo: number | null) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const { min, max } = tempoRange(signature)

  const commit = () => {
    if (draft === null) return
    const next = parseTempo(draft, signature, tempo)
    setDraft(null)
    if (next !== tempo) onChange(next)
  }
  const nudge = (by: number) => {
    if (tempo === null) return
    const next = clampTempo(tempo + by, signature)
    if (next !== tempo) onChange(next)
  }
  const step = (label: string, by: number, icon: ReactNode, off: boolean) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-tiny"
          aria-label={label}
          disabled={disabled || off}
          onClick={() => nudge(by)}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span aria-hidden>{label}</span>
      </TooltipContent>
    </Tooltip>
  )

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {step("Slower", -1, <Minus />, tempo === null || tempo <= min)}
      <Input
        aria-label="Tempo"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft ?? (tempo === null ? "" : String(tempo))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            // Leaving the field counts what was typed, and the keys go back
            // to the screen: Space records.
            e.currentTarget.blur()
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            setDraft(null)
            nudge(e.key === "ArrowUp" ? 1 : -1)
          }
        }}
        className="tnum h-8 w-10 px-1 text-center font-semibold"
      />
      {step("Faster", 1, <Plus />, tempo === null || tempo >= max)}
      <TempoUnit signature={signature} className="ml-1 text-sm" />
    </div>
  )
}
