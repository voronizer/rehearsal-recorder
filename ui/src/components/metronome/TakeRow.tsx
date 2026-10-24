import type { ReactNode } from "react"
import { BeatDots } from "@/components/metronome/BeatDots"
import { ClickSwitch } from "@/components/metronome/ClickSwitch"
import { TempoUnit } from "@/components/metronome/NoteGlyph"
import { StatusLine } from "@/components/metronome/StatusLine"
import type { MetronomeState } from "@/lib/api"
import { statusLine } from "@/lib/metronome"
import { cn } from "@/lib/utils"

/**
 * The metronome's row while a take records, where it was on the rehearsal
 * screen, at the footer's far left (q14, «Слева, как было»): the switch,
 * the take's tempo and signature, the beat, and a line that says what the
 * click is doing (spec Part 5). The tempo cannot change mid-take, so there
 * is no field, no Tap and no gear; the switch silences the click and the
 * tempo still goes into the take. A take with no click has nothing to
 * switch, and no beat. `below` is the backing track's row while the take
 * records, over the line, as on the rehearsal screen.
 */
export function TakeRow({
  state,
  lit,
  onSwitch,
  below,
}: {
  state: MetronomeState
  /** The click lit now, by its place in the bar, or null. */
  lit: number | null
  onSwitch: (on: boolean) => void
  below?: ReactNode
}) {
  // A take that began with the switch off has no count-in to click from;
  // one whose first click Python has not chosen yet is counting in.
  const clicks = state.tempo !== null && (state.since_count_in_ms !== null || state.phase === "count")
  const heard = clicks && state.on
  return (
    <section aria-label="Metronome" className="flex flex-col gap-1.5">
      <div data-take-reading className="flex h-8 items-center gap-3 text-sm">
        <ClickSwitch on={heard} onChange={onSwitch} disabled={!clicks} />
        {state.tempo !== null && (
          <>
            <span
              data-take-tempo
              className={cn("tnum font-semibold whitespace-nowrap", !heard && "text-muted-foreground")}
            >
              {state.tempo}{" "}
              <TempoUnit signature={state.signature} className="font-normal" />
            </span>
            <span
              data-take-signature
              className={cn("tnum whitespace-nowrap", !heard && "text-muted-foreground")}
            >
              {state.signature}
            </span>
            <BeatDots signature={state.signature} lit={heard ? lit : null} />
          </>
        )}
      </div>
      {below}
      <StatusLine line={statusLine(state)} />
    </section>
  )
}
