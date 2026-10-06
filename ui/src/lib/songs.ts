import type { Marker, NotNamedSummary, SongGo, SongIndex, SongSummary, Take } from "@/lib/api"
import { formatDate, formatDayIn, goesLabel, takesLabel } from "@/lib/format"

/** Song titles in the order a person looks for them: alphabetical, any
 *  script, capitals or not. The All songs panel and History's Songs view
 *  both use it, so a title is in the same place in each. */
export const ALPHABETICAL = new Intl.Collator(undefined, { sensitivity: "base" })

/**
 * A take with the rehearsal it is in. History holds goes from several
 * rehearsals at once on a song's page, and two rehearsals both have a take
 * 2: the take number alone no longer says which take is meant.
 */
export type PlacedTake = Take & { folder: string }

export function placed(folder: string, take: Take): PlacedTake {
  return { ...take, folder }
}

/** The same take: the same number in the same rehearsal. A rename or a crop
 *  hands back a fresh copy, which is still the same take. */
export function byPlace(a: Take, b: Take): boolean {
  return a.take_number === b.take_number && (a as PlacedTake).folder === (b as PlacedTake).folder
}

/** The take playing in an overview or on a song's page, and where it is. */
export type PlacedPlayback = {
  take: PlacedTake
  playing: boolean
  loading: boolean
  position: number
  duration: number
}

/** What one row of `folder` passes on as the take playing on it: the
 *  playback, when the row's take is the one playing, and otherwise none. */
export function hereFor(
  pb: PlacedPlayback | null,
  folder: string,
  take: Take
): { take: number; playing: boolean; loading: boolean; position: number; duration: number } | null {
  if (!pb || !byPlace(pb.take, placed(folder, take))) return null
  return { ...pb, take: take.take_number }
}

/** A row of the Songs view: a song's id, or the takes nobody named. */
export type SongRef = number | "not_named"

/** The Songs view's rows, in order: the songs alphabetically, then the
 *  takes nobody named, when there are any. */
export function inSongOrder(index: SongIndex): SongRef[] {
  const songs = [...index.songs].sort(
    (a, b) => ALPHABETICAL.compare(a.title, b.title) || a.id - b.id
  )
  const rows: SongRef[] = songs.map((s) => s.id)
  if (index.not_named) rows.push("not_named")
  return rows
}

// Capitals aside, and nothing else: Python keeps titles apart by case only,
// so "Palyn" and "Pałyn" are two songs.
const CASE_BLIND = new Intl.Collator(undefined, { sensitivity: "accent" })

/** The row of the Songs view a song's title names, or Not named's for null.
 *  A title shown elsewhere comes from Python spelled as kept, so it is
 *  matched as spelled first, and capitals aside only after. Nothing when
 *  there is no such row. */
export function songRefFor(index: SongIndex, title: string | null): SongRef | null {
  if (title === null) return index.not_named ? "not_named" : null
  const song =
    index.songs.find((s) => s.title === title) ??
    index.songs.find((s) => CASE_BLIND.compare(s.title, title) === 0)
  return song?.id ?? null
}

/** One rehearsal's goes at a song: a rung of the ladder on its page. */
export type Rung = {
  folder: string
  rehearsal: string
  created_at: string
  missing: boolean
  goes: Take[]
}

/** The goes as rungs, one per rehearsal, in the order given — which is the
 *  newest rehearsal first, as get_song sends them. */
export function rungsOf(goes: SongGo[]): Rung[] {
  const rungs: Rung[] = []
  for (const g of goes) {
    const last = rungs[rungs.length - 1]
    if (last && last.folder === g.folder) last.goes.push(g.take)
    else
      rungs.push({
        folder: g.folder,
        rehearsal: g.rehearsal,
        created_at: g.created_at,
        missing: g.missing,
        goes: [g.take],
      })
  }
  return rungs
}

/** The rung open when a song's page is first shown: its newest rehearsal on
 *  disk, or with none, its newest. */
export function firstOpen(rungs: Rung[]): string | null {
  return (rungs.find((r) => !r.missing) ?? rungs[0])?.folder ?? null
}

/** Every mark on the song's goes at its newest rehearsal on disk, go by go
 *  and in order within one: what the band said about it last time. */
export function fromLastTime(goes: SongGo[]): { go: SongGo; marker: Marker }[] {
  const last = goes.find((g) => !g.missing)
  if (!last) return []
  return goes
    .filter((g) => g.folder === last.folder)
    .flatMap((g) =>
      [...(g.take.markers ?? [])].sort((a, b) => a.at - b.at).map((marker) => ({ go: g, marker }))
    )
}

const rehearsalsLabel = (n: number) => (n === 1 ? "1 rehearsal" : `${n} rehearsals`)

/** "7 goes · 4 rehearsals · last 28 Sep", under a song in the list. */
export function songLine(s: SongSummary, now: Date = new Date()): string {
  return `${goesLabel(s.goes)} · ${rehearsalsLabel(s.rehearsals)} · last ${formatDate(s.last_played, now)}`
}

/** "3 takes · 2 rehearsals · last 22 Sep", under Not named in the list. */
export function notNamedLine(n: NotNamedSummary, now: Date = new Date()): string {
  return `${takesLabel(n.takes)} · ${rehearsalsLabel(n.rehearsals)} · last ${formatDate(n.last_played, now)}`
}

/** Under a song's title on its page: "12 goes in 5 rehearsals · first 2 Aug
 *  · last 30 Sep"; for the takes nobody named, "3 takes in 2 rehearsals ·
 *  last Tue 22 Sep". */
export function pageLine(goes: SongGo[], unnamed: boolean, now: Date = new Date()): string {
  const rungs = rungsOf(goes)
  if (rungs.length === 0) return ""
  const newest = rungs[0].created_at
  const oldest = rungs[rungs.length - 1].created_at
  if (unnamed)
    return `${takesLabel(goes.length)} in ${rehearsalsLabel(rungs.length)} · last ${formatDayIn(newest, now)}`
  return `${goesLabel(goes.length)} in ${rehearsalsLabel(rungs.length)} · first ${formatDate(oldest, now)} · last ${formatDate(newest, now)}`
}
