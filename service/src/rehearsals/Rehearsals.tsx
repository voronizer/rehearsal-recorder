import { useNavigate } from "@tanstack/react-router"
import { cn } from "@/lib/utils"
import { useFrame, useRehearsals, type RehearsalItem } from "../api"
import { Dot, Empty, Group, Groups, Note, Page, Rows } from "../shell/parts"
import { useSize } from "../shell/size"
import { count, day, dayMonth, month } from "../shell/words"

/** A rehearsal's takes as РЭХА's small bars: height by length, green when starred. */
function TakeBars({ takes }: { takes: RehearsalItem["takes"] }) {
  const longest = useFrame().data?.longest || 1
  return (
    <span className="flex h-7 items-end gap-0.5" aria-hidden="true">
      {takes.map((t) => (
        <i
          key={t.uid}
          className={cn("w-1 rounded-sm", t.starred ? "bg-signal" : "bg-muted-foreground/40")}
          style={{ height: Math.max(6, Math.round((Math.min(t.duration_sec, longest) / longest) * 28)) }}
        />
      ))}
    </span>
  )
}

const COLUMNS = "grid-cols-[7rem_minmax(0,1fr)_minmax(9rem,1.2fr)_4rem_4rem]"

/** The songs played, with “Not named” for takes without a title. */
const played = (r: RehearsalItem) => [...r.songs, ...(r.not_named ? ["Not named"] : [])].join(", ")

/** One rehearsal: a row of the table on a computer, two lines elsewhere. Opens its page. */
function RehearsalRow({ r, table }: { r: RehearsalItem; table: boolean }) {
  const navigate = useNavigate()
  const go = () => navigate({ to: "/rehearsals/$uid", params: { uid: r.uid } })
  const date = (
    <span className="flex items-center gap-2">
      {day(r.date)}
      {r.has_new && <Dot />}
    </span>
  )
  if (table)
    return (
      <button type="button" data-rehearsal={r.date} className={cn("grid w-full items-center gap-3 text-left", COLUMNS)} onClick={go}>
        {date}
        <span className="truncate">{played(r)}</span>
        <span className="flex items-center gap-2.5">
          <TakeBars takes={r.takes} />
          <span className="tnum">{r.takes.length}</span>
        </span>
        <span className="tnum">{r.starred ? `★ ${r.starred}` : ""}</span>
        <span className="tnum">{r.marks || ""}</span>
      </button>
    )
  return (
    <button type="button" data-rehearsal={r.date} className="flex w-full items-center gap-3 text-left" onClick={go}>
      <span className="min-w-0 flex-1">
        {date}
        <span className="block truncate text-xs text-muted-foreground">{played(r)}</span>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <span className="flex items-center gap-2">
          <TakeBars takes={r.takes} />
          <span className="tnum">{r.takes.length}</span>
        </span>
        <span className="tnum text-xs text-muted-foreground">
          {[r.starred > 0 && `★ ${r.starred}`, r.marks > 0 && count(r.marks, "mark")].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  )
}

/** **Rehearsals**: a table by month, newest first, each month a fold. */
export function Rehearsals() {
  const list = useRehearsals()
  const table = useSize() === "wide"
  if (list.error) return <Note>{list.error.message}</Note>
  if (!list.data) return null
  const all = list.data
  if (!all.length) return <Empty title="Rehearsals" text="No rehearsals yet. A rehearsal appears here when РЭХА sends its first take." />
  const months = [...new Set(all.map((r) => r.date.slice(0, 7)))]
  const takes = all.reduce((n, r) => n + r.takes.length, 0)
  return (
    <Page title="Rehearsals" sub={`${count(all.length, "rehearsal")} since ${dayMonth(all[all.length - 1].date)} · ${count(takes, "take")}`}>
      <Groups>
        {months.map((m) => {
          const rows = all.filter((r) => r.date.startsWith(m))
          return (
            <Group key={m} title={month(`${m}-01`)} hint={count(rows.length, "rehearsal")} fold="open">
              {table && (
                <div className={cn("grid gap-3 text-xs text-muted-foreground", COLUMNS)}>
                  <span>Date</span>
                  <span>Songs</span>
                  <span>Takes</span>
                  <span>Starred</span>
                  <span>Marks</span>
                </div>
              )}
              <Rows>
                {rows.map((r) => (
                  <RehearsalRow key={r.uid} r={r} table={table} />
                ))}
              </Rows>
            </Group>
          )
        })}
      </Groups>
    </Page>
  )
}
