import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { expect, test, vi } from "vitest"
import { consumeChat } from "../worker/chat/consume"
import { reportFailure } from "../worker/chat/failures"
import type { ChatEvent } from "../worker/chat/tell"
import type { Bindings } from "../worker/shared/env"
import { putTake, ready } from "../worker/takes/store"
import { ORIGIN, REHEARSAL, takeMeta } from "./helpers"

const HOUR = 60 * 60 * 1000
const CHAT_ID = "-1002003004005"
const OWNER_ID = "42"

/** The Worker's settings with a bot, and a queue that keeps what is put on it. */
function withBot(over: Partial<Bindings> = {}) {
  const queued: ChatEvent[] = []
  const chatEnv = {
    ...env,
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_CHAT_ID: CHAT_ID,
    OWNER_TELEGRAM_ID: OWNER_ID,
    CHAT: { send: async (event: ChatEvent) => void queued.push(event) },
    ...over,
  } as unknown as Bindings
  return { chatEnv, queued }
}

/** Telegram as the tests see it: what was sent and edited, and failures on demand. */
function fakeTelegram() {
  const sent: { chat: string; id: number; text: string }[] = []
  const edited: { chat: string; id: number; text: string }[] = []
  let failures = 0
  let next = 100
  return {
    sent,
    edited,
    failNext(n: number) {
      failures = n
    },
    async send(chat: string, text: string) {
      if (failures > 0) {
        failures--
        throw new Error("Telegram sendMessage: Too Many Requests")
      }
      sent.push({ chat, id: next, text })
      return next++
    },
    async edit(chat: string, id: number, text: string) {
      if (failures > 0) {
        failures--
        throw new Error("Telegram editMessageText: Bad Gateway")
      }
      edited.push({ chat, id, text })
    },
  }
}

let delivered = 0

/** Hands the events to the consumer as one batch, as the queue does. */
async function deliver(chatEnv: Bindings, telegram: ReturnType<typeof fakeTelegram>, ...events: ChatEvent[]) {
  const batch = createMessageBatch(
    "reha-band-chat",
    events.map((body) => ({ id: `m${++delivered}`, timestamp: new Date(), attempts: 1, body }))
  )
  await consumeChat(batch, chatEnv, telegram)
  return getQueueResult(batch, createExecutionContext())
}

/** A take РЭХА sent, shown to the band: its event as the queue gets it. */
async function shown(chatEnv: Bindings, number: number, queued: ChatEvent[]): Promise<ChatEvent> {
  const uid = crypto.randomUUID()
  await putTake(chatEnv, uid, takeMeta({ number, name: `Viasna ${number}` }) as never)
  await ready(chatEnv, uid, 1, "mp3", ORIGIN)
  return queued[queued.length - 1]
}

async function memberId(name: string) {
  let member = (await env.DB.prepare("SELECT id FROM user WHERE name = ?").bind(name).first<{ id: string }>())?.id
  if (!member) {
    member = crypto.randomUUID()
    await env.DB.prepare("INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, 1)")
      .bind(member, name, `${name.toLowerCase()}@example.com`)
      .run()
  }
  return member
}

/** A mark set by `name` (or from РЭХА), with the first label: its event as the queue gets it. */
async function memberMark(take: string, name: string, at: number, note: string, fromReha = false) {
  const member = fromReha ? null : await memberId(name)
  const row = await env.DB.prepare(
    `INSERT INTO comment (take_uid, member_id, at, text, from_reha, label_id, created_at)
     VALUES (?, ?, ?, ?, ?, (SELECT id FROM label ORDER BY position LIMIT 1), '2025-10-30T21:00:00.000Z') RETURNING id`
  )
    .bind(take, member, at, note, fromReha ? 1 : 0)
    .first<{ id: number }>()
  return { kind: "mark", mark_id: row!.id, origin: ORIGIN } as ChatEvent
}

/** A comment by `name` under a mark. */
async function memberComment(mark: number, name: string, text: string) {
  const row = await env.DB.prepare(
    `INSERT INTO comment (take_uid, parent_id, member_id, at, text, created_at)
     SELECT take_uid, id, ?, at, ?, '2025-10-30T21:05:00.000Z' FROM comment WHERE id = ? RETURNING id`
  )
    .bind(await memberId(name), text, mark)
    .first<{ id: number }>()
  return { kind: "comment", comment_id: row!.id, origin: ORIGIN } as ChatEvent
}

