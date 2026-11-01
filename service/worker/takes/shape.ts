import { eq } from "drizzle-orm"
import type { Database } from "../shared/db"
import type { Bindings } from "../shared/env"
import { take } from "../shared/schema"

/** How many values a list's wave has. */
export const SHAPE = 120

type Tracked = { uid: string; gen: number; tracks: { position: number; files: string[] }[] }

/**
 * The wave a list draws for a take: its tracks' peaks (РЭХА sends 1200 a
 * track) joined by the loudest at each moment, in 120 values scaled to the
 * take's peak. A take with no peaks has none, and a list draws it flat.
 */
export async function makeShape(files: R2Bucket, t: Tracked): Promise<number[]> {
  const all = await Promise.all(
    t.tracks
      .filter((k) => k.files.includes(`${k.position}.peaks`))
      .map(async (k) => {
        const object = await files.get(`takes/${t.uid}/${t.gen}/${k.position}.peaks`)
        if (!object) return null
        const { peaks } = (await object.json().catch(() => ({}))) as { peaks?: unknown }
        return Array.isArray(peaks) ? peaks.map((v) => (typeof v === "number" && v > 0 ? v : 0)) : null
      })
  )
  const tracks = all.filter((p): p is number[] => p !== null && p.length > 0)
  if (!tracks.length) return []
  const out: number[] = []
  for (let i = 0; i < SHAPE; i++) {
    let top = 0
    for (const p of tracks) {
      const from = Math.floor((i * p.length) / SHAPE)
      const to = Math.max(from + 1, Math.floor(((i + 1) * p.length) / SHAPE))
      for (let k = from; k < to; k++) top = Math.max(top, p[k] ?? 0)
    }
    out.push(top)
  }
  const peak = Math.max(...out)
  return peak > 0 ? out.map((v) => Math.round((v / peak) * 100) / 100) : out.map(() => 0)
}

/** Makes and keeps the waves of shown takes that have none yet: part 1's takes. */
export async function fillShapes(env: Bindings, db: Database, takes: (Tracked & { shape: number[] | null })[]) {
  const missing = takes.filter((t) => t.shape === null)
  if (!missing.length) return
  const made = await Promise.all(missing.map((t) => makeShape(env.FILES, t)))
  await db.batch(made.map((shape, i) => db.update(take).set({ shape }).where(eq(take.uid, missing[i].uid))) as never)
  missing.forEach((t, i) => (t.shape = made[i]))
}
