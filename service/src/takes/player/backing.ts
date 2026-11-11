import type { TakeSong } from "@/hooks/useMultitrackPlayer"
import { backingQuery, keepBackingHeard, queryClient, useBacking, type TakePage } from "../../api"
import { withMute, type Desk } from "./desk"

/*
  A take's Backing track as each member hears it: muted the first time a
  take of its song opens, and after that as they last left its M for that
  song. A take with no song, or whose song is in the Trash (its `song` is
  null then), opens with Backing muted and keeps nothing. The take's page
  (Take.tsx) and every Player the one player makes (one.tsx) start Backing
  by this, so a take that plays from a list, or before its page has
  opened, never changes as the page opens.
*/

type Answer = { heard: Record<string, boolean> }

/** M on a song's Backing pressed since the service was opened, by the song's id:
 *  newer than an answer read before the press, and kept here when the service
 *  could not keep it, as M stays as pressed. */
const pressed = new Map<number, boolean>()

const heardFor = (song: number, answer: Answer | undefined) => pressed.get(song) ?? answer?.heard[String(song)] ?? false

/** The take's Backing track, by its index; -1 for a take without one. */
const backingOf = (take: TakePage) => take.tracks.findIndex((t) => t.kind === "backing")

/** The song whose answer the take's Backing waits for: null for a take with no Backing track or no song. */
const songOf = (take: TakePage) => (take.song && backingOf(take) >= 0 ? take.song.id : null)

/** A take's M and S before any Player had it: Backing muted, the rest heard. */
export function firstDesk(take: TakePage): Desk {
  const b = backingOf(take)
  return { muted: b < 0 ? [] : [b], solo: null }
}

/** M and S as a new Player of the take starts them: Backing muted unless `heard`; with
 *  `heard` null, a take with no song, as `desk` has it. */
export function withBacking(take: TakePage, desk: Desk, heard: boolean | null): Desk {
  const b = backingOf(take)
  return b < 0 || heard === null ? desk : withMute(desk, b, !heard)
}

/**
 * Whether the member hears the take's Backing track, for its song: `then`
 * hears it at once when the service has said, else once it answers. Not
 * answered, it is muted. null for a take with no Backing track or no song.
 */
export function whenHeard(take: TakePage, then: (heard: boolean | null) => void): void {
  const song = songOf(take)
  if (song === null) return then(null)
  const known = queryClient.getQueryData(backingQuery.queryKey)
  if (known) return then(heardFor(song, known))
  queryClient.fetchQuery(backingQuery).then(
    (answer) => then(heardFor(song, answer)),
    () => then(heardFor(song, undefined))
  )
}

/**
 * The take's song for its Backing track, as РЭХА's player takes it
 * (useMultitrackPlayer): its number, and whether you hear that song's
 * Backing. Undefined while the service has not said yet: the player opens
 * after it. Null for a take with no Backing, no song, or its song in the
 * Trash: Backing opens muted and nothing is kept.
 */
export function useBackingSong(take: TakePage): TakeSong | null | undefined {
  const song = songOf(take)
  const yours = useBacking(song !== null)
  if (song === null) return null
  if (yours.isPending) return undefined
  return { id: song, heard: heardFor(song, yours.data) }
}

/** M on the song's Backing pressed: heard so from now on here, and kept for the member. */
export function keepHeard(song: number, heard: boolean) {
  pressed.set(song, heard)
  return keepBackingHeard(song, heard)
}