test("a shown take goes on the queue", async () => {
  const { chatEnv, queued } = withBot()
  const uid = crypto.randomUUID()
  await putTake(chatEnv, uid, takeMeta() as never)
  expect(queued).toEqual([])

  await ready(chatEnv, uid, 1, "mp3", ORIGIN)
  expect(queued).toEqual([{ kind: "take", take_uid: uid, origin: ORIGIN }])
  await ready(chatEnv, uid, 1, "mp3", ORIGIN)
  await ready(chatEnv, uid, 1, "flac", ORIGIN)
  expect(queued.length).toBe(1)
})

test("the first take of a rehearsal starts a message", async () => {
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()
  const event = await shown(chatEnv, 11, queued)

  const result = await deliver(chatEnv, fake, event)
  expect(result.explicitAcks).toEqual([`m${delivered}`])
  expect(fake.sent.length).toBe(1)
  expect(fake.sent[0].chat).toBe(CHAT_ID)
  expect(fake.sent[0].text).toContain("New takes from Thursday, 30 October: ")
  const uid = (event as { take_uid: string }).take_uid
  expect(fake.sent[0].text).toBe(`New takes from Thursday, 30 October: <a href="${ORIGIN}/takes/${uid}">Viasna 11</a>`)
  const kept = await env.DB.prepare("SELECT kind, about, message_id FROM chat").first()
  expect(kept).toEqual({ kind: "takes", about: REHEARSAL.uid, message_id: fake.sent[0].id })
})

test("the next take within 3 hours is added to it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const start = new Date("2025-10-30T19:00:00Z")
  vi.setSystemTime(start)
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()
  await deliver(chatEnv, fake, await shown(chatEnv, 11, queued))

  vi.setSystemTime(new Date(start.getTime() + 2 * HOUR))
  const twelve = await shown(chatEnv, 12, queued)
  await deliver(chatEnv, fake, twelve)

  expect(fake.sent.length).toBe(1)
  expect(fake.edited.length).toBe(1)
  expect(fake.edited[0].id).toBe(fake.sent[0].id)
  expect(fake.edited[0].text).toBe(
    `${fake.sent[0].text}, <a href="${ORIGIN}/takes/${(twelve as { take_uid: string }).take_uid}">Viasna 12</a>`
  )
})

test("after 3 hours a new message starts", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const start = new Date("2025-10-30T19:00:00Z")
  vi.setSystemTime(start)
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()
  const eleven = await shown(chatEnv, 11, queued)
  await deliver(chatEnv, fake, eleven)

  vi.setSystemTime(new Date(start.getTime() + 3 * HOUR + 60 * 1000))
  const twelve = await shown(chatEnv, 12, queued)
  await deliver(chatEnv, fake, twelve)

  const link = (event: ChatEvent, name: string) =>
    `<a href="${ORIGIN}/takes/${(event as { take_uid: string }).take_uid}">${name}</a>`
  expect(fake.edited).toEqual([])
  expect(fake.sent.map((s) => s.text)).toEqual([
    `New takes from Thursday, 30 October: ${link(eleven, "Viasna 11")}`,
    `New takes from Thursday, 30 October: ${link(twelve, "Viasna 12")}`,
  ])
})

test("a member's marks on a take go in one message", async () => {
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()
  const take = (await shown(chatEnv, 12, queued)) as { take_uid: string }
  const page = `${ORIGIN}/takes/${take.take_uid}`

  const first = await memberMark(take.take_uid, "Ira", 102, "The bridge drags here")
  const second = await memberMark(take.take_uid, "Ira", 178, "")
  await deliver(chatEnv, fake, first)
  await deliver(chatEnv, fake, second)
  await deliver(chatEnv, fake, await memberMark(take.take_uid, "Alex", 60, "Bass & drums <together>"))
  const id = (e: ChatEvent) => (e as { mark_id: number }).mark_id

  expect(fake.sent.map((s) => s.text)).toEqual([
    `Ira on <a href="${page}">Viasna 12</a>: <a href="${page}?at=102&amp;mark=${id(first)}">1:42 “The bridge drags here”</a>`,
    expect.stringMatching(/^Alex on .*1:00 “Bass &amp; drums &lt;together&gt;”<\/a>$/),
  ])
  // A mark with no note says its label.
  expect(fake.edited.map((e) => e.text)).toEqual([
    `${fake.sent[0].text}, <a href="${page}?at=178&amp;mark=${id(second)}">2:58 Note</a>`,
  ])
})

