import { createRoute, z } from "@hono/zod-openapi"
import { and, count, eq, isNotNull, isNull } from "drizzle-orm"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok } from "../shared/openapi"
import { iso } from "../shared/time"
import { findSong, makeSong, titleRefused } from "../songs/sync"
import { loadMarks, MarkView } from "../marks/view"
import { bandSet, rehearsal, setSong, song, star, take, user } from "../shared/schema"
import { restoreSet } from "../sets/store"
import { needMember } from "../signin/guards"
import { Drift, Meter } from "./meta"
import { bare, initial, shownName, takeRows, TakeRow, waits, type Loaded } from "./rows"
import { songBack, toTrash } from "./store"
import { fillShapes } from "./shape"

const NO_TAKE = "No such take"
const TITLE = "A song's title is 1 to 100 characters"

const Uid = z.object({ uid: z.uuid() })

const TakePage = z
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
    balance: z.record(z.string(), z.number()),
    tracks: z.array(
      z.object({ position: z.number(), name: z.string(), icon: z.string().nullable(), mp3: z.string(), peaks: z.string() })
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

const Trash = z
  .object({
    songs: z.array(
      z.object({
        id: z.number(),
        title: z.string(),
        /** The takes that went with it. */
        takes: z.number(),
        trashed_at: z.string(),
        /** Who deleted it. */
        by: z.string().nullable(),
      })
    ),
    /** `by` is null for a take removed in РЭХА. */
    takes: z.array(TakeRow.extend({ trashed_at: z.string(), by: z.string().nullable() })),
    sets: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        /** Its songs, but those in the trash. */
        songs: z.number(),
        trashed_at: z.string(),
        /** Who deleted it; null for a set deleted in РЭХА. */
        by: z.string().nullable(),
      })
    ),
  })
  .openapi("Trash")

/** Who deleted it, by the name the band sees; null for РЭХА. */
const who = (u: { name: string | null; email: string | null }) => (u.email === null ? null : shownName(u.name ?? "", u.email))

/** A take the band sees, or undefined. */
async function shown(db: ReturnType<typeof database>, uid: string, alsoTrashed = false) {
  const [row] = await db
    .select()
    .from(take)
    .where(and(eq(take.uid, uid), isNotNull(take.shownGen), alsoTrashed ? undefined : isNull(take.trashedAt)))
    .limit(1)
  return row
}

