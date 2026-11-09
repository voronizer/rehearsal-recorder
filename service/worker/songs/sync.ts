import { and, eq, isNull, sql } from "drizzle-orm"
import { firstStatus } from "../labels/match"
import { database, type Database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { fold, same, TAKE_NAME } from "../shared/names"
import { setSong, song, songFile, take } from "../shared/schema"
import { iso } from "../shared/time"
import type { Signature } from "../takes/meta"
import { songBack } from "../takes/store"

/**
 * A song is the same song in РЭХА and here by its number, which the service
 * gives and РЭХА keeps; the title is only its name. Title, tempo and
 * signature change on either side: РЭХА sends its own changes at once and
 * reads the rest at its check, so the change that reaches the service last
 * is what stands. Who changed what here is kept, for РЭХА to say.
 */

export type SongMeter = { tempo: number | null; signature: Signature | null }

/** The song with this title, whatever its case, in the trash or not, but `except`. */
export async function findSong(db: Database, title: string, except?: number) {
  const all = await db.select({ id: song.id, title: song.title, trashedAt: song.trashedAt }).from(song)
  return all.find((s) => s.id !== except && same(s.title, title))
}

/** Why a title cannot be a song's, or null. */
export const titleRefused = (title: string) => (TAKE_NAME.test(title) ? `${title} is what a take with no song is called.` : null)

/**
 * A new song, with the first status; `by` the member who made it here, null
 * for РЭХА. Null when a request running at the same time made a song of that
 * title a moment before.
 */
export async function makeSong(db: Database, title: string, meter: SongMeter, by: string | null): Promise<number | null> {
  const [made] = await db
    .insert(song)
    .values({ title, statusId: await firstStatus(db), createdAt: iso(), ...meter, madeBy: by })
    .onConflictDoNothing()
    .returning({ id: song.id })
  return made?.id ?? null
}

/**
 * A song for РЭХА when the band has none of that title: a new one, or the
 * one a request running at the same time made a moment before, as
 * `findSong` finds it.
 */
export async function songFor(db: Database, title: string, meter: SongMeter) {
  const id = await makeSong(db, title, meter, null)
  return id === null ? (await findSong(db, title))! : { id, title, trashedAt: null }
}

/**
 * A song's new title: its takes' names follow, “Dym 3” becoming “Dym nad
 * vadoj 3”, and a take moved here and not yet numbered takes the title as
 * it is. `by` is the member, null for РЭХА.
 */
export async function renameSong(db: Database, id: number, title: string, by: string | null) {
  const [s] = await db.select({ title: song.title }).from(song).where(eq(song.id, id)).limit(1)
  const takes = await db.select({ uid: take.uid, name: take.name }).from(take).where(eq(take.songId, id))
  const old = s.title
  const renamed = takes.flatMap((t) => {
    const name = t.name === old ? title : t.name.startsWith(`${old} `) ? title + t.name.slice(old.length) : null
    return name === null || name === t.name ? [] : [db.update(take).set({ name }).where(eq(take.uid, t.uid))]
  })
  await db.batch([db.update(song).set({ title, titleBy: by }).where(eq(song.id, id)), ...renamed] as never)
}

/** A song's tempo and signature, both or neither. */
export async function setMeter(db: Database, id: number, meter: SongMeter, by: string | null) {
  await db.update(song).set({ ...meter, meterBy: by }).where(eq(song.id, id))
}

/**
 * Song `from` merged into song `into`, as РЭХА merged them: its takes move
 * across, `into` keeps its status, and its key, tempo and signature, or
 * takes the merged song's where it has none; the notes go one under the
 * other; the files go with them, copied to `into`'s place in R2, since R2
 * has no move. In a set that has both, `into` keeps its place; in one that
 * has only `from`, `into` takes its place. `from` goes. A take of `from` the
 * band hears brings `into` out of the trash.
 */
export async function mergeSong(env: Bindings, from: number, into: number) {
  const db = database(env)
  const [a] = await db.select().from(song).where(eq(song.id, from)).limit(1)
  const [b] = await db.select().from(song).where(eq(song.id, into)).limit(1)
  const files = await db.select({ id: songFile.id }).from(songFile).where(eq(songFile.songId, from))
  for (const f of files) {
    const object = await env.FILES.get(`songs/${from}/${f.id}`)
    if (object) await env.FILES.put(`songs/${into}/${f.id}`, object.body, { httpMetadata: object.httpMetadata })
  }
  const [live] = await db
    .select({ uid: take.uid })
    .from(take)
    .where(and(eq(take.songId, from), isNull(take.trashedAt)))
    .limit(1)
  const meter = b.tempo === null && a.tempo !== null ? { tempo: a.tempo, signature: a.signature, meterBy: a.meterBy } : {}
  await db.batch([
    db.update(take).set({ songId: into }).where(eq(take.songId, from)),
    db.update(songFile).set({ songId: into }).where(eq(songFile.songId, from)),
    db
      .delete(setSong)
      .where(
        and(
          eq(setSong.songId, from),
          sql`${setSong.setId} IN (SELECT ${setSong.setId} FROM ${setSong} WHERE ${setSong.songId} = ${into})`
        )
      ),
    db.update(setSong).set({ songId: into }).where(eq(setSong.songId, from)),
    db
      .update(song)
      .set({ key: b.key ?? a.key, notes: [b.notes, a.notes].filter((n) => n.trim()).join("\n\n"), ...meter })
      .where(eq(song.id, into)),
    db.delete(song).where(eq(song.id, from)),
    ...(live ? songBack(db, into) : []),
  ] as never)
  if (files.length) await env.FILES.delete(files.map((f) => `songs/${from}/${f.id}`))
}

/** A song as РЭХА sends it at its first check: its title, the titles it had, its tempo. */
export type RehaSong = { title: string; old_names: string[] } & SongMeter

/**
 * РЭХА's first check with this service: each of its songs gets its number.
 * A song here with the title is that song. Songs here titled as one of its
 * old names were the same song before a rename in РЭХА: the first is
 * renamed to the title when no song has it, and the rest are merged in.
 * A title here that differs only in capitals takes РЭХА's.
 * A song that matches nothing is made. The tempo and signature are РЭХА's
 * where it has one: before numbers, only РЭХА changed them. Asked again
 * after an answer that never came, it gives the same numbers.
 */
export async function linkSongs(env: Bindings, songs: RehaSong[]): Promise<number[]> {
  const db = database(env)
  const ids: number[] = []
  for (const s of songs) {
    const all = await db.select({ id: song.id, title: song.title }).from(song)
    const olds = new Set(s.old_names.map(fold))
    const found = all.find((x) => same(x.title, s.title))
    const before = all.filter((x) => x !== found && olds.has(fold(x.title)) && !ids.includes(x.id))
    let id: number
    if (found) {
      id = found.id
      // Its spelling is РЭХА's: before numbers, only РЭХА renamed songs.
      if (found.title !== s.title) await renameSong(db, id, s.title, null)
    } else if (before.length) {
      id = before.shift()!.id
      await renameSong(db, id, s.title, null)
    } else {
      const made = await songFor(db, s.title, { tempo: s.tempo, signature: s.signature })
      id = made.id
      // One made a moment before by a request running at the same time may differ in capitals.
      if (made.title !== s.title) await renameSong(db, id, s.title, null)
    }
    for (const x of before) await mergeSong(env, x.id, id)
    if (s.tempo !== null) await setMeter(db, id, { tempo: s.tempo, signature: s.signature }, null)
    ids.push(id)
  }
  return ids
}