test("comments under a mark go one message per person and mark", async () => {
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()
  const take = (await shown(chatEnv, 12, queued)) as { take_uid: string }
  const page = `${ORIGIN}/takes/${take.take_uid}`
  const mark = (await memberMark(take.take_uid, "Ira", 178, "Fill too long?")) as { mark_id: number }

  const keep = await memberComment(mark.mark_id, "Ivan", "Keep it. I'll start it two bars later.")
  const again = await memberComment(mark.mark_id, "Ivan", "Keep it. I'll start it two bars later.")
  await deliver(chatEnv, fake, keep, again)
  const id = (e: ChatEvent) => (e as { comment_id: number }).comment_id

  expect(fake.sent.map((s) => s.text)).toEqual([
    `Ivan on <a href="${page}">Viasna 12</a> at 2:58: <a href="${page}?at=178&amp;comment=${id(keep)}">“Keep it. I'll start it two bars later.”</a>`,
  ])
  // The same words twice are two comments, both posted.
  expect(fake.edited.map((e) => e.text)).toEqual([
    `${fake.sent[0].text}, <a href="${page}?at=178&amp;comment=${id(again)}">“Keep it. I'll start it two bars later.”</a>`,
  ])
})

test("marks from REHA are not posted", async () => {
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()
  const take = (await shown(chatEnv, 12, queued)) as { take_uid: string }

  const result = await deliver(chatEnv, fake, await memberMark(take.take_uid, "", 42, "Too fast", true))
  expect(result.explicitAcks.length).toBe(1)
  expect(fake.sent).toEqual([])
})

test("a telegram error is tried again, a sent message is not sent twice", async () => {
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()
  const event = await shown(chatEnv, 11, queued)

  fake.failNext(1)
  const first = await deliver(chatEnv, fake, event)
  expect(first.retryMessages).toEqual([{ msgId: `m${delivered}` }])
  expect(fake.sent).toEqual([])

  const second = await deliver(chatEnv, fake, event)
  expect(second.explicitAcks).toEqual([`m${delivered}`])
  expect(fake.sent.length).toBe(1)

  // The queue may hand the same event over again; it is not sent again.
  await deliver(chatEnv, fake, event)
  expect(fake.sent.length).toBe(1)
  expect(fake.edited).toEqual([])
})

test("a failure is told to the owner alone, once an hour", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const start = new Date("2025-10-30T19:00:00Z")
  vi.setSystemTime(start)
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()

  await reportFailure(chatEnv, "PUT /api/reha/takes/:uid", new Error("D1 is down"))
  await deliver(chatEnv, fake, ...queued.splice(0))
  vi.setSystemTime(new Date(start.getTime() + 30 * 60 * 1000))
  await reportFailure(chatEnv, "PUT /api/reha/takes/:uid", new Error("D1 is down"))
  await deliver(chatEnv, fake, ...queued.splice(0))
  await reportFailure(chatEnv, "emptying the trash", new Error("R2 is down"))
  await deliver(chatEnv, fake, ...queued.splice(0))
  vi.setSystemTime(new Date(start.getTime() + HOUR + 60 * 1000))
  await reportFailure(chatEnv, "PUT /api/reha/takes/:uid", new Error("D1 is down"))
  await deliver(chatEnv, fake, ...queued.splice(0))

  expect(fake.sent.map((s) => [s.chat, s.text])).toEqual([
    [OWNER_ID, "The band service failed: PUT /api/reha/takes/:uid at 30 October 2025, 19:00 UTC. D1 is down"],
    [OWNER_ID, "The band service failed: emptying the trash at 30 October 2025, 19:30 UTC. R2 is down"],
    [OWNER_ID, "The band service failed: PUT /api/reha/takes/:uid at 30 October 2025, 20:01 UTC. D1 is down"],
  ])

  // Without the owner's id, a failure is only logged.
  const quiet = withBot({ OWNER_TELEGRAM_ID: undefined })
  await reportFailure(quiet.chatEnv, "GET /api/feed", new Error("D1 is down"))
  expect(quiet.queued).toEqual([])
})

test("without a bot token nothing is sent", async () => {
  const { chatEnv, queued } = withBot({ TELEGRAM_BOT_TOKEN: undefined })
  const fake = fakeTelegram()
  const uid = crypto.randomUUID()
  await putTake(chatEnv, uid, takeMeta() as never)
  await ready(chatEnv, uid, 1, "mp3", ORIGIN)
  await reportFailure(chatEnv, "GET /api/feed", new Error("D1 is down"))
  expect(queued).toEqual([])

  const result = await deliver(chatEnv, fake, { kind: "take", take_uid: uid, origin: ORIGIN })
  expect(result.explicitAcks.length).toBe(1)
  expect(fake.sent).toEqual([])
})
