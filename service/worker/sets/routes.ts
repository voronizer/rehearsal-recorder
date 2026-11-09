import { createRoute, z } from "@hono/zod-openapi"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok } from "../shared/openapi"
import { needMember } from "../signin/guards"
import { changeSet, findSet, listSets, makeBandSet, NAME, NAME_MAX, NO_SET, trashSet } from "./store"

const Id = z.object({ id: z.coerce.number().int().min(1) })
export const SetName = z.string().trim().min(1, { error: NAME }).max(NAME_MAX, { error: NAME })
/** A set's songs by their numbers, in order. */
export const SetSongs = z.array(z.int().min(1)).max(1000, { error: "A set has up to 1000 songs" })

const SetView = z.object({ id: z.number(), name: z.string(), songs: z.array(z.number()) }).openapi("Set")

/** The Sets section: the band's sets, made, renamed, given songs and deleted. Any member changes them. */
export const setRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/sets",
      description: "The sets in their order, each with its songs' numbers in order. A song in the trash is left out until it is back.",
      middleware: [needMember] as const,
      responses: { 200: json(z.object({ sets: z.array(SetView) })), ...errors(401) },
    }),
    async (c) => {
      const sets = await listSets(database(c.env))
      return c.json({ sets: sets.map((s) => ({ id: s.id, name: s.name, songs: s.songs })) }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/sets",
      description: "**New set**, at the end of the list, with no songs. A name another set has is turned down. It reaches РЭХА at its next check.",
      middleware: [needMember] as const,
      request: { body: body(z.object({ name: SetName })) },
      responses: { 200: json(z.object({ id: z.number() })), ...errors(400, 401, 409) },
    }),
    async (c) => {
      const made = await makeBandSet(database(c.env), c.req.valid("json").name, c.var.member.id)
      if ("code" in made) return fail(c, made.code, made.words)
      return c.json({ id: made.id }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/sets/{id}",
      description:
        "A set's new name, its songs in their new order, or both. A name another set has is turned down whole. " +
        "It reaches РЭХА at its next check.",
      middleware: [needMember] as const,
      request: { params: Id, body: body(z.object({ name: SetName.optional(), songs: SetSongs.optional() })) },
      responses: { 200: json(Ok), ...errors(400, 401, 404, 409) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const s = await findSet(db, id)
      // A page left open elsewhere cannot change one in the trash.
      if (!s || s.trashedAt) return fail(c, 404, NO_SET)
      const refused = await changeSet(db, s, c.req.valid("json"), c.var.member.id)
      if (refused) return fail(c, refused.code, refused.words)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/sets/{id}",
      description:
        "**Delete set**: to the trash, where anyone in the band can put it back for 30 days. Its songs stay as they " +
        "are. It goes from РЭХА at its next check.",
      middleware: [needMember] as const,
      request: { params: Id },
      responses: { 200: json(Ok), ...errors(401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      if (!(await findSet(db, id))) return fail(c, 404, NO_SET)
      // Someone whose page was behind pressed it again: it stays as it was.
      await trashSet(db, id, c.var.member.id)
      return c.json({ ok: true as const }, 200)
    }
  )
