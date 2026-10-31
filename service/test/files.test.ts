import { env } from "cloudflare:workers"
import { expect, test } from "vitest"
import type { Bindings } from "../worker/shared/env"
import { putTake, ready } from "../worker/takes/store"
import { ORIGIN, call, shownTake, signInOwner, takeMeta } from "./helpers"

const bindings = env as unknown as Bindings

const file = new Uint8Array(1000).map((_, i) => i % 256)

test("files need a session and answer a range", async () => {
  const owner = await signInOwner()
  const uid = await shownTake()
  await env.FILES.put(`takes/${uid}/1/1.mp3`, file, { httpMetadata: { contentType: "audio/mpeg" } })

  expect((await call(`/files/${uid}/1/1.mp3`)).status).toBe(401)
  const whole = await call(`/files/${uid}/1/1.mp3`, {}, owner)
  expect(whole.status).toBe(200)
  expect(whole.headers.get("Accept-Ranges")).toBe("bytes")
  expect(whole.headers.get("Content-Type")).toBe("audio/mpeg")
  expect(new Uint8Array(await whole.arrayBuffer())).toEqual(file)

  const part = await call(`/files/${uid}/1/1.mp3`, { headers: { Range: "bytes=10-19" } }, owner)
  expect(part.status).toBe(206)
  expect(part.headers.get("Content-Range")).toBe("bytes 10-19/1000")
  expect(new Uint8Array(await part.arrayBuffer())).toEqual(file.slice(10, 20))

  expect((await call(`/files/${uid}/1/9.mp3`, {}, owner)).status).toBe(404)
  // A take the band does not see yet has no files to hand out.
  const hidden = crypto.randomUUID()
  await putTake(bindings, hidden, takeMeta() as never)
  await env.FILES.put(`takes/${hidden}/1/1.mp3`, file)
  expect((await call(`/files/${hidden}/1/1.mp3`, {}, owner)).status).toBe(404)
})

test("a download is named after the take and the track", async () => {
  const owner = await signInOwner()
  const uid = await shownTake({ name: "Pałyn 9", song: "Pałyn", number: 9 })
  await env.FILES.put(`takes/${uid}/1/1.flac`, file)

  const take = async () =>
    (await (await call(`/api/takes/${uid}`, {}, owner)).json()) as {
      files: { position: number; name: string; mp3: boolean; flac: boolean; mid: boolean | null }[]
      flac_coming: boolean
    }
  expect(await take()).toMatchObject({
    flac_coming: true,
    files: [
      { position: 1, name: "Bass", mp3: true, flac: false, mid: null },
      { position: 2, name: "Drums", mp3: true, flac: false, mid: null },
      { position: 3, name: "Keys", mp3: false, flac: false, mid: true },
    ],
  })
  await ready(bindings, uid, 1, "flac", ORIGIN)
  expect(await take()).toMatchObject({ flac_coming: false, files: [{ flac: true }, { flac: true }, { flac: false }] })

  const res = await call(`/files/${uid}/1/1.flac?download=1`, {}, owner)
  expect(res.status).toBe(200)
  expect(res.headers.get("Content-Disposition")).toBe(
    `attachment; filename="Pa_yn 9 - Bass.flac"; filename*=UTF-8''${encodeURIComponent("Pałyn 9 - Bass.flac")}`
  )
  expect((await call(`/files/${uid}/1/1.flac`, {}, owner)).headers.get("Content-Disposition")).toBeNull()
})
