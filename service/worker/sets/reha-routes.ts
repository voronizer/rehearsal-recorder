import { createRoute, z } from "@hono/zod-openapi"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok, RehaHeaders } from "../shared/openapi"
import { user } from "../shared/schema"
import { needKey } from "../signin/guards"
import { shownName } from "../takes/rows"
import { SetName, SetSongs } from "./routes"
import { changeSet, findSet, linkSets, listSets, makeRehaSet, NO_SET, trashSet } from "./store"

const rehaKey = [{ rehaKey: [] }]
const Id = z.object({ id: z.coerce.number().int().min(1) })
const RehaSet = z.object({ name: SetName, songs: SetSongs })

/** The routes РЭХА calls with its key for the band's sets. */
export const rehaSetRoutes = newApp()
  .openapi(
    createRoute({
      method: "post",
      path: "/api/reha/sets/link",
      description:
        "РЭХА's first check with this service for sets: each of its sets, with its songs' numbers, gets its " +
        "number, in the same order. A set here with the name, whatever its case, is that set, and takes РЭХА's " +
        "spelling and songs; one that matches nothing is made. A set in the trash is left there. Asked again, it " +
        "gives the same numbers. A song the service does not have turns the whole of it down.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, body: body(z.object({ sets: z.array(RehaSet).max(1000) })) },
      responses: { 200: json(z.object({ ids: z.array(z.number()) })), ...errors(400, 401, 426) },
    }),
    async (c) => {
      const linked = await linkSets(database(c.env), c.req.valid("json").sets)
      if ("code" in linked) return fail(c, linked.code, linked.words)
      return c.json({ ids: linked.ids }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/reha/sets",
      description:
        "A set made in РЭХА: its number. A name a set here has, whatever its case, is that set, which takes " +
        "РЭХА's spelling and songs; otherwise a new set at the end of the list.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, body: body(RehaSet) },
      responses: { 200: json(z.object({ id: z.number() })), ...errors(400, 401, 426) },
    }),
    async (c) => {
      const made = await makeRehaSet(database(c.env), c.req.valid("json"))
      if ("code" in made) return fail(c, made.code, made.words)
      return c.json({ id: made.id }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/reha/sets/{id}",
      description:
        "A change made in РЭХА: the name, the songs in their new order, or both. A name another set here has is " +
        "turned down whole, saying so: РЭХА then gives its set another name and sends that. A set in the trash is " +
        "not found: РЭХА's change came after the band's delete, so РЭХА makes the set again and its change wins.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, params: Id, body: body(z.object({ name: SetName.optional(), songs: SetSongs.optional() })) },
      responses: { 200: json(Ok), ...errors(400, 401, 404, 409, 426) },
    }),
    async (c) => {
      const db = database(c.env)
      const s = await findSet(db, c.req.valid("param").id)
      if (!s || s.trashedAt) return fail(c, 404, NO_SET)
      const refused = await changeSet(db, s, c.req.valid("json"), null)
      if (refused) return fail(c, refused.code, refused.words)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/reha/sets/{id}",
      description: "A set deleted in РЭХА: to the trash here, where the band can put it back for 30 days.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders, params: Id },
      responses: { 200: json(Ok), ...errors(401, 404, 426) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      if (!(await findSet(db, id))) return fail(c, 404, NO_SET)
      await trashSet(db, id, null)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/reha/sets",
      description:
        "Every set in its order, with its number, name, songs' numbers, whether it is in the trash, and who made " +
        "it, last changed it and deleted it here, by name (null for РЭХА). A song in the trash is left out of its " +
        "sets. РЭХА asks at its check.",
      middleware: [needKey] as const,
      security: rehaKey,
      request: { headers: RehaHeaders },
      responses: {
        200: json(
          z.object({
            sets: z.array(
              z.object({
                id: z.number(),
                name: z.string(),
                songs: z.array(z.number()),
                trashed: z.boolean(),
                made_by: z.string().nullable(),
                changed_by: z.string().nullable(),
                trashed_by: z.string().nullable(),
              })
            ),
          })
        ),
        ...errors(401, 426),
      },
    }),
    async (c) => {
      const db = database(c.env)
      const [sets, members] = await Promise.all([
        listSets(db, { withTrashed: true }),
        db.select({ id: user.id, name: user.name, email: user.email }).from(user),
      ])
      const names = new Map(members.map((u) => [u.id, shownName(u.name, u.email)]))
      const who = (id: string | null) => (id === null ? null : (names.get(id) ?? null))
      return c.json(
        {
          sets: sets.map((s) => ({
            id: s.id,
            name: s.name,
            songs: s.songs,
            trashed: s.trashedAt !== null,
            made_by: who(s.madeBy),
            changed_by: who(s.changedBy),
            trashed_by: who(s.trashedBy),
          })),
        },
        200
      )
    }
  )
