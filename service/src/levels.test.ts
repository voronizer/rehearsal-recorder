import { afterEach, expect, test, vi } from "vitest"
import { keepLevels, levelsQuery, queryClient, whenSignedOut } from "./api"

/** The service, answering each PUT of levels when the test says. */
function service() {
  const answers: Array<(levels: Record<string, number>) => void> = []
  const sent: unknown[] = []
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    const levels = await new Promise<Record<string, number>>((done) => answers.push(done))
    return new Response(JSON.stringify({ levels }), { headers: { "content-type": "application/json" } })
  })
  return { answers, sent }
}

afterEach(() => {
  vi.unstubAllGlobals()
  queryClient.clear()
})

test("levels kept in quick turns end as the last turn left them", async () => {
  const { answers, sent } = service()
  const first = keepLevels({ Bass: 0.3 })
  const second = keepLevels({ Bass: 0.5 })
  await vi.waitFor(() => expect(answers.length).toBeGreaterThan(0))
  await new Promise((done) => setTimeout(done, 20))
  // The second goes only once the first is answered, so their answers cannot cross.
  expect(sent).toHaveLength(1)
  answers[0]({ Bass: 0.3 })
  await vi.waitFor(() => expect(answers).toHaveLength(2))
  answers[1]({ Bass: 0.5 })
  await Promise.all([first, second])
  expect(sent).toEqual([{ levels: { Bass: 0.3 } }, { levels: { Bass: 0.5 } }])
  expect(queryClient.getQueryData(levelsQuery.queryKey)).toEqual({ levels: { Bass: 0.5 } })
})

test("a read of the levels from before a turn does not undo it", async () => {
  const { answers } = service()
  let read: (levels: Record<string, number>) => void = () => {}
  const reading = queryClient.fetchQuery({
    ...levelsQuery,
    queryFn: () => new Promise<{ levels: Record<string, number> }>((done) => (read = (levels) => done({ levels }))),
  }).catch(() => {})
  const kept = keepLevels({ Bass: 0.5 })
  await vi.waitFor(() => expect(answers).toHaveLength(1))
  answers[0]({ Bass: 0.5 })
  await kept
  read({ Bass: 0.2 })
  await reading
  expect(queryClient.getQueryData(levelsQuery.queryKey)).toEqual({ levels: { Bass: 0.5 } })
})

test("a lapsed session when keeping levels goes to sign-in", async () => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }))
  const go = vi.fn()
  whenSignedOut(go)
  await expect(keepLevels({ Bass: 0.5 })).rejects.toThrow()
  expect(go).toHaveBeenCalled()
})
