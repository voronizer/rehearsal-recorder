import { createRoute, z } from "@hono/zod-openapi"
import { type SQL, and, desc, eq, isNotNull, isNull } from "drizzle-orm"
import { database, type Database } from "../shared/db"
import { fail } from "../shared/errors"
import { Ok, body, errors, json, newApp } from "../shared/openapi"
import { shareLink, take, user } from "../shared/schema"
import { iso, now } from "../shared/time"
import { sizeOf } from "../songs/files"
import { shownName, waits } from "../takes/rows"
import { needMember } from "../signin/guards"
import { Heard, deleteLink, endOf, isOpen, newLinkId } from "./store"

const MIX_AND_TRACKS = "A link that shows only the mix cannot let download the tracks."
/** A mix link's MP3: a 55-minute take at the best VBR is about this. */
const MAX_MIX = 100 * 1024 * 1024
const PEAKS = 1200

const Shows = z.enum(["mix", "tracks", "marks"])
const Takes = z.enum(["none", "mix", "all"])
const Lasts = z.enum(["never", "month", "week", "day"])

const NewLink = z
  .object({
    for: z.string().trim().max(60, { error: "Who it is for is at most 60 characters" }).default(""),
    shows: Shows,
    download: Takes,
    lasts: Lasts,
    heard: Heard.optional(),
    peaks: z.array(z.number().min(0).max(1)).optional(),
  })
  .openapi("NewLink")

export const LinkItem = z
  .object({
    id: z.string(),
    take: z.object({ uid: z.string(), name: z.string(), song_id: z.number().nullable(), moved: z.boolean() }),
    by: z.string(),
    made_at: z.string(),
    for: z.string(),
    shows: Shows,
    download: Takes,
    until: z.string().nullable(),
    plays: z.number(),
    last_played_at: z.string().nullable(),
  })
  .openapi("LinkItem")
type LinkItem = z.infer<typeof LinkItem>

/** The links `where` picks, newest first. */
async function linkItems(db: Database, where: SQL | undefined): Promise<LinkItem[]> {
  const rows = await db
    .select({ link: shareLink, take: { uid: take.uid, name: take.name, songId: take.songId, movedBy: take.movedBy }, name: user.name, email: user.email })
    .from(shareLink)
    .innerJoin(take, eq(shareLink.takeUid, take.uid))
    .innerJoin(user, eq(shareLink.madeBy, user.id))
    .where(where)
    .orderBy(desc(shareLink.madeAt), desc(shareLink.id))
  return rows.map(({ link, take: t, name, email }) => ({
    id: link.id,
    take: { uid: t.uid, name: t.name, song_id: t.songId, moved: waits(t) },
    by: shownName(name, email),
    made_at: link.madeAt,
    for: link.forWhom,
    shows: link.shows,
    download: link.download,
    until: link.until,
    plays: link.plays,
    last_played_at: link.lastPlayedAt,
  }))
}

const Id = z.object({ id: z.string().min(1).max(64) })

/** Links to a take for someone outside the band: made, listed and closed by any member. */
export const linkRoutes = newApp()
  .openapi(
    createRoute({
      method: "post",
      path: "/api/takes/{uid}/links",
      description:
        "**Make link**: a link to the take for someone outside the band. A link with tracks carries the maker's `heard` and is open at once. A link that shows only the mix carries its wave in `peaks` (1200 numbers) and opens once its MP3 is sent to `/api/links/{id}/mix`.",
      middleware: [needMember] as const,
      request: { params: z.object({ uid: z.uuid() }), body: body(NewLink) },
      responses: { 200: json(LinkItem), ...errors(400, 401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { uid } = c.req.valid("param")
      const asked = c.req.valid("json")
      const mix = asked.shows === "mix"
      if (mix && asked.download === "all") return fail(c, 400, MIX_AND_TRACKS)
      if (mix && asked.peaks?.length !== PEAKS) return fail(c, 400, `A link with the mix alone needs its wave, ${PEAKS} numbers`)
      if (!mix && !asked.heard) return fail(c, 400, "A link with tracks needs the levels, M and S it plays at")
      const [t] = await db
        .select({ shownGen: take.shownGen })
        .from(take)
        .where(and(eq(take.uid, uid), isNotNull(take.shownGen), isNull(take.trashedAt)))
        .limit(1)
      if (!t) return fail(c, 404, "No such take")
      const id = newLinkId()
      const at = now()
      if (mix) {
        await c.env.FILES.put(`links/${id}/mix.peaks`, JSON.stringify({ peaks: asked.peaks }), {
          httpMetadata: { contentType: "application/json" },
        })
      }
      await db.insert(shareLink).values({
        id,
        takeUid: uid,
        madeBy: c.var.member.id,
        madeAt: iso(at),
        forWhom: asked.for,
        shows: asked.shows,
        download: asked.download,
        until: endOf(asked.lasts, at),
        heard: mix ? null : asked.heard!,
        mixGen: mix ? t.shownGen : null,
        ready: !mix,
      })
      const [item] = await linkItems(db, eq(shareLink.id, id))
      return c.json(item, 200)
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/links/{id}/mix",
      description:
        "The MP3 of a link that shows only the mix, as the body, up to 100 MB. Only the member who made the link sends it, once; the link opens after.",
      middleware: [needMember] as const,
      request: { params: Id },
      responses: { 200: json(LinkItem), ...errors(400, 401, 404, 413) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const size = sizeOf(c)
      if (size === null) return fail(c, 400, "Send the file's size")
      if (size > MAX_MIX) return fail(c, 413, "The mix is over 100 MB")
      const [link] = await db
        .select({ id: shareLink.id })
        .from(shareLink)
        .where(and(eq(shareLink.id, id), eq(shareLink.shows, "mix"), eq(shareLink.ready, false), eq(shareLink.madeBy, c.var.member.id)))
        .limit(1)
      if (!link) return fail(c, 404, "No such link")
      await c.env.FILES.put(`links/${id}/mix.mp3`, c.req.raw.body ?? new Uint8Array(), { httpMetadata: { contentType: "audio/mpeg" } })
      await db.update(shareLink).set({ ready: true }).where(eq(shareLink.id, id))
      const [item] = await linkItems(db, and(eq(shareLink.id, id), isOpen()))
      if (!item) return fail(c, 404, "No such link")
      return c.json(item, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/links",
      description: "Every open link of the band, newest first.",
      middleware: [needMember] as const,
      responses: { 200: json(z.array(LinkItem)), ...errors(401) },
    }),
    async (c) => c.json(await linkItems(database(c.env), isOpen()), 200)
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/links/{id}",
      description: "**Close link**: any member closes any link, with its mix. A link already closed answers the same.",
      middleware: [needMember] as const,
      request: { params: Id },
      responses: { 200: json(Ok), ...errors(401) },
    }),
    async (c) => {
      await deleteLink(c.env, c.req.valid("param").id)
      return c.json({ ok: true as const }, 200)
    }
  )
