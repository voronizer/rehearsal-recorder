import type { TakeColumn } from "@/components/ui/take-columns"
import type { SongChoices, Take } from "@/lib/api"
import { formatMMSS } from "@/lib/format"
import { goFor, songFor, unnamedGo } from "@/lib/goes"
import { GO_SPACE, NO_SONG, goMark } from "@/lib/takeText"

/** The most columns shown: the last takes, this one last, so a song played
 *  all evening still leaves its title the room. */
const MOST_COLUMNS = 10

/**
 * What the screen after a take says about it (issue #12 step 8, Q1 "the name
 * in the header"): its song and the number it will be, or "Take" and its
 * number for a take nobody named ("Take #47"); and the song's takes tonight as
 * columns, the last ten, this one lit. A song's first take tonight has no
 * columns, nor does a take nobody named. The length is the transport's to
 * say, under the header. The same steps as Python's naming (songFor, goFor).
 */
export function takeFacts({
  name,
  takeNumber,
  durationSec,
  takes,
  choices,
}: {
  name: string
  takeNumber: number
  durationSec: number
  /** Tonight's takes kept so far. */
  takes: Take[]
  choices: SongChoices | null
}) {
  // A title no song has yet is a new song, at its first take; "Take 47" is a
  // take nobody named, its go the number in it.
  const typed = name.trim()
  const unnamedAt = unnamedGo(typed)
  const unnamed = typed === "" || unnamedAt !== null
  const song = unnamed ? null : (songFor(typed, choices)?.choice.song ?? typed)
  // Until the songs are in, the number is not guessed.
  const go = song ? goFor(typed, choices) : unnamedAt
  const before = song
    ? takes.filter((t) => t.song === song && t.take_number !== takeNumber)
    : []
  const columns: TakeColumn[] =
    before.length === 0
      ? []
      : [
          ...before.map((t) => ({
            key: t.take_number,
            sec: t.duration_sec,
            starred: Boolean(t.starred),
            lit: false,
            label: t.go ?? null,
          })),
          { key: takeNumber, sec: durationSec, starred: false, lit: true, label: go },
        ].slice(-MOST_COLUMNS)
  return {
    song,
    go,
    unnamed: !song,
    /** What the title says before the go: the song, "Take" for a take
     *  nobody named, or the name as typed when it is empty. */
    shown: song ?? (unnamedAt !== null ? NO_SONG : name),
    columns,
    /** The columns in words, each by the take's own name as the screen
     *  writes it ("Viasna #1: 0:18"), for their tip and for the title's once
     *  they have given way. */
    columnsText: columns
      .map((c) => `${song}${GO_SPACE}${c.label != null ? goMark(c.label) : "#?"}: ${formatMMSS(c.sec)}`)
      .join(", "),
    /** The same for a screen reader, by the take's plain name ("Viasna 1:
     *  0:18"), as its aria-labels name a take. */
    columnsSaid: columns
      .map((c) => `${song} ${c.label ?? "?"}: ${formatMMSS(c.sec)}`)
      .join(", "),
  }
}

export type TakeFacts = ReturnType<typeof takeFacts>
