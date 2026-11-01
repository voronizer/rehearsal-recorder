import { applyD1Migrations, reset } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { expect, test } from "vitest"

// Part 1's band as it stood before 0001, then 0001 on top of it.
const PART_1 = env.TEST_MIGRATIONS.filter((m) => m.name.startsWith("0000_"))

const run = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values).run()
const rows = async (sql: string) => (await env.DB.prepare(sql).all<Record<string, unknown>>()).results

async function part1Band() {
  await reset()
  await applyD1Migrations(env.DB, PART_1)
  await run("INSERT INTO user (id, name, email, email_verified) VALUES ('ira', 'Ira', 'ira@example.com', 1)")
  await run("INSERT INTO user (id, name, email, email_verified, banned) VALUES ('gone', 'Vik', 'vik@example.com', 1, 1)")
  await run("INSERT INTO rehearsal (uid, name, date) VALUES ('r1', 'Thursday', '2025-10-30')")
  await run("INSERT INTO song (id, title) VALUES (1, 'Viasna')")
  const take = (uid: string, trashed: string | null) =>
    run(
      `INSERT INTO take (uid, rehearsal_uid, number, song_id, name, duration_sec, balance, tracks, notes, gen, shown_gen, trashed_at, updated_at)
       VALUES (?, 'r1', 12, 1, 'Viasna 12', 245, '{}', '[]', '[]', 1, 1, ?, '2025-10-30T21:00:00.000Z')`,
      uid,
      trashed
    )
  await take("t1", null)
  await take("t2", "2025-10-31T10:00:00.000Z")
  const comment = (id: number, take: string, parent: number | null, member: string | null, at: number, text: string, label: string | null, colour: string | null, closed = 0) =>
    run(
      `INSERT INTO comment (id, take_uid, parent_id, member_id, at, text, label, colour, from_reha, closed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2025-10-30T21:00:00.000Z')`,
      id, take, parent, member, at, text, label, colour, member === null ? 1 : 0, closed
    )
  await comment(1, "t1", null, null, 178, "This solo", "Keep this", "green")
  await comment(2, "t1", null, null, 20, "", "Solo", "teal")
  await comment(3, "t1", null, "ira", 102, "The bridge drags here", null, null, 1)
  await comment(4, "t1", 3, "gone", 102, "Two bars less", null, null)
  await comment(5, "t2", null, "gone", 30, "Too loud", null, null)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
}

test("part 1's comments become marks and comments under them", async () => {
  await part1Band()
  const labels = await rows("SELECT id, name, colour, position FROM label ORDER BY position")
  expect(labels.map((l) => [l.name, l.colour, l.position])).toEqual([
    ["Note", "grey", 0],
    ["Keep this", "green", 1],
    ["Went wrong", "red", 2],
    ["Do again", "amber", 3],
    ["Solo", "teal", 4],
  ])
  const id = (name: string) => labels.find((l) => l.name === name)!.id
  const marks = await rows("SELECT id, parent_id, label_id, text, from_reha, closed FROM comment ORDER BY id")
  expect(marks).toEqual([
    { id: 1, parent_id: null, label_id: id("Keep this"), text: "This solo", from_reha: 1, closed: 0 },
    { id: 2, parent_id: null, label_id: id("Solo"), text: "", from_reha: 1, closed: 0 },
    { id: 3, parent_id: null, label_id: id("Note"), text: "The bridge drags here", from_reha: 0, closed: 1 },
    { id: 4, parent_id: 3, label_id: null, text: "Two bars less", from_reha: 0, closed: 0 },
    { id: 5, parent_id: null, label_id: id("Note"), text: "Too loud", from_reha: 0, closed: 0 },
  ])
  const columns = (await rows("PRAGMA table_info(comment)")).map((c) => c.name)
  expect(columns).not.toContain("label")
  expect(columns).not.toContain("colour")
})

test("songs get the first status, and the band starts with its statuses and no name", async () => {
  await part1Band()
  const statuses = await rows("SELECT id, name FROM status ORDER BY position")
  expect(statuses.map((s) => s.name)).toEqual(["Learning", "Ready", "Archive"])
  expect(await rows("SELECT title, status_id, key, tempo, notes FROM song")).toEqual([
    { title: "Viasna", status_id: statuses[0].id, key: null, tempo: null, notes: "" },
  ])
  expect((await rows("SELECT created_at FROM song"))[0].created_at).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT/))
  expect(await rows("SELECT id, name, picture_at FROM band")).toEqual([{ id: 1, name: "", picture_at: null }])
})
