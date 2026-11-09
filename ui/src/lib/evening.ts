import type { SendTo, Take } from "@/lib/api"
import { formatDuration, songsLabel } from "@/lib/format"
import { isIn } from "@/lib/sending"

/** What the header says about an evening, counted from its takes. */
export type EveningFacts = { seconds: number; takes: number; songs: number; sent: number }

/** Counted from the takes on screen, so a take kept, deleted or sent
 *  changes the header at once. `sent` is how many are where takes go,
 *  the cloud folder or the band service (`place`). */
export function eveningOf(takes: Take[], place: SendTo = "cloud"): EveningFacts {
  const songs = new Set<string>()
  let seconds = 0
  let sent = 0
  for (const take of takes) {
    seconds += take.duration_sec
    if (take.song) songs.add(take.song)
    if (isIn(take, place)) sent += 1
  }
  return { seconds, takes: takes.length, songs: songs.size, sent }
}

/** "45 min"; an evening of a few seconds is "<1 min", not "0 min". */
export function lengthLabel(seconds: number): string {
  if (seconds > 0 && seconds < 60) return "<1 min"
  return formatDuration(seconds / 60)
}

/** "11, 4 songs": the takes, and how many songs they were. */
export function takesLine(f: EveningFacts): string {
  if (f.songs === 0) return String(f.takes)
  return `${f.takes}, ${songsLabel(f.songs)}`
}

/** A false start: shorter than the limit set in Settings, with no ★ and no
 *  marks. A take somebody starred or marked was worth something, and one of
 *  0 s is one whose length was never known (an old one imported). */
export function isFalseStart(
  take: Pick<Take, "duration_sec" | "starred" | "markers">,
  limitSec: number
): boolean {
  return (
    take.duration_sec > 0 &&
    take.duration_sec < limitSec &&
    !take.starred &&
    !take.markers?.length
  )
}

/** The evening's false starts, in the order they were played. */
export function falseStarts(takes: Take[], limitSec: number): Take[] {
  return takes.filter((t) => isFalseStart(t, limitSec))
}

/** What Send starred would queue: the ★ takes with no copy in the cloud
 *  folder and none waiting for one; or, with the band service chosen, the
 *  ones never sent there (sending/band_service.py's send_starred). */
export function starredToSend(
  takes: Take[],
  waiting: Record<number, unknown> = {},
  place: SendTo = "cloud"
): Take[] {
  return takes.filter(
    (t) =>
      t.starred &&
      !(t.take_number in waiting) &&
      (place === "service" ? !t.service : !t.cloud?.mix && !t.cloud?.tracks)
  )
}
