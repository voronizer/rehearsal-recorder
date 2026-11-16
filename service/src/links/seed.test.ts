import { expect, test } from "vitest"
import { queryClient, seedLink, type LinkPage, type Person } from "../api"

test("a marks link knows who wrote its marks, so Ira and Ivan read Ir and Iv", () => {
  const by = (member_id: string | null, author: string | null) => ({ member_id, author, initial: author?.[0] ?? null })
  const page = {
    uid: "t1",
    tracks: [],
    song: null,
    labels: [],
    link: { heard: null },
    marks: [
      { id: 1, ...by("m1", "Ira"), comments: [{ id: 2, ...by("m2", "Ivan") }, { id: 3, ...by("m1", "Ira") }] },
      // A mark from РЭХА has no writer.
      { id: 4, ...by(null, null), comments: [] },
    ],
  } as unknown as LinkPage
  seedLink(page)
  expect(queryClient.getQueryData<Person[]>(["people"])).toEqual([
    { id: "m1", name: "Ira", initial: "I", me: false, owner: false },
    { id: "m2", name: "Ivan", initial: "I", me: false, owner: false },
  ])
})
