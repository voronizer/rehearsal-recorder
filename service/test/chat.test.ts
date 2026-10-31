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

async function memberComment(take: string, name: string, at: number, text: string, fromReha = false) {
  let member: string | null = null
  if (!fromReha) {
    member = (await env.DB.prepare("SELECT id FROM user WHERE name = ?").bind(name).first<{ id: string }>())?.id ?? null
    if (!member) {
      member = crypto.randomUUID()
      await env.DB.prepare("INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, 1)")
        .bind(member, name, `${name.toLowerCase()}@example.com`)
        .run()
    }
  }
  const row = await env.DB.prepare(
    `INSERT INTO comment (take_uid, member_id, at, text, from_reha, created_at)
     VALUES (?, ?, ?, ?, ?, '2025-10-30T21:00:00.000Z') RETURNING id`
  )
    .bind(take, member, at, text, fromReha ? 1 : 0)
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
  await deliver(chatEnv, fake, await shown(chatEnv, 11, queued))

  vi.setSystemTime(new Date(start.getTime() + 3 * HOUR + 60 * 1000))
  await deliver(chatEnv, fake, await shown(chatEnv, 12, queued))

  expect(fake.edited).toEqual([])
  expect(fake.sent.map((s) => s.text.replace(/<[^>]+>/g, ""))).toEqual([
    "New takes from Thursday, 30 October: Viasna 11",
    "New takes from Thursday, 30 October: Viasna 12",
  ])
})

test("comments go per person and take", async () => {
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()
  const take = (await shown(chatEnv, 12, queued)) as { take_uid: string }
  const link = (at: number) => `${ORIGIN}/takes/${take.take_uid}?at=${at}`

  await deliver(chatEnv, fake, await memberComment(take.take_uid, "Alex", 102, "The bridge drags here"))
  await deliver(chatEnv, fake, await memberComment(take.take_uid, "Alex", 178, "Fill too long?"))
  await deliver(chatEnv, fake, await memberComment(take.take_uid, "Ira", 60, "Bass & drums <together>"))

  expect(fake.sent.map((s) => s.text)).toEqual([
    `Alex on <a href="${ORIGIN}/takes/${take.take_uid}">Viasna 12</a>: <a href="${link(102)}">1:42 “The bridge drags here”</a>`,
    `Ira on <a href="${ORIGIN}/takes/${take.take_uid}">Viasna 12</a>: <a href="${link(60)}">1:00 “Bass &amp; drums &lt;together&gt;”</a>`,
  ])
  expect(fake.edited.map((e) => e.text)).toEqual([
    `${fake.sent[0].text}, <a href="${link(178)}">2:58 “Fill too long?”</a>`,
  ])
})

test("marks from REHA are not posted", async () => {
  const { chatEnv, queued } = withBot()
  const fake = fakeTelegram()
  const take = (await shown(chatEnv, 12, queued)) as { take_uid: string }

  const result = await deliver(chatEnv, fake, await memberComment(take.take_uid, "", 42, "Too fast", true))
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
