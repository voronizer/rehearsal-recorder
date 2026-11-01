import { z } from "@hono/zod-openapi"
import type { comment } from "../shared/schema"
import { initial, shownName } from "../takes/rows"

/** A mark or a comment on a take's page. */
export const CommentView = z
  .object({
    id: z.number(),
    at: z.number(),
    text: z.string(),
    /** null for a mark from РЭХА. */
    author: z.string().nullable(),
    initial: z.string().nullable(),
    member_id: z.string().nullable(),
    label: z.string().nullable(),
    colour: z.string().nullable(),
    from_reha: z.boolean(),
    closed: z.boolean(),
    /** It was in the part a crop cut off. */
    cut_off: z.boolean(),
    created_at: z.string(),
  })
  .openapi("Comment")

type CommentRowDb = typeof comment.$inferSelect & { name: string | null; email: string | null }

export const commentView = (c: CommentRowDb): z.infer<typeof CommentView> => ({
  id: c.id,
  // A mark from a newer generation whose start was put back can be before
  // the start of the one the band still hears: it shows at 0:00 till then.
  at: Math.max(0, c.at),
  text: c.text,
  author: c.fromReha || c.name === null ? null : shownName(c.name, c.email ?? ""),
  initial: c.fromReha || c.name === null ? null : initial(c.name, c.email ?? ""),
  member_id: c.memberId,
  label: c.label,
  colour: c.colour,
  from_reha: c.fromReha,
  closed: c.closed,
  cut_off: c.cutOff,
  created_at: c.createdAt,
})
