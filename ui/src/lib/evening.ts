import type { Take } from "@/lib/api"
import { formatDuration } from "@/lib/format"

/** What the header says about an evening, counted from its takes. */
export type EveningFacts = { seconds: number; takes: number; songs: number; inCloud: number }

/** Counted from the takes on screen, so a take kept, deleted or copied to
 *  the cloud changes the header at once. */
export function eveningOf(takes: Take[]): EveningFacts {
  const songs = new Set<string>()
  let seconds = 0
  let inCloud = 0
  for (const take of takes) {
    seconds += take.duration_sec
    if (take.song) songs.add(take.song)
    if (take.cloud?.mix || take.cloud?.tracks) inCloud += 1
  }
  return { seconds, takes: takes.length, songs: songs.size, inCloud }
}

/** "45 min"; an evening of a few seconds is "<1 min", not "0 min". */
export function lengthLabel(seconds: number): string {
  if (seconds > 0 && seconds < 60) return "<1 min"
  return formatDuration(seconds / 60)
}

/** "11, 4 songs": the takes, and how many songs they were. */
export function takesLine(f: EveningFacts): string {
  if (f.songs === 0) return String(f.takes)
  return `${f.takes}, ${f.songs} ${f.songs === 1 ? "song" : "songs"}`
}

/** A false start: shorter than the limit set in Settings, with no ★ and no
 *  marks. A take somebody starred or marked was worth something. */
export function isFalseStart(take: Take, limitSec: number): boolean {
  return take.duration_sec < limitSec && !take.starred && !take.markers?.length
}

/** The evening's false starts, in the order they were played. */
export function falseStarts(takes: Take[], limitSec: number): Take[] {
  return takes.filter((t) => isFalseStart(t, limitSec))
}

/** What Send starred would queue: the ★ takes with no copy in the cloud
 *  folder and none waiting for one. */
export function starredToSend(takes: Take[], waiting: Record<number, unknown> = {}): Take[] {
  return takes.filter(
    (t) => t.starred && !t.cloud?.mix && !t.cloud?.tracks && !(t.take_number in waiting)
  )
}
