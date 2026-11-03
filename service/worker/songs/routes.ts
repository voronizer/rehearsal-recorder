import { createRoute, z } from "@hono/zod-openapi"
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { firstStatus } from "../labels/match"
import { isOrder, ORDER } from "../labels/routes"
import { database, type Database } from "../shared/db"
import { fail } from "../shared/errors"
import { same } from "../shared/names"
import type { Bindings } from "../shared/env"
import { KEYS } from "../shared/keys"
import { body, errors, json, newApp, Ok } from "../shared/openapi"
import { song, songFile, status, take } from "../shared/schema"
import { iso } from "../shared/time"
import { needMember } from "../signin/guards"
import { deleteFiles } from "../takes/purge"
import { toTrash } from "../takes/store"
import { bare, best, bestWhy, takeRows, TakeRow, type Loaded } from "../takes/rows"
import { FileView, fileViews } from "./files"

const TITLE = "A song's title is 1 to 100 characters"
const STATUS = "A status's name is 1 to 40 characters"
const NO_SONG = "No such song"
const NO_STATUS = "No such status"

const Id = z.object({ id: z.coerce.number().int().min(1) })
const Status = z.object({ id: z.number(), name: z.string(), position: z.number(), songs: z.number() }).openapi("Status")

export const SongItem = z
  .object({
    id: z.number(),
    title: z.string(),
    status_id: z.number(),
    key: z.string().nullable(),
    /** Beats per minute, from РЭХА. */
    tempo: z.number().nullable(),
    takes: z.number(),
    rehearsals: z.number(),
    last_date: z.string().nullable(),
    /** The best take's length. */
    length: z.number().nullable(),
    best: TakeRow.nullable(),
    best_why: z.enum(["most stars", "latest"]).nullable(),
    created_at: z.string().nullable(),
  })
  .openapi("SongItem")

type SongRowDb = typeof song.$inferSelect

/** A song's line for the table, from its takes (newest first). */
function item(s: SongRowDb, rows: Loaded[], first: number): z.infer<typeof SongItem> {
  const top = best(rows)
  return {
    id: s.id,
    title: s.title,
    status_id: s.statusId ?? first,
    key: s.key,
    tempo: s.tempo,
    takes: rows.length,
    rehearsals: new Set(rows.map((r) => r.rehearsal_uid)).size,
    last_date: rows[0]?.date ?? null,
    length: top?.duration_sec ?? null,
    best: top && bare(top),
    best_why: bestWhy(top),
    created_at: s.createdAt,
  }
}

