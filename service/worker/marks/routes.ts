import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { tellChat } from "../chat/tell"
import { firstLabel } from "../labels/match"
import { database, type Database } from "../shared/db"
import type { AppEnv } from "../shared/env"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok } from "../shared/openapi"
import { comment, label, take } from "../shared/schema"
import { iso } from "../shared/time"
import { needMember } from "../signin/guards"
import { CommentView, loadMarks, MarkView } from "./view"

const NOTE = "A mark's note is up to 2000 characters"
const TEXT = "A comment is 1 to 2000 characters"
const AT = "A mark's moment is within the take"
const NO_LABEL = "No such label"
const NO_MARK = "No such mark"
const NO_COMMENT = "No such comment"
export const NOT_YOURS = "Only who wrote it can change it"
export const FROM_REHA = "A mark from РЭХА follows РЭХА"

const Id = z.object({ id: z.coerce.number().int().min(1) })
const Note = z.string().trim().max(2000, { error: NOTE })
const Text = z.string().trim().min(1, { error: TEXT }).max(2000, { error: TEXT })

const labelExists = async (db: Database, id: number) =>
  (await db.select({ id: label.id }).from(label).where(eq(label.id, id)).limit(1)).length > 0

/** The mark (`parent`: false) or comment (true) with this id, or undefined. */
const row = async (db: Database, id: number, isComment: boolean) =>
  (
    await db
      .select()
      .from(comment)
      .where(and(eq(comment.id, id), isComment ? isNotNull(comment.parentId) : isNull(comment.parentId)))
      .limit(1)
  )[0]

/** Why `me` may not change this mark or comment, or null when they may. */
const refusal = (c: Context<AppEnv>, r: typeof comment.$inferSelect) =>
  r.fromReha ? fail(c, 403, FROM_REHA) : r.memberId !== c.var.member.id ? fail(c, 403, NOT_YOURS) : null

const origin = (c: Context) => new URL(c.req.url).origin

