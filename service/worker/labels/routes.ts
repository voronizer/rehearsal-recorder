import { createRoute, z } from "@hono/zod-openapi"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { same } from "../shared/names"
import { body, errors, json, newApp, Ok } from "../shared/openapi"
import { comment, label } from "../shared/schema"
import { needMember } from "../signin/guards"
import { COLOURS } from "./match"

const NAME = "A label's name is 1 to 40 characters"
const NO_LABEL = "No such label"
export const ORDER = "The order names every one of them once"

const Name = z.string().trim().min(1, { error: NAME }).max(40, { error: NAME })
const Colour = z.enum(COLOURS, { error: "A label's colour is one of РЭХА's eight" })
const Id = z.object({ id: z.coerce.number().int().min(1) })

export const LabelView = z
  .object({ id: z.number(), name: z.string(), colour: Colour, position: z.number(), marks: z.number() })
  .openapi("Label")

const taken = (name: string) => `There is already a label called “${name}”.`

/** `ids` is `all` in some order, each once. */
export const isOrder = (ids: number[], all: number[]) =>
  ids.length === all.length && new Set(ids).size === ids.length && ids.every((id) => all.includes(id))

/** The band's labels for marks, as РЭХА's Settings › Marks has them. Any member changes them. */
export const labelRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/labels",
      middleware: [needMember] as const,
      responses: { 200: json(z.array(LabelView)), ...errors(401) },
    }),
    async (c) => {
      const db = database(c.env)
      const rows = await db
        .select({ id: label.id, name: label.name, colour: label.colour, position: label.position, marks: sql<number>`count(${comment.id})` })
        .from(label)
        .leftJoin(comment, and(eq(comment.labelId, label.id), isNull(comment.parentId)))
        .groupBy(label.id)
        .orderBy(asc(label.position))
      return c.json(rows.map((r) => ({ ...r, colour: r.colour as z.infer<typeof Colour>, marks: Number(r.marks) })), 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/labels",
      description: "**New label**, at the end.",
      middleware: [needMember] as const,
      request: { body: body(z.object({ name: Name, colour: Colour })) },
      responses: { 200: json(LabelView), ...errors(400, 401, 409) },
    }),
    async (c) => {
      const db = database(c.env)
      const { name, colour } = c.req.valid("json")
      const all = await db.select().from(label).orderBy(asc(label.position))
      const clash = all.find((l) => same(l.name, name))
      if (clash) return fail(c, 409, taken(clash.name))
      const [made] = await db
        .insert(label)
        .values({ name, colour, position: (all.at(-1)?.position ?? -1) + 1 })
        .returning()
      return c.json({ id: made.id, name: made.name, colour, position: made.position, marks: 0 }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/labels/{id}",
      description: "A new name or colour. The old name is kept, so marks РЭХА sends under it find the label.",
      middleware: [needMember] as const,
      request: { params: Id, body: body(z.object({ name: Name.optional(), colour: Colour.optional() })) },
      responses: { 200: json(Ok), ...errors(400, 401, 404, 409) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const { name, colour } = c.req.valid("json")
      const [row] = await db.select().from(label).where(eq(label.id, id)).limit(1)
      if (!row) return fail(c, 404, NO_LABEL)
      let was = row.was
      if (name !== undefined && name !== row.name) {
        const clash = (await db.select().from(label)).find((l) => l.id !== id && same(l.name, name))
        if (clash) return fail(c, 409, taken(clash.name))
        was = [...was.filter((w) => !same(w, name) && !same(w, row.name)), row.name]
      }
      await db
        .update(label)
        .set({ ...(name !== undefined && { name, was }), ...(colour !== undefined && { colour }) })
        .where(eq(label.id, id))
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/labels/order",
      middleware: [needMember] as const,
      request: { body: body(z.object({ ids: z.array(z.int()) })) },
      responses: { 200: json(Ok), ...errors(400, 401) },
    }),
    async (c) => {
      const db = database(c.env)
      const { ids } = c.req.valid("json")
      const all = (await db.select({ id: label.id }).from(label)).map((l) => l.id)
      if (!isOrder(ids, all)) return fail(c, 400, ORDER)
      await db.batch(ids.map((id, position) => db.update(label).set({ position }).where(eq(label.id, id))) as never)
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/labels/{id}",
      description: "Deletes a label. Its marks get the label `to`, which also keeps its names.",
      middleware: [needMember] as const,
      request: { params: Id, body: { required: false, content: { "application/json": { schema: z.object({ to: z.int().optional() }) } } } },
      responses: { 200: json(Ok), ...errors(400, 401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const to = (await c.req.json().catch(() => ({}))).to as number | undefined
      const all = await db.select().from(label).orderBy(asc(label.position))
      const gone = all.find((l) => l.id === id)
      if (!gone) return fail(c, 404, NO_LABEL)
      if (all.length === 1) return fail(c, 400, "The band needs at least one label")
      const [used] = await db.select({ id: comment.id }).from(comment).where(eq(comment.labelId, id)).limit(1)
      const target = all.find((l) => l.id === to && l.id !== id)
      if (used && !target) return fail(c, 400, "Say which label its marks get")
      const rest = all.filter((l) => l.id !== id)
      await db.batch([
        ...(target
          ? [
              db.update(comment).set({ labelId: target.id }).where(eq(comment.labelId, id)),
              db
                .update(label)
                .set({ was: [...target.was, gone.name, ...gone.was].filter((w) => !same(w, target.name)) })
                .where(eq(label.id, target.id)),
            ]
          : []),
        db.delete(label).where(eq(label.id, id)),
        ...rest.map((l, position) => db.update(label).set({ position }).where(eq(label.id, l.id))),
      ] as never)
      return c.json({ ok: true as const }, 200)
    }
  )
