import { createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { tellChat } from "../chat/tell"
import { database } from "../shared/db"
import { fail } from "../shared/errors"
import { body, errors, json, newApp, Ok } from "../shared/openapi"
import { comment, take } from "../shared/schema"
import { iso } from "../shared/time"
import { needMember } from "../signin/guards"
import { CommentView, commentView } from "./view"

const TEXT = "A comment is 1 to 2000 characters"
const AT = "A comment's moment is within the take"

/** Comments at a moment of a take, their replies, and closing them. */
export const commentRoutes = newApp()
  .openapi(
    createRoute({
      method: "post",
      path: "/api/takes/{uid}/comments",
      description: "**Comment at 1:42**. A reply takes its parent's moment.",
      middleware: [needMember] as const,
      request: {
        params: z.object({ uid: z.uuid() }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({
                at: z.number().min(0, { error: AT }),
                text: z.string().trim().min(1, { error: TEXT }).max(2000, { error: TEXT }),
                parent_id: z.int().optional(),
              }),
            },
          },
        },
      },
      responses: { 200: json(CommentView), ...errors(400, 401, 404) },
    }),
    async (c) => {
      const db = database(c.env)
      const uid = c.req.valid("param").uid
      const { at, text, parent_id } = c.req.valid("json")
      const [t] = await db
        .select()
        .from(take)
        .where(and(eq(take.uid, uid), isNotNull(take.shownGen), isNull(take.trashedAt)))
        .limit(1)
      if (!t) return fail(c, 404, "No such take")
      let parentId: number | null = null
      let moment = at
      if (parent_id !== undefined) {
        const [parent] = await db
          .select()
          .from(comment)
          .where(and(eq(comment.id, parent_id), eq(comment.takeUid, uid)))
          .limit(1)
        if (!parent) return fail(c, 400, "No such comment on this take")
        // Replies hang off the first comment of their thread.
        parentId = parent.parentId ?? parent.id
        moment = parent.at
      } else if (t.gen === t.shownGen && at > t.durationSec) return fail(c, 400, AT)
      // While a newer generation is on its way, the length on record is its
      // own, and the band still hears the older one: no end to check then.
      const [made] = await db
        .insert(comment)
        .values({ takeUid: uid, parentId, memberId: c.var.member.id, at: moment, text, createdAt: iso() })
        .returning()
      await tellChat(c.env, { kind: "comment", comment_id: made.id, origin: new URL(c.req.url).origin })
      const { name, email } = c.var.member
      return c.json(commentView({ ...made, name, email }), 200)
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/comments/{id}",
      description: "Closed when the place is fixed: greyed, and kept in the list.",
      middleware: [needMember] as const,
      request: {
        params: z.object({ id: z.coerce.number().int().min(1) }),
        body: body(z.object({ closed: z.boolean() })),
      },
      responses: { 200: json(Ok), ...errors(400, 401, 404) },
    }),
    async (c) => {
      const changed = await database(c.env)
        .update(comment)
        .set({ closed: c.req.valid("json").closed })
        .where(eq(comment.id, c.req.valid("param").id))
        .returning({ id: comment.id })
      if (!changed.length) return fail(c, 404, "No such comment")
      return c.json({ ok: true as const }, 200)
    }
  )