/** Marks on takes, the comments under them, and closing them. */
export const markRoutes = newApp()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/marks",
      description: "The Marks section: open, closed or all, with how many of each.",
      middleware: [needMember] as const,
      request: { query: z.object({ show: z.enum(["open", "closed", "all"]).default("open") }) },
      responses: {
        200: json(z.object({ counts: z.object({ open: z.number(), closed: z.number(), all: z.number() }), marks: z.array(MarkView) })),
        ...errors(401),
      },
    }),
    async (c) => {
      const all = await loadMarks(database(c.env), c.var.member.id, isNull(take.trashedAt))
      const { show } = c.req.valid("query")
      const open = all.filter((m) => !m.closed)
      return c.json(
        {
          counts: { open: open.length, closed: all.length - open.length, all: all.length },
          marks: show === "all" ? all : show === "open" ? open : all.filter((m) => m.closed),
        },
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/takes/{uid}/marks",
      description: "**Add mark**: at a moment, with a label (the first when none is said) and a note.",
      middleware: [needMember] as const,
      request: {
        params: z.object({ uid: z.uuid() }),
        body: body(z.object({ at: z.number().min(0, { error: AT }), label_id: z.int().optional(), note: Note })),
      },
      responses: { 200: json(MarkView), ...errors(400, 401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      const { at, label_id, note } = c.req.valid("json")
      const [t] = await db
        .select()
        .from(take)
        .where(and(eq(take.uid, uid), isNotNull(take.shownGen), isNull(take.trashedAt)))
        .limit(1)
      if (!t) return fail(c, 404, "No such take")
      // While a newer generation is on its way, the length on record is its
      // own, and the band still hears the older one: no end to check then.
      if (t.gen === t.shownGen && at > t.durationSec) return fail(c, 400, AT)
      if (label_id !== undefined && !(await labelExists(db, label_id))) return fail(c, 400, NO_LABEL)
      const [made] = await db
        .insert(comment)
        .values({ takeUid: uid, memberId: c.var.member.id, at, text: note, labelId: label_id ?? (await firstLabel(db)), createdAt: iso() })
        .returning({ id: comment.id })
      await tellChat(c.env, { kind: "mark", mark_id: made.id, origin: origin(c) })
      const [view] = await loadMarks(db, c.var.member.id, eq(comment.id, made.id))
      return c.json(view, 200)
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/marks/{id}",
      description: "A mark's label and note, by who set it; **Close** and **Open again**, by anyone.",
      middleware: [needMember] as const,
      request: {
        params: Id,
        body: body(z.object({ label_id: z.int().optional(), note: Note.optional(), closed: z.boolean().optional() })),
      },
      responses: { 200: json(Ok), ...errors(400, 401, 403, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const { label_id, note, closed } = c.req.valid("json")
      const mark = await row(db, id, false)
      if (!mark) return fail(c, 404, NO_MARK)
      const words = label_id !== undefined || note !== undefined
      if (words) {
        const no = refusal(c, mark)
        if (no) return no
        if (label_id !== undefined && !(await labelExists(db, label_id))) return fail(c, 400, NO_LABEL)
      }
      await db
        .update(comment)
        .set({
          ...(label_id !== undefined && { labelId: label_id }),
          ...(note !== undefined && { text: note }),
          ...(closed !== undefined && { closed }),
          ...(words && { updatedAt: iso() }),
        })
        .where(eq(comment.id, id))
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/marks/{id}",
      description: "Deletes a mark and the comments under it, by who set it.",
      middleware: [needMember] as const,
      request: { params: Id },
      responses: { 200: json(Ok), ...errors(401, 403, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const mark = await row(db, id, false)
      if (!mark) return fail(c, 404, NO_MARK)
      const no = refusal(c, mark)
      if (no) return no
      await db.batch([db.delete(comment).where(eq(comment.parentId, id)), db.delete(comment).where(eq(comment.id, id))])
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/marks/{id}/comments",
      description: "**Comment** under a mark.",
      middleware: [needMember] as const,
      request: { params: Id, body: body(z.object({ text: Text })) },
      responses: { 200: json(CommentView), ...errors(400, 401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const mark = await row(db, id, false)
      if (!mark) return fail(c, 404, NO_MARK)
      const [made] = await db
        .insert(comment)
        .values({
          takeUid: mark.takeUid,
          parentId: id,
          memberId: c.var.member.id,
          at: mark.at,
          text: c.req.valid("json").text,
          createdAt: iso(),
        })
        .returning()
      await tellChat(c.env, { kind: "comment", comment_id: made.id, origin: origin(c) })
      const { name, email, id: me } = c.var.member
      return c.json(
        {
          id: made.id,
          author: name || email,
          initial: (Array.from((name || email).trim())[0] ?? "?").toUpperCase(),
          member_id: me,
          text: made.text,
          created_at: made.createdAt,
          updated_at: null,
          mine: true,
        },
        200
      )
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/comments/{id}",
      description: "A comment's words, by who wrote it.",
      middleware: [needMember] as const,
      request: { params: Id, body: body(z.object({ text: Text })) },
      responses: { 200: json(Ok), ...errors(400, 401, 403, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const said = await row(db, id, true)
      if (!said) return fail(c, 404, NO_COMMENT)
      const no = refusal(c, said)
      if (no) return no
      await db.update(comment).set({ text: c.req.valid("json").text, updatedAt: iso() }).where(eq(comment.id, id))
      return c.json({ ok: true as const }, 200)
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/comments/{id}",
      description: "Deletes a comment, by who wrote it.",
      middleware: [needMember] as const,
      request: { params: Id },
      responses: { 200: json(Ok), ...errors(401, 403, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const { id } = c.req.valid("param")
      const said = await row(db, id, true)
      if (!said) return fail(c, 404, NO_COMMENT)
      const no = refusal(c, said)
      if (no) return no
      await db.delete(comment).where(eq(comment.id, id))
      return c.json({ ok: true as const }, 200)
    }
  )