/** A take: its page, stars, opening it, deleting it, the trash. */
export const takeRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/takes/{uid}",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(TakePage), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      const t = await shown(db, uid, true)
      if (!t) return fail(c, 404, NO_TAKE)
      const gen = t.shownGen!
      const filled = { ...t, gen }
      await fillShapes(c.env, db, [filled])
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
        loadMarks(db, c.var.member.id, eq(take.uid, uid)),
      ])
      const path = (name: string) => `/files/${uid}/${gen}/${name}`
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
      return c.json(
        {
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
          balance: t.balance,
          tracks: t.tracks
            .filter((k) => k.files.includes(`${k.position}.mp3`))
            .map((k) => ({
              position: k.position,
              name: k.name,
              icon: k.icon,
              mp3: path(`${k.position}.mp3`),
              peaks: path(`${k.position}.peaks`),
            })),
          stars: stars.map((s) => ({ member_id: s.memberId, initial: initial(s.name, s.email), name: shownName(s.name, s.email) })),
          starred_by_me: stars.some((s) => s.memberId === c.var.member.id),
          starred_at_rehearsal: t.starredAtRehearsal,
          marks: marks.sort((a, b) => a.at - b.at || a.id - b.id),
          notes: t.notes.map((n) => ({ position: n.position, name: n.name, icon: n.icon ?? null })),
          meter: t.meter,
          // Counted for a generation the band does not hear yet, or no more.
          drift: t.driftGen === gen ? t.drift : null,
          files,
          flac_coming: files.some((f) => f.mp3) && !flacUp,
          trashed_at: t.trashedAt,
          moved: waits(t),
        },
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/takes/{uid}",
      description:
        "**Move to song**: the take moves to the song `song`, out of its song with `song` null, or to a new song " +
        "titled `new_song`. Its name is the song's title, or “Take” out of a song, until РЭХА gives it its " +
        "number there at its next check.",
      middleware: [needMember] as const,
      request: {
        params: Uid,
        body: body(
          z.union([
            z.object({ song: z.int().min(1).nullable() }),
            z.object({ new_song: z.string().trim().min(1, { error: TITLE }).max(100, { error: TITLE }) }),
          ])
        ),
      },
      responses: { 200: json(Ok), ...errors(400, 401, 404, 409) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      const to = c.req.valid("json")
      const t = await shown(db, uid)
      if (!t) return fail(c, 404, NO_TAKE)
      const me = c.var.member.id
      let id: number
      if ("song" in to) {
        if (to.song === null) {
          // Out of its song: “Take” until РЭХА numbers it with the takes that have no song, at its check.
          if (t.songId !== null)
            await db.update(take).set({ songId: null, name: "Take", movedBy: me, updatedAt: iso() }).where(eq(take.uid, uid))
          return c.json({ ok: true as const }, 200)
        }
        const [s] = await db
          .select({ id: song.id })
          .from(song)
          .where(and(eq(song.id, to.song), isNull(song.trashedAt)))
          .limit(1)
        if (!s) return fail(c, 404, "No such song")
        id = s.id
        if (id === t.songId) return c.json({ ok: true as const }, 200)
      } else {
        const refused = titleRefused(to.new_song)
        if (refused) return fail(c, 400, refused)
        const other = await findSong(db, to.new_song)
        if (other?.trashedAt) return fail(c, 409, `“${other.title}” is in the Trash: restore it to move the take there.`)
        if (other) return fail(c, 409, `“${other.title}” is already a song: pick it in the list.`)
        const made = await makeSong(db, to.new_song, { tempo: null, signature: null }, me)
        if (made === null) return fail(c, 409, `“${(await findSong(db, to.new_song))!.title}” is already a song: pick it in the list.`)
        id = made
      }
      const [s] = await db.select({ title: song.title }).from(song).where(eq(song.id, id)).limit(1)
      await db.update(take).set({ songId: id, name: s.title, movedBy: me, updatedAt: iso() }).where(eq(take.uid, uid))
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/takes/{uid}/star",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      if (!(await shown(db, uid))) return fail(c, 404, NO_TAKE)
      await db.insert(star).values({ takeUid: uid, memberId: c.var.member.id }).onConflictDoNothing()
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/takes/{uid}/star",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(Ok), ...errors(401) },
    }),
    async (c) => {
      await database(c.env)
        .delete(star)
        .where(and(eq(star.takeUid, c.req.valid("param").uid), eq(star.memberId, c.var.member.id)))
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/takes/{uid}",
      description: "**Delete take**: the take goes to the trash, as one deleted in РЭХА does; in РЭХА it stays.",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      if (!(await shown(db, uid, true))) return fail(c, 404, NO_TAKE)
      await toTrash(db, eq(take.uid, uid), c.var.member.id, false)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/trash",
      description:
        "The trash, newest first: songs deleted with their takes, takes on their own, and sets. " +
        "A take that went with its song has no line of its own while the song is there.",
      middleware: [needMember] as const,
      responses: { 200: json(Trash), ...errors(401) },
    }),
    async (c) => {
      const db = database(c.env)
      const [rows, takes, songs, sets, sizes] = await Promise.all([
        takeRows(c.env, isNotNull(take.trashedAt)),
        db
          .select({ uid: take.uid, withSong: take.withSong, name: user.name, email: user.email })
          .from(take)
          .leftJoin(user, eq(take.trashedBy, user.id))
          .where(isNotNull(take.trashedAt)),
        db
          .select({ id: song.id, title: song.title, trashedAt: song.trashedAt, name: user.name, email: user.email })
          .from(song)
          .leftJoin(user, eq(song.trashedBy, user.id))
          .where(isNotNull(song.trashedAt)),
        db
          .select({ id: bandSet.id, setName: bandSet.name, trashedAt: bandSet.trashedAt, name: user.name, email: user.email })
          .from(bandSet)
          .leftJoin(user, eq(bandSet.trashedBy, user.id))
          .where(isNotNull(bandSet.trashedAt)),
        db
          .select({ id: setSong.setId, n: count() })
          .from(setSong)
          .innerJoin(bandSet, eq(setSong.setId, bandSet.id))
          .innerJoin(song, eq(setSong.songId, song.id))
          .where(and(isNotNull(bandSet.trashedAt), isNull(song.trashedAt)))
          .groupBy(setSong.setId),
      ])
      // A take put back between the two reads is in one and not the other.
      const nobody = { withSong: false, name: null, email: null }
      const of = (uid: string) => takes.find((t) => t.uid === uid) ?? nobody
      const inSong = (r: Loaded) => r.song_id !== null && of(r.uid).withSong && songs.some((s) => s.id === r.song_id)
      return c.json(
        {
          songs: songs
            .map((s) => ({
              id: s.id,
              title: s.title,
              takes: rows.filter((r) => r.song_id === s.id && inSong(r)).length,
              trashed_at: s.trashedAt!,
              by: who(s),
            }))
            .sort((a, b) => b.trashed_at.localeCompare(a.trashed_at)),
          takes: rows
            .filter((r) => !inSong(r))
            .sort((a, b) => b.trashed_at!.localeCompare(a.trashed_at!))
            .map((r) => ({ ...bare(r), trashed_at: r.trashed_at!, by: who(of(r.uid)) })),
          sets: sets
            .map((s) => ({
              id: s.id,
              name: s.setName,
              songs: sizes.find((n) => n.id === s.id)?.n ?? 0,
              trashed_at: s.trashedAt!,
              by: who(s),
            }))
            .sort((a, b) => b.trashed_at.localeCompare(a.trashed_at)),
        },
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/trash/{uid}/restore",
      description: "**Restore**: the take goes back in its song as it was, and brings back its song if that is in the trash.",
      middleware: [needMember] as const,
      request: { params: Uid },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      const [t] = await db
        .select({ songId: take.songId, songTrashed: song.trashedAt })
        .from(take)
        .leftJoin(song, eq(take.songId, song.id))
        .where(and(eq(take.uid, uid), isNotNull(take.trashedAt)))
        .limit(1)
      if (!t) return fail(c, 404, "This take is not in the trash")
      await db.batch([
        db.update(take).set({ trashedAt: null, trashedBy: null, withSong: false }).where(eq(take.uid, uid)),
        ...(t.songId !== null && t.songTrashed !== null ? songBack(db, t.songId) : []),
      ])
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/trash/songs/{id}/restore",
      description: "**Restore** on a song: it comes back with every take that went to the trash with it.",
      middleware: [needMember] as const,
      request: { params: z.object({ id: z.coerce.number().int().min(1) }) },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const [s] = await db
        .select({ id: song.id })
        .from(song)
        .where(and(eq(song.id, id), isNotNull(song.trashedAt)))
        .limit(1)
      if (!s) return fail(c, 404, "This song is not in the trash")
      await db.batch([
        db.update(song).set({ trashedAt: null, trashedBy: null }).where(eq(song.id, id)),
        db
          .update(take)
          .set({ trashedAt: null, trashedBy: null, withSong: false })
          .where(and(eq(take.songId, id), eq(take.withSong, true), isNotNull(take.trashedAt))),
      ])
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/trash/sets/{id}/restore",
      description:
        "**Restore** on a set: it is back in its place in the list, with its songs. A name another set took " +
        "meanwhile is turned down, saying so. It comes back to РЭХА at its next check.",
      middleware: [needMember] as const,
      request: { params: z.object({ id: z.coerce.number().int().min(1) }) },
      responses: { 200: json(Ok), ...errors(401, 404, 409) },
    }),
    async (c) => {
      const refused = await restoreSet(database(c.env), c.req.valid("param").id)
      if (refused) return fail(c, refused.code, refused.words)
      return c.json({ ok: true as const }, 200)
    }
  )
