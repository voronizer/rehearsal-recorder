import { createRoute, z } from "@hono/zod-openapi"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok, RehaHeaders } from "../shared/openapi"
import { take } from "../shared/schema"
import { needKey } from "../signin/guards"
import { Drift, TakeMeta } from "./meta"
import { putDrift, putTake, ready, trash } from "./store"

const Params = z.object({ uid: z.uuid() })
const NO_SONG = "No such song"
const rehaKey = [{ rehaKey: [] }]

/** The routes РЭХА calls with its key, for a take and its details. */
export const rehaRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/reha/hello",
      description: "РЭХА checks a key when it is pasted.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders },
      responses: { 200: json(Ok), ...errors(401, 426) },
    }),
    (c) => c.json({ ok: true as const }, 200)
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/reha/takes/{uid}",
      description:
        "A take's details: made, or brought up to date. A take РЭХА removed comes out of the trash; " +
        "one the band deleted, or one that went with its song, only when sent `by_hand`. " +
        "Its song and name come only when РЭХА changed them, and the first time; left out, the take keeps " +
        "what it has here. `in_trash` says it is still there; `drift_gen` is the generation whose tempo the " +
        "service has; `song_id` is its song's number; `kind: true` says the service keeps a track's `kind`. 409 for a song number the service does not have.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, params: Params, body: body(TakeMeta) },
      responses: {
        200: json(
          z.object({ ok: z.literal(true), in_trash: z.boolean(), drift_gen: z.number().nullable(), song_id: z.number().nullable(), kind: z.literal(true) })
        ),
        ...errors(400, 401, 409, 426),
      },
    }),
    async (c) => {
      const done = await putTake(c.env, c.req.valid("param").uid, c.req.valid("json"))
      if (done === "no song") return fail(c, 409, NO_SONG)
      if (done === "no name") return fail(c, 400, "A new take comes with its name and song")
      return c.json({ ok: true as const, in_trash: done.inTrash, drift_gen: done.driftGen, song_id: done.songId, kind: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/reha/takes/{uid}/drift",
      description:
        "The band's tempo through a generation of the take, for the line along Master's lane, or why it has none. " +
        "РЭХА counts it once the take's files are up. One for a generation РЭХА has moved on from is not kept.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, params: Params, body: body(z.object({ gen: z.int().min(1), drift: Drift })) },
      responses: { 200: json(Ok), ...errors(400, 401, 404, 426) },
    }),
    async (c) => {
      const { gen, drift } = c.req.valid("json")
      const done = await putDrift(c.env, c.req.valid("param").uid, gen, drift)
      if (done === "no take") return fail(c, 404, "No such take")
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/reha/takes",
      description:
        "Every take the service has: whether it is in the trash, which generation's MP3s and FLAC files are up, " +
        "and which generation's tempo it has. РЭХА asks when it starts and every hour, to learn what the band " +
        "deleted or put back, and which takes still need their tempo.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders },
      responses: {
        200: json(
          z.array(
            z.object({
              uid: z.string(),
              trashed: z.boolean(),
              mp3_gen: z.number().nullable(),
              flac_gen: z.number().nullable(),
              drift_gen: z.number().nullable(),
            })
          )
        ),
        ...errors(401, 426),
      },
    }),
    async (c) => {
      const rows = await database(c.env)
        .select({ uid: take.uid, trashedAt: take.trashedAt, shownGen: take.shownGen, flacGen: take.flacGen, driftGen: take.driftGen })
        .from(take)
      return c.json(
        rows.map((t) => ({
          uid: t.uid,
          trashed: t.trashedAt !== null,
          mp3_gen: t.shownGen,
          flac_gen: t.flacGen,
          drift_gen: t.driftGen,
        })),
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/reha/takes/{uid}/ready",
      description: "All of a generation's MP3s, or all its FLAC files, are up.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: {
        headers: RehaHeaders,
        params: Params,
        body: body(z.object({ gen: z.int().min(1), what: z.enum(["mp3", "flac"]) })),
      },
      responses: { 200: json(Ok), ...errors(400, 401, 404, 426) },
    }),
    async (c) => {
      const { gen, what } = c.req.valid("json")
      const done = await ready(c.env, c.req.valid("param").uid, gen, what, new URL(c.req.url).origin)
      if (done === "no take") return fail(c, 404, "No such take")
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/reha/takes/{uid}",
      description: "The take goes to the trash.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, params: Params },
      responses: { 200: json(Ok), ...errors(400, 401, 426) },
    }),
    async (c) => {
      await trash(c.env, c.req.valid("param").uid)
      return c.json({ ok: true as const }, 200)
    }
  )
