import { cn } from "@/lib/utils"
import { formatMMSS, takesLabel } from "@/lib/format"
import { MARKER_KINDS, markerStyle } from "@/lib/markers"
import type { Marker, Song, Take } from "@/lib/api"

/**
 * What an open rehearsal shows before a take is picked.
 *
 * It used to be one line — "Pick a take to listen back to it" — under the
 * strip, with the rest of the window empty. Everything needed to say more is
 * already there: which songs were played and how many goes each got (from
 * the take names, grouped by Python — `songs` — so there is one rule and not
 * two), how long each go was, and every note left while listening. The notes
 * are usually why the rehearsal was opened again at all: "this one is the
 * take", "guitar drifts here". Each take opens from here, and each note opens
 * its take at the spot it was left.
 */
export function RehearsalOverview({
  takes,
  songs,
  onOpen,
  onOpenAt,
}: {
  takes: Take[]
  songs: Song[]
  onOpen: (take: Take) => void
  onOpenAt: (take: Take, at: number) => void
}) {
  const byNumber = new Map(takes.map((t) => [t.take_number, t]))
  const rows = songs
    .map((s) => ({
      name: s.name,
      takes: (s.take_numbers ?? [])
        .map((n) => byNumber.get(n))
        .filter((t): t is Take => t !== undefined),
    }))
    .filter((r) => r.takes.length > 0)
  const grouped = new Set(rows.flatMap((r) => r.takes.map((t) => t.take_number)))
  const unnamed = takes.filter((t) => !grouped.has(t.take_number))
  if (unnamed.length > 0) rows.push({ name: "Not named", takes: unnamed })

  const total = takes.reduce((sum, t) => sum + (t.duration_sec || 0), 0)

  // A plain mark with nothing written says only "here"; it stays on its
  // take's waveform but is no note to read in a list.
  const notes = takes.flatMap((t) =>
    (t.markers ?? [])
      .filter((m) => m.note.trim() !== "" || m.kind !== "note")
      .map((m) => ({ take: t, marker: m }))
  )

  return (
    <section
      aria-label="Rehearsal overview"
      className="flex flex-col gap-6 rounded-xl border bg-card px-5 py-4"
    >
      <p className="text-sm text-muted-foreground">
        <span className="tnum">{formatMMSS(total)}</span> · {takesLabel(takes.length)}
      </p>

      <div className="grid grid-cols-[minmax(8rem,auto)_auto_1fr] items-center gap-x-4 gap-y-2">
        {rows.map((row) => (
          <div key={row.name} className="contents">
            <span
              className={cn(
                "truncate text-sm",
                row.name === "Not named" && "text-muted-foreground"
              )}
            >
              {row.name}
            </span>
            <span className="tnum text-xs text-muted-foreground">
              {row.name === "Not named" ? "" : `×${row.takes.length}`}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {row.takes.map((t) => (
                <TakeChip key={t.take_number} take={t} onOpen={onOpen} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {notes.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">
            Notes
          </h3>
          {notes.map(({ take, marker }) => (
            <NoteRow
              key={`${take.take_number}-${marker.at}`}
              take={take}
              marker={marker}
              onOpenAt={onOpenAt}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function TakeChip({ take, onOpen }: { take: Take; onOpen: (take: Take) => void }) {
  const kinds = MARKER_KINDS.filter((k) =>
    take.markers?.some((m) => m.kind === k.kind)
  )
  return (
    <button
      type="button"
      aria-label={`Open ${take.name}`}
      title={take.name}
      onClick={() => onOpen(take)}
      className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-accent/50"
    >
      <span className="tnum text-[11px] text-muted-foreground">
        {String(take.take_number).padStart(2, "0")}
      </span>
      <span className="tnum">{formatMMSS(take.duration_sec)}</span>
      {kinds.map((k) => (
        <span key={k.kind} className={cn("size-1.5 rounded-full", k.dot)} />
      ))}
    </button>
  )
}

function NoteRow({
  take,
  marker,
  onOpenAt,
}: {
  take: Take
  marker: Marker
  onOpenAt: (take: Take, at: number) => void
}) {
  const style = markerStyle(marker.kind)
  return (
    <button
      type="button"
      data-note
      onClick={() => onOpenAt(take, marker.at)}
      className="flex items-center gap-3 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent/50"
    >
      <span className={cn("size-2 shrink-0 rounded-full", style.dot)} />
      <span className="w-28 shrink-0 truncate text-muted-foreground">
        {take.name}
      </span>
      <span className="tnum w-10 shrink-0 text-xs text-muted-foreground">
        {formatMMSS(marker.at)}
      </span>
      <span className="truncate">{marker.note || style.label}</span>
    </button>
  )
}
