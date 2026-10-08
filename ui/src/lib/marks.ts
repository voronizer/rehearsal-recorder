import type { Label, MarkHit, MarksGrouping } from "@/lib/api"
import { formatClock, formatDate, formatDayIn } from "@/lib/format"
import { rehearsalsLabel } from "@/lib/songs"

// History's Marks view: every mark with a label, from every rehearsal
// (docs/superpowers/specs/2026-10-04-marks-across-the-library-design.md).
// What it groups and says; the screen is components/MarksPage.tsx.

/** How long before a mark ▶ starts: the moment is heard coming. */
export const MARK_LEAD_SEC = 5

/** Where ▶ plays a mark from. */
export function playFrom(at: number): number {
  return Math.max(0, at - MARK_LEAD_SEC)
}

/** One mark among every rehearsal's: its rehearsal, its take, its moment. */
export function markKey(m: MarkHit): string {
  return `${m.folder}#${m.take_number}@${m.at}`
}

export const marksLabel = (n: number) => (n === 1 ? "1 mark" : `${n} marks`)

/** The marks under one heading: a rehearsal, a song, or, in one list, all. */
export type MarkGroup = {
  key: string
  kind: MarksGrouping
  /** "Tuesday jam · Tue 22 Sep · 3 marks", "Pałyn · 2 marks"; "" in one list. */
  title: string
  /** The title less its count: what the heading opens. */
  name: string
  /** By rehearsal: the rehearsal the heading opens. */
  folder?: string
  /** By song: the song the heading opens, null for the takes with no song. */
  song?: string | null
  marks: MarkHit[]
}

/**
 * The marks as `grouping` says, keeping their order: by rehearsal, newest
 * first; by song, in the order of each song's newest mark, the takes with no
 * song last as "Not named"; or as one list.
 */
export function groupMarks(marks: MarkHit[], grouping: MarksGrouping, now: Date = new Date()): MarkGroup[] {
  if (marks.length === 0) return []
  if (grouping === "list") return [{ key: "list", kind: "list", title: "", name: "", marks }]
  const groups = new Map<string, MarkGroup>()
  for (const m of marks) {
    const key = grouping === "rehearsal" ? m.folder : m.song === null ? "" : `song:${m.song}`
    let group = groups.get(key)
    if (!group) {
      group =
        grouping === "rehearsal"
          ? { key, kind: grouping, title: "", name: "", folder: m.folder, marks: [] }
          : { key, kind: grouping, title: "", name: "", song: m.song, marks: [] }
      groups.set(key, group)
    }
    group.marks.push(m)
  }
  const out = [...groups.values()]
  for (const g of out) {
    const first = g.marks[0]
    g.name =
      grouping === "rehearsal"
        ? `${first.rehearsal} · ${formatDayIn(first.created_at, now)}`
        : (first.song ?? "Not named")
    g.title = `${g.name} · ${marksLabel(g.marks.length)}`
  }
  if (grouping === "song") {
    const unnamed = out.findIndex((g) => g.song === null)
    if (unnamed >= 0) out.push(...out.splice(unnamed, 1))
  }
  return out
}

/** Under a label on the left: "3 rehearsals · last 22 Sep", or "no marks yet". */
export function labelLine(label: Label, now: Date = new Date()): string {
  if (!label.marks || !label.last_marked) return "no marks yet"
  return `${rehearsalsLabel(label.rehearsals ?? 0)} · last ${formatDate(label.last_marked, now)}`
}

/** Under the chosen label's name: "5 marks in 3 rehearsals · last 22 Sep". */
export function headLine(marks: MarkHit[], now: Date = new Date()): string {
  if (marks.length === 0) return "No marks yet"
  const rehearsals = new Set(marks.map((m) => m.folder)).size
  const newest = marks.reduce((a, m) => (m.created_at > a ? m.created_at : a), marks[0].created_at)
  return `${marksLabel(marks.length)} in ${rehearsalsLabel(rehearsals)} · last ${formatDate(newest, now)}`
}

/**
 * A row's second line: the take and the moment, "Pałyn 4 · 1:51". `song` is
 * the title to show as a link to its page, `rest` what follows it. By song
 * the heading has the song, so the line gives the take and the rehearsal
 * instead; in one list the rehearsal follows the take.
 */
export function rowLine(
  m: MarkHit,
  grouping: MarksGrouping,
  now: Date = new Date()
): { song: string | null; rest: string } {
  const where = grouping === "rehearsal" ? "" : ` · ${m.rehearsal}, ${formatDate(m.created_at, now)}`
  const moment = ` · ${formatClock(m.at)}${where}`
  if (grouping === "song" || m.song === null || !m.name.startsWith(m.song))
    return { song: null, rest: `${m.name}${moment}` }
  return { song: m.song, rest: `${m.name.slice(m.song.length)}${moment}` }
}
