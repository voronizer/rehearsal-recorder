import { createRoute, z } from "@hono/zod-openapi"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok, RehaHeaders } from "../shared/openapi"
import { needKey } from "../signin/guards"
import { TakeMeta } from "./meta"
import { putTake, ready, trash } from "./store"

const Params = z.object({ uid: z.uuid() })
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
      description: "A take's details: made, or brought up to date. A take in the trash comes out of it.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, params: Params, body: body(TakeMeta) },
      responses: { 200: json(Ok), ...errors(400, 401, 426) },
    }),
    async (c) => {
      await putTake(c.env, c.req.valid("param").uid, c.req.valid("json"))
      return c.json({ ok: true as const }, 200)
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
