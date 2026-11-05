import { createRoute, z } from "@hono/zod-openapi"
import { eq, isNotNull } from "drizzle-orm"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok, RehaHeaders } from "../shared/openapi"
import { song, take, user } from "../shared/schema"
import { needKey } from "../signin/guards"
import { Signature, tempoRefused } from "../takes/meta"
import { shownName } from "../takes/rows"
import { findSong, linkSongs, makeSong, mergeSong, renameSong, setMeter, titleRefused, type SongMeter } from "./sync"

const rehaKey = [{ rehaKey: [] }]
const Id = z.object({ id: z.coerce.number().int().min(1) })
const NO_SONG = "No such song"
const TITLE = "A song's title is 1 to 100 characters"
const Title = z.string().trim().min(1, { error: TITLE }).max(100, { error: TITLE })

/** A tempo and its signature, both or neither, as РЭХА keeps them. */
const Meter = z
  .object({ tempo: z.int().nullable(), signature: Signature.nullable() })
  .refine((m) => (m.tempo === null) === (m.signature === null), { error: "A tempo goes with its signature" })
  .refine((m) => m.tempo === null || m.signature === null || tempoRefused(m.tempo, m.signature) === null, {
    error: "A tempo is a whole number from 30 to 300, from 60 to 600 in 6/8",
  })

const RehaSong = z.object({ title: Title, old_names: z.array(z.string()).max(1000) }).and(Meter)

/** Why `title` cannot be song `id`'s: a take's name (400) or another song's title (409); null when it can. */
async function clash(db: ReturnType<typeof database>, title: string, id: number) {
  const refused = titleRefused(title)
  if (refused) return { code: 400 as const, words: refused }
  const other = await findSong(db, title, id)
  if (!other) return null
  return { code: 409 as const, words: `“${other.title}” is another song in the band service now. Merge them in РЭХА if they are one song.` }
}

/** The routes РЭХА calls with its key for the band's songs. */
export const rehaSongRoutes = newApp()
  .openapi(
    createRoute({
      method: "post",
      path: "/api/reha/songs/link",
      description:
        "РЭХА's first check with this service: each of its songs, with the titles it had before, gets its number, " +
        "in the same order. A song with the title is that song; songs titled as one of its old names are joined to " +
        "it; one that matches nothing is made.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, body: body(z.object({ songs: z.array(RehaSong).max(5000) })) },
      responses: { 200: json(z.object({ ids: z.array(z.number()) })), ...errors(400, 401, 426) },
    }),
    async (c) => c.json({ ids: await linkSongs(c.env, c.req.valid("json").songs) }, 200)
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/reha/songs",
      description:
        "A song made in РЭХА, before its first take: its number. A title the band has is that song, and takes " +
        "РЭХА's tempo and signature when РЭХА has them, as at the first check.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, body: body(z.object({ title: Title }).and(Meter)) },
      responses: { 200: json(z.object({ id: z.number() })), ...errors(400, 401, 426) },
    }),
    async (c) => {
      const db = database(c.env)
      const { title, tempo, signature } = c.req.valid("json")
      const refused = titleRefused(title)
      if (refused) return fail(c, 400, refused)
      const found = await findSong(db, title)
      if (!found) return c.json({ id: await makeSong(db, title, { tempo, signature } as SongMeter, null) }, 200)
      if (tempo !== null) await setMeter(db, found.id, { tempo, signature } as SongMeter, null)
      return c.json({ id: found.id }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/reha/songs/{id}",
      description:
        "A change made in РЭХА: the title, or the tempo and signature together. A title another song has is " +
        "turned down, saying so: the song keeps the title it had.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: {
        headers: RehaHeaders,
        params: Id,
        body: body(
          z.object({
            title: Title.optional(),
            tempo: z.int().nullable().optional(),
            signature: Signature.nullable().optional(),
          })
        ),
      },
      responses: { 200: json(Ok), ...errors(400, 401, 404, 409, 426) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const { title, tempo, signature } = c.req.valid("json")
      const [s] = await db.select({ id: song.id, title: song.title }).from(song).where(eq(song.id, id)).limit(1)
      if (!s) return fail(c, 404, NO_SONG)
      // Both looked at before either is kept: a title turned down keeps the tempo as it was too.
      const renamed = title !== undefined && title !== s.title
      const refused = renamed ? await clash(db, title, id) : null
      if (refused) return fail(c, refused.code, refused.words)
      const meter = tempo !== undefined || signature !== undefined ? Meter.safeParse({ tempo: tempo ?? null, signature: signature ?? null }) : null
      if (meter && !meter.success) return fail(c, 400, meter.error.issues[0].message)
      if (meter) await setMeter(db, id, meter.data as SongMeter, null)
      if (renamed) await renameSong(db, id, title, null)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/reha/songs/{id}/merge",
      description:
        "Songs merged in РЭХА: this one into `into`. Its takes move across; `into` keeps its status, and its key, " +
        "tempo and signature, or takes this one's where it has none; the notes go one under the other, the files " +
        "go with them. This song goes.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, params: Id, body: body(z.object({ into: z.int().min(1) })) },
      responses: { 200: json(Ok), ...errors(400, 401, 404, 426) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const { into } = c.req.valid("json")
      if (id === into) return fail(c, 400, "A song cannot be merged into itself")
      const found = await db.select({ id: song.id }).from(song).where(eq(song.id, into))
      if (!found.length) return fail(c, 404, NO_SONG)
      // Merged already, its answer lost on the way back.
      const [from] = await db.select({ id: song.id }).from(song).where(eq(song.id, id))
      if (from) await mergeSong(c.env, id, into)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/reha/songs",
      description:
        "Every song with its number, title, tempo, signature, whether it is in the trash, and who last renamed it, " +
        "changed its tempo, made it or deleted it here (null for РЭХА); and each take moved to another song here " +
        "that РЭХА has not numbered there yet. РЭХА asks at its check.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders },
      responses: {
        200: json(
          z.object({
            songs: z.array(
              z.object({
                id: z.number(),
                title: z.string(),
                tempo: z.number().nullable(),
                signature: Signature.nullable(),
                trashed: z.boolean(),
                title_by: z.string().nullable(),
                meter_by: z.string().nullable(),
                made_by: z.string().nullable(),
                trashed_by: z.string().nullable(),
              })
            ),
            moved: z.array(z.object({ uid: z.string(), song_id: z.number().nullable(), by: z.string() })),
          })
        ),
        ...errors(401, 426),
      },
    }),
    async (c) => {
      const db = database(c.env)
      const [songs, moved, members] = await db.batch([
        db.select().from(song),
        db.select({ uid: take.uid, songId: take.songId, by: take.movedBy }).from(take).where(isNotNull(take.movedBy)),
        db.select({ id: user.id, name: user.name, email: user.email }).from(user),
      ])
      const names = new Map(members.map((u) => [u.id, shownName(u.name, u.email)]))
      const who = (id: string | null) => (id === null ? null : (names.get(id) ?? null))
      return c.json(
        {
          songs: songs.map((s) => ({
            id: s.id,
            title: s.title,
            tempo: s.tempo,
            signature: s.signature as Signature | null,
            trashed: s.trashedAt !== null,
            title_by: who(s.titleBy),
            meter_by: who(s.meterBy),
            made_by: who(s.madeBy),
            trashed_by: who(s.trashedBy),
          })),
          moved: moved.map((t) => ({ uid: t.uid, song_id: t.songId, by: who(t.by) ?? "" })),
        },
        200
      )
    }
  )

