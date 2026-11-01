import { and, desc, eq, gte, sql } from "drizzle-orm"
import { database, type Database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { chat, comment, label, rehearsal, take, user } from "../shared/schema"
import { iso, now } from "../shared/time"
import { reportFailure, tellOwner } from "./failures"
import type { Telegram } from "./telegram"
import type { ChatEvent } from "./tell"
import { clock, escape, link, rehearsalDay } from "./words"

/** A message takes additions for 3 hours after it started. */
const OPEN_FOR = 3 * 60 * 60 * 1000
/** Telegram's longest message. */
const LONGEST = 4096
/** wrangler.jsonc's max_retries is 5: the first try and five more. */
const LAST_TRY = 6

type Thread = { kind: "takes" | "marks" | "comments"; about: string; head: string; item: string }

/**
 * Adds `item` to the thread's message while it is open, or starts a new
 * one. An item already in one of the thread's messages is not posted
 * again: the queue can hand an event over twice. The row is written before
 * the event is acknowledged, so a sent message is never sent again.
 */
async function post(db: Database, telegram: Telegram, chatId: string, thread: Thread) {
  const same = and(eq(chat.kind, thread.kind), eq(chat.about, thread.about))
  const [done] = await db
    .select({ id: chat.id })
    .from(chat)
    .where(and(same, sql`instr(${chat.text}, ${thread.item}) > 0`))
    .limit(1)
  if (done) return
  const since = iso(new Date(now().getTime() - OPEN_FOR))
  const [open] = await db
    .select()
    .from(chat)
    .where(and(same, gte(chat.startedAt, since)))
    .orderBy(desc(chat.startedAt))
    .limit(1)
  if (open && open.text.length + 2 + thread.item.length <= LONGEST) {
    const text = `${open.text}, ${thread.item}`
    await telegram.edit(chatId, open.messageId, text)
    await db.update(chat).set({ text }).where(eq(chat.id, open.id))
    return
  }
  const text = thread.head + thread.item
  const messageId = await telegram.send(chatId, text)
  await db.insert(chat).values({ kind: thread.kind, about: thread.about, messageId, text, startedAt: iso() })
}

/** A take the band can now hear: its rehearsal's message. */
async function takeShown(db: Database, uid: string, origin: string): Promise<Thread | null> {
  const [row] = await db
    .select({ take, rehearsal })
    .from(take)
    .innerJoin(rehearsal, eq(take.rehearsalUid, rehearsal.uid))
    .where(eq(take.uid, uid))
    .limit(1)
  if (!row || row.take.shownGen === null || row.take.trashedAt) return null
  return {
    kind: "takes",
    about: row.rehearsal.uid,
    head: `New takes from ${rehearsalDay(row.rehearsal.date)}: `,
    item: link(`${origin}/takes/${uid}`, row.take.name),
  }
}

/** A comment or mark row with its take and writer, or null when the band should not hear of it. */
async function said(db: Database, id: number) {
  const [row] = await db
    .select({ comment, take, member: user, label: label.name })
    .from(comment)
    .innerJoin(take, eq(comment.takeUid, take.uid))
    .innerJoin(user, eq(comment.memberId, user.id))
    .leftJoin(label, eq(comment.labelId, label.id))
    .where(eq(comment.id, id))
    .limit(1)
  return !row || row.comment.fromReha || row.take.shownGen === null || row.take.trashedAt ? null : row
}

const place = (at: number) => Math.round(at * 100) / 100

/** A member's mark: their message on that take. Marks from РЭХА are not posted. */
async function marked(db: Database, id: number, origin: string): Promise<Thread | null> {
  const row = await said(db, id)
  if (!row) return null
  const page = `${origin}/takes/${row.take.uid}`
  const { at, text } = row.comment
  return {
    kind: "marks",
    about: `${row.member.id}:${row.take.uid}`,
    head: `${escape(row.member.name || row.member.email)} on ${link(page, row.take.name)}: `,
    item: link(`${page}?at=${place(at)}&mark=${id}`, `${clock(at)} ${text ? `“${text}”` : (row.label ?? "")}`.trim()),
  }
}

/** A member's comment under a mark: their message on that mark. */
async function commented(db: Database, id: number, origin: string): Promise<Thread | null> {
  const row = await said(db, id)
  if (!row) return null
  // A comment event queued before marks had comments under them: a mark.
  const parent = row.comment.parentId
  if (parent === null) return marked(db, id, origin)
  const page = `${origin}/takes/${row.take.uid}`
  return {
    kind: "comments",
    about: `${row.member.id}:mark:${parent}`,
    head: `${escape(row.member.name || row.member.email)} on ${link(page, row.take.name)} at ${clock(row.comment.at)}: `,
    item: link(`${page}?at=${place(row.comment.at)}&comment=${id}`, `“${row.comment.text}”`),
  }
}

async function handle(event: ChatEvent, env: Bindings, telegram: Telegram) {
  if (event.kind === "failure") return tellOwner(env, telegram, event)
  if (!env.TELEGRAM_CHAT_ID) return
  const db = database(env)
  const thread =
    event.kind === "take"
      ? await takeShown(db, event.take_uid, event.origin)
      : event.kind === "mark"
        ? await marked(db, event.mark_id, event.origin)
        : await commented(db, event.comment_id, event.origin)
  if (thread) await post(db, telegram, env.TELEGRAM_CHAT_ID, thread)
}

/**
 * The queue's consumer. The queue hands over one batch at a time
 * (max_concurrency 1), so the edits of one message stay in order. A
 * Telegram error tries the event again; after the last try, Alex is told.
 */
export async function consumeChat(batch: MessageBatch<ChatEvent>, env: Bindings, telegram: Telegram) {
  for (const message of batch.messages) {
    try {
      if (env.TELEGRAM_BOT_TOKEN) await handle(message.body, env, telegram)
      message.ack()
    } catch (error) {
      if (message.attempts >= LAST_TRY && message.body.kind !== "failure")
        await reportFailure(env, "the band's chat", error)
      message.retry()
    }
  }
}
