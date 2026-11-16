import { z } from "@hono/zod-openapi"
import { eq } from "drizzle-orm"
import type { Database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { loadMarks, MarkView } from "../marks/view"
import { rehearsal, song, star, take, user } from "../shared/schema"
import { Drift, Meter } from "./meta"
import { gainOf } from "./gain"
import { initial, shownName, waits } from "./rows"
import { fillShapes } from "./shape"

export const TakePage = z
  .object({
    uid: z.string(),
    name: z.string(),
    number: z.number(),
    date: z.string(),
    rehearsal: z.object({ uid: z.string(), name: z.string(), date: z.string() }),
    song: z.object({ id: z.number(), title: z.string() }).nullable(),
    duration_sec: z.number(),
    /** Its wave, as a list draws it (takes/shape.ts). */
    shape: z.array(z.number()),
    /** The generation the band hears; the files' paths carry it. */
    gen: z.number(),
    /** Where its files are, with no "/" at the end: the pages add a file's name. */
    files_at: z.string(),
    balance: z.record(z.string(), z.number()),
    tracks: z.array(
      z.object({ position: z.number(), name: z.string(), icon: z.string().nullable(), mp3: z.string(), peaks: z.string(), kind: z.literal("backing").nullable().optional() })
    ),
    stars: z.array(z.object({ member_id: z.string(), initial: z.string(), name: z.string() })),
    starred_by_me: z.boolean(),
    starred_at_rehearsal: z.boolean(),
    /** Its marks by their moment, each with the comments under it. */
    marks: z.array(MarkView),
    /** The tracks that recorded notes, with the track's icon: null for one
     *  РЭХА 0.21 or older sent. */
    notes: z.array(z.object({ position: z.number(), name: z.string(), icon: z.string().nullable() })),
    /** Its click, for Master's stripes; null for a take РЭХА 0.21 or older sent. */
    meter: Meter.nullable(),
    /** The band's tempo through the generation the band hears; null until
     *  РЭХА has counted it. */
    drift: Drift.nullable(),
    /** How far every track is turned up, the same for all, by the take's
     *  peak (takes/gain.ts): below 1 for a take that would crackle, and 1
     *  when РЭХА has not sent the peak of the generation the band hears. */
    gain: z.number(),
    /** The files **Download** lists; `mid` is null for a track with no notes. */
    files: z.array(
      z.object({ position: z.number(), name: z.string(), mp3: z.boolean(), flac: z.boolean(), mid: z.boolean().nullable() })
    ),
    /** The originals are still on their way. */
    flac_coming: z.boolean(),
    trashed_at: z.string().nullable(),
    /** Moved to another song here, or out of its song, and not numbered by РЭХА yet. */
    moved: z.boolean(),
  })
  .openapi("TakePage")

export type TakePage = z.infer<typeof TakePage>

/**
 * A take's page as the band's page draws it, for `viewer` (a member's id for
 * their stars and marks; "" for nobody), its files under `filesAt`. The take
 * is shown. A link to the take cuts this down to what it shows (links/).
 */
export async function takePage(
  env: Bindings,
  db: Database,
  t: typeof take.$inferSelect,
  viewer: string,
  filesAt: string
): Promise<TakePage> {
  const uid = t.uid
  const gen = t.shownGen!
  const filled = { ...t, gen }
  await fillShapes(env, db, [filled])
  const [[[r], songs, stars], marks] = await Promise.all([
    db.batch([
      db.select().from(rehearsal).where(eq(rehearsal.uid, t.rehearsalUid)),
      db.select().from(song).where(eq(song.id, t.songId ?? -1)),
      db
        .select({ memberId: user.id, name: user.name, email: user.email })
        .from(star)
        .innerJoin(user, eq(star.memberId, user.id))
        .where(eq(star.takeUid, uid))
        .orderBy(user.name, user.email),
    ]),
    loadMarks(db, viewer, eq(take.uid, uid)),
  ])
  const path = (name: string) => `${filesAt}/${name}`
  const flacUp = t.flacGen === gen
  const positions = [...new Set([...t.tracks.map((k) => k.position), ...t.notes.map((n) => n.position)])].sort(
    (a, b) => a - b
  )
  const files = positions.map((position) => {
    const audio = t.tracks.find((k) => k.position === position)
    const notes = t.notes.find((n) => n.position === position)
    return {
      position,
      name: audio?.name ?? notes!.name,
      mp3: Boolean(audio?.files.includes(`${position}.mp3`)),
      flac: flacUp && Boolean(audio?.files.includes(`${position}.flac`)),
      mid: notes ? true : null,
    }
  })
  return {
    uid,
    name: t.name,
    number: t.number,
    date: r.date,
    rehearsal: r,
    // A song in the trash has no page to go to.
    song: songs[0] && !songs[0].trashedAt ? { id: songs[0].id, title: songs[0].title } : null,
    duration_sec: t.durationSec,
    shape: filled.shape ?? [],
    gen,
    files_at: filesAt,
    balance: t.balance,
    tracks: t.tracks
      .filter((k) => k.files.includes(`${k.position}.mp3`))
      .map((k) => ({
        position: k.position,
        name: k.name,
        icon: k.icon,
        mp3: path(`${k.position}.mp3`),
        peaks: path(`${k.position}.peaks`),
        kind: k.kind ?? null,
      })),
    stars: stars.map((s) => ({ member_id: s.memberId, initial: initial(s.name, s.email), name: shownName(s.name, s.email) })),
    starred_by_me: stars.some((s) => s.memberId === viewer),
    starred_at_rehearsal: t.starredAtRehearsal,
    marks: marks.sort((a, b) => a.at - b.at || a.id - b.id),
    notes: t.notes.map((n) => ({ position: n.position, name: n.name, icon: n.icon ?? null })),
    meter: t.meter,
    // Counted for a generation the band does not hear yet, or no more.
    drift: t.driftGen === gen ? t.drift : null,
    gain: gainOf(t.peak, t.peakGen, gen),
    files,
    flac_coming: files.some((f) => f.mp3) && !flacUp,
    trashed_at: t.trashedAt,
    moved: waits(t),
  }
}
