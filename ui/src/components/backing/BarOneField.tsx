import { useState, type ReactNode } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { parseBarOne, stepBarOne } from "@/lib/backing"
import { formatBarOne } from "@/lib/format"

/**
 * Bar 1 at, on a song page's backing-track line (spec Part 6): where bar 1
 * is in the file, "0:00.80", with − and + a hundredth of a second either
 * side, as TempoField has them. It can be typed, as minutes and seconds or
 * seconds alone: Enter or leaving the field takes it, and anything that is
 * not a time puts back what it had. ↑ and ↓ in the field step it too, a
 * tenth with Shift.
 *
 * `onChange` gets each new place at once, held from the file's start to
 * its end (`length`, null when that is not known); the field shows `value`
 * the moment it is not being typed in.
 */
export function BarOneField({
  value,
  length,
  onChange,
}: {
  value: number
  length: number | null
  onChange: (seconds: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const put = (seconds: number) => {
    const held = stepBarOne(seconds, 0, length)
    if (held !== value) onChange(held)
  }
  const commit = () => {
    if (draft === null) return
    const typed = parseBarOne(draft)
    setDraft(null)
    if (typed !== null) put(typed)
  }
  const nudge = (by: number) => put(stepBarOne(value, by, length))
  const step = (label: string, tip: string, by: number, icon: ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-tiny" aria-label={label} onClick={() => nudge(by)}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span aria-hidden>{tip}</span>
      </TooltipContent>
    </Tooltip>
  )

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <span aria-hidden className="mr-1 text-sm text-muted-foreground">
        Bar 1 at
      </span>
      {step("Bar 1 earlier", "A hundredth of a second earlier", -0.01, <Minus />)}
      <Input
        aria-label="Bar 1 at"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={draft ?? formatBarOne(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            setDraft(null)
            nudge((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01))
          }
        }}
        className="tnum h-8 w-[4.75rem] px-1 text-center font-semibold"
      />
      {step("Bar 1 later", "A hundredth of a second later", 0.01, <Plus />)}
    </div>
  )
}
