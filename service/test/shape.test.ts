import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"
import { expect, test } from "vitest"
import { database } from "../worker/shared/db"
import type { Bindings } from "../worker/shared/env"
import { take } from "../worker/shared/schema"
import { putTake, ready } from "../worker/takes/store"
import { ORIGIN, read, shownTake, signInOwner, takeMeta } from "./helpers"

const bindings = env as unknown as Bindings

type Row = { uid: string; shape: number[] }
const rows = async (cookie: string) => (await read<{ takes: Row[] }>(`/api/rehearsals/${(await read<{ uid: string }[]>("/api/rehearsals", cookie))[0].uid}`, cookie)).takes

/** РЭХА's peaks for one track: 1200 values, `first` in the first half and `second` after. */
const peaks = (uid: string, gen: number, position: number, first: number, second: number) =>
  bindings.FILES.put(
    `takes/${uid}/${gen}/${position}.peaks`,
    JSON.stringify({ peaks: Array.from({ length: 1200 }, (_, i) => (i < 600 ? first : second)) })
  )

test("a list's wave joins the take's tracks, the loudest at each moment, scaled to its peak", async () => {
  const owner = await signInOwner()
  const uid = crypto.randomUUID()
  await putTake(bindings, uid, takeMeta() as never)
  await peaks(uid, 1, 1, 0.5, 0)
  await peaks(uid, 1, 2, 0.1, 0.25)
  await ready(bindings, uid, 1, "mp3", ORIGIN)

  const [row] = await rows(owner)
  expect(row.shape).toHaveLength(120)
  expect(row.shape[0]).toBe(1)
  expect(row.shape[119]).toBe(0.5)
})

test("a take from before part 2 gets its wave the first time a list needs it", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  await database(bindings).update(take).set({ shape: null }).where(eq(take.uid, uid))
  await peaks(uid, 1, 1, 0.2, 0.4)

  expect((await rows(owner))[0].shape[119]).toBe(1)
  const [kept] = await database(bindings).select({ shape: take.shape }).from(take).where(eq(take.uid, uid))
  expect(kept.shape).toHaveLength(120)
})

test("a take with no peaks has a flat wave", async () => {
  const owner = await signInOwner()
  await shownTake()
  expect((await rows(owner))[0].shape).toEqual([])
})