/** Every song as the table lists it, by status; the last played first, then the newest made. Songs in the trash are left out. */
export async function songItems(env: Bindings) {
  const db = database(env)
  const [songs, statuses, rows] = await Promise.all([
    db.select().from(song).where(isNull(song.trashedAt)),
    db.select().from(status).orderBy(asc(status.position)),
    takeRows(env, isNull(take.trashedAt)),
  ])
  const first = statuses[0].id
  const items = songs
    .map((s) => item(s, rows.filter((r) => r.song_id === s.id), first))
    .sort(
      (a, b) =>
        (b.last_date ?? "").localeCompare(a.last_date ?? "") ||
        (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
        a.title.localeCompare(b.title)
    )
  return { items, statuses, rows }
}

const titleTaken = async (db: Database, title: string, except?: number) =>
  (await db.select({ id: song.id, title: song.title, trashedAt: song.trashedAt }).from(song)).find(
    (s) => s.id !== except && same(s.title, title)
  )

/** The song the band has, or undefined: one in the trash is not there. */
export async function liveSong(db: Database, id: number) {
  const [s] = await db
    .select()
    .from(song)
    .where(and(eq(song.id, id), isNull(song.trashedAt)))
    .limit(1)
  return s
}

/** The Songs section, a song, its status, key and notes, and the band's statuses. */
export const songRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/songs",
      middleware: [needMember] as const,
      responses: {
        200: json(z.object({ statuses: z.array(Status), songs: z.array(SongItem), not_named: z.array(TakeRow) })),
        ...errors(401),
      },
    }),
    async (c) => {
      const { items, statuses, rows } = await songItems(c.env)
      return c.json(
        {
          statuses: statuses.map((s) => ({ ...s, songs: items.filter((i) => i.status_id === s.id).length })),
          songs: items,
          not_named: rows.filter((r) => r.song_id === null).map(bare),
        },
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/songs",
      description: "**New song**, before its first take, with the first status.",
      middleware: [needMember] as const,
      request: { body: body(z.object({ title: z.string().trim().min(1, { error: TITLE }).max(100, { error: TITLE }) })) },
      responses: { 200: json(z.object({ id: z.number() })), ...errors(400, 401, 409) },
    }),
    async (c) => {
      const db = database(c.env)
      const { title } = c.req.valid("json")
      const clash = await titleTaken(db, title)
      if (clash?.trashedAt) return fail(c, 409, `“${clash.title}” is in the Trash. Restore it there.`)
      if (clash) return fail(c, 409, `There is already a song called “${clash.title}”.`)
      const [made] = await db
        .insert(song)
        .values({ title, statusId: await firstStatus(db), createdAt: iso() })
        .returning({ id: song.id })
      return c.json({ id: made.id }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/songs/{id}",
      description: "A song's panel and page: its facts, notes, files and takes.",
      middleware: [needMember] as const,
      request: { params: Id },
      responses: {
        200: json(
          z.object({
            /** Its takes in the trash, and its takes whose MP3s are still on their way:
             *  Delete song's question counts on them. */
            song: SongItem.extend({ notes: z.string(), trashed_takes: z.number(), coming_takes: z.number() }),
            takes: z.array(TakeRow),
            files: z.array(FileView),
          })
        ),
        ...errors(401, 404),
      },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const s = await liveSong(db, id)
      if (!s) return fail(c, 404, NO_SONG)
      const [rows, first, files, [trashed], [coming]] = await Promise.all([
        takeRows(c.env, and(isNull(take.trashedAt), eq(take.songId, id))),
        firstStatus(db),
        fileViews(db, id),
        db
          .select({ n: count() })
          .from(take)
          .where(and(eq(take.songId, id), isNotNull(take.shownGen), isNotNull(take.trashedAt))),
        db
          .select({ n: count() })
          .from(take)
          .where(and(eq(take.songId, id), isNull(take.shownGen), isNull(take.trashedAt))),
      ])
      return c.json(
        {
          song: { ...item(s, rows, first), notes: s.notes, trashed_takes: trashed.n, coming_takes: coming.n },
          takes: rows.map(bare),
          files,
        },
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/songs/{id}",
      description: "A song's status, key and notes. Its title comes from РЭХА.",
      middleware: [needMember] as const,
      request: {
        params: Id,
        body: body(
          z.object({
            status_id: z.int().optional(),
            key: z.enum(KEYS as [string, ...string[]], { error: "A key is one of the 24, such as “E minor”" }).nullable().optional(),
            notes: z.string().max(10_000, { error: "Notes are up to 10,000 characters" }).optional(),
          })
        ),
      },
      responses: { 200: json(Ok), ...errors(400, 401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const { status_id, key, notes } = c.req.valid("json")
      if (!(await liveSong(db, id))) return fail(c, 404, NO_SONG)
      if (status_id !== undefined && !(await db.select().from(status).where(eq(status.id, status_id))).length)
        return fail(c, 400, NO_STATUS)
      const change = {
        ...(status_id !== undefined && { statusId: status_id }),
        ...(key !== undefined && { key }),
        ...(notes !== undefined && { notes: notes.trim() }),
      }
      if (Object.keys(change).length) await db.update(song).set(change).where(eq(song.id, id))
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/songs/{id}",
      description:
        "**Delete song**: a song with takes, in the trash or not, goes to the trash with the ones that are not; " +
        "one that never had a take is deleted at once, with its files.",
      middleware: [needMember] as const,
      request: { params: Id },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const [s] = await db.select({ id: song.id, trashedAt: song.trashedAt }).from(song).where(eq(song.id, id)).limit(1)
      if (!s) return fail(c, 404, NO_SONG)
      // Someone whose page was behind pressed it again.
      if (s.trashedAt) return c.json({ ok: true as const }, 200)
      const [one] = await db.select({ uid: take.uid }).from(take).where(eq(take.songId, id)).limit(1)
      if (one) {
        const at = iso()
        const me = c.var.member.id
        await db.batch([
          db.update(song).set({ trashedAt: at, trashedBy: me }).where(eq(song.id, id)),
          toTrash(db, eq(take.songId, id), me, true, at),
        ])
        return c.json({ ok: true as const }, 200)
      }
      await db.batch([db.delete(songFile).where(eq(songFile.songId, id)), db.delete(song).where(eq(song.id, id))])
      await deleteFiles(c.env, `songs/${id}/`, () => true)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/statuses",
      description: "**New status**, at the end.",
      middleware: [needMember] as const,
      request: { body: body(z.object({ name: z.string().trim().min(1, { error: STATUS }).max(40, { error: STATUS }) })) },
      responses: { 200: json(Status), ...errors(400, 401, 409) },
    }),
    async (c) => {
      const db = database(c.env)
      const { name } = c.req.valid("json")
      const all = await db.select().from(status).orderBy(asc(status.position))
      const clash = all.find((s) => same(s.name, name))
      if (clash) return fail(c, 409, `There is already a status called “${clash.name}”.`)
      const [made] = await db
        .insert(status)
        .values({ name, position: (all.at(-1)?.position ?? -1) + 1 })
        .returning()
      return c.json({ ...made, songs: 0 }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/statuses/{id}",
      description: "A status's new name: its songs follow.",
      middleware: [needMember] as const,
      request: { params: Id, body: body(z.object({ name: z.string().trim().min(1, { error: STATUS }).max(40, { error: STATUS }) })) },
      responses: { 200: json(Ok), ...errors(400, 401, 404, 409) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const { name } = c.req.valid("json")
      const all = await db.select().from(status)
      if (!all.some((s) => s.id === id)) return fail(c, 404, NO_STATUS)
      const clash = all.find((s) => s.id !== id && same(s.name, name))
      if (clash) return fail(c, 409, `There is already a status called “${clash.name}”.`)
      await db.update(status).set({ name }).where(eq(status.id, id))
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/statuses/order",
      middleware: [needMember] as const,
      request: { body: body(z.object({ ids: z.array(z.int()) })) },
      responses: { 200: json(Ok), ...errors(400, 401) },
    }),
    async (c) => {
      const db = database(c.env)
      const { ids } = c.req.valid("json")
      const all = (await db.select({ id: status.id }).from(status)).map((s) => s.id)
      if (!isOrder(ids, all)) return fail(c, 400, ORDER)
      await db.batch(ids.map((id, position) => db.update(status).set({ position }).where(eq(status.id, id))) as never)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/statuses/{id}",
      description: "Deletes a status; its songs get the status `to`.",
      middleware: [needMember] as const,
      request: { params: Id, body: { required: false, content: { "application/json": { schema: z.object({ to: z.int().optional() }) } } } },
      responses: { 200: json(Ok), ...errors(400, 401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const to = (await c.req.json().catch(() => ({}))).to as number | undefined
      const all = await db.select().from(status).orderBy(asc(status.position))
      if (!all.some((s) => s.id === id)) return fail(c, 404, NO_STATUS)
      if (all.length === 1) return fail(c, 400, "The band needs at least one status")
      const first = all[0].id
      // A song with no status is in the first.
      const mine = id === first ? sql`(${song.statusId} = ${id} OR ${song.statusId} IS NULL)` : eq(song.statusId, id)
      // Songs in the trash are not counted; they go to the status named, or the first left.
      const [used] = await db
        .select({ id: song.id })
        .from(song)
        .where(and(mine, isNull(song.trashedAt)))
        .limit(1)
      const target = all.find((s) => s.id === to && s.id !== id)
      if (used && !target) return fail(c, 400, "Say which status its songs get")
      const rest = all.filter((s) => s.id !== id)
      await db.batch([
        db.update(song).set({ statusId: (target ?? rest[0]).id }).where(mine),
        db.delete(status).where(eq(status.id, id)),
        ...rest.map((s, position) => db.update(status).set({ position }).where(eq(status.id, s.id))),
      ] as never)
      return c.json({ ok: true as const }, 200)
    }
  )
