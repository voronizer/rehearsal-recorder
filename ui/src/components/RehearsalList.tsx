import { EveningStrip } from "@/components/EveningStrip"
import { cn } from "@/lib/utils"
import { formatDuration, formatMonth, formatWhen, takesLabel } from "@/lib/format"
import type { RehearsalSummary } from "@/lib/api"

/**
 * History's list, down the left of the screen with the chosen rehearsal
 * beside it: a month at a time, each rehearsal as its name, when, how long
 * and the evening drawn small.
 *
 * It used to be the whole screen, a row per rehearsal with its songs spelled
 * out — "Polyn ×4 · Vesna ×3 · and 2 more" — and a click away from anything
 * else. The strip says the same at a glance, and the rehearsal it opens is
 * already on screen next to it.
 */
export function RehearsalList({
  rehearsals,
  current,
  onChoose,
}: {
  rehearsals: RehearsalSummary[]
  current: string | null
  onChoose: (folder: string) => void
}) {
  const months: { title: string; items: RehearsalSummary[] }[] = []
  for (const r of rehearsals) {
    const title = formatMonth(r.created_at)
    const last = months[months.length - 1]
    if (last?.title === title) last.items.push(r)
    else months.push({ title, items: [r] })
  }

  return (
    <div className="flex flex-col gap-4">
      {months.map((month) => (
        <div
          key={month.title}
          role="group"
          aria-label={month.title}
          className="flex flex-col gap-1"
        >
          <h2 className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {month.title}
          </h2>
          {month.items.map((r) => (
            <Item
              key={r.folder}
              rehearsal={r}
              current={r.folder === current}
              onChoose={onChoose}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function Item({
  rehearsal: r,
  current,
  onChoose,
}: {
  rehearsal: RehearsalSummary
  current: boolean
  onChoose: (folder: string) => void
}) {
  return (
    <button
      type="button"
      data-rehearsal={r.folder}
      aria-current={current ? "true" : undefined}
      onClick={() => onChoose(r.folder)}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-transparent px-3 pt-2.5 pb-3 text-left transition-colors",
        "hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        current && "border-border bg-accent hover:bg-accent"
      )}
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
        {/* Under half a minute there is no honest number of minutes. */}
        {r.total_duration_sec >= 30 && (
          <span className="tnum shrink-0 text-xs text-muted-foreground">
            {formatDuration(r.total_duration_sec / 60)}
          </span>
        )}
      </span>
      <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{formatWhen(r.created_at)}</span>
        <span className={cn("shrink-0", r.missing && "text-destructive")}>
          {r.missing ? "Not found on disk" : takesLabel(r.take_count)}
        </span>
      </span>
      {!r.missing && <EveningStrip runs={r.runs ?? []} />}
    </button>
  )
}
