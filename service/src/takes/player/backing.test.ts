import { beforeEach, expect, test, vi } from "vitest"
import type { TakePage } from "../../api"

// The service's answer as the one player reads it: whether the member hears each song's Backing.
const api = vi.hoisted(() => ({
  known: undefined as { heard: Record<string, boolean> } | undefined,
  fetchQuery: vi.fn(),
  keepBackingHeard: vi.fn(async (_song: number, _heard: boolean) => ({ heard: {} })),
  // The page's query: asked on the first render it is enabled, answered by the next one.
  asked: false,
  answer: { heard: {} } as { heard: Record<string, boolean> },
}))
vi.mock("../../api", () => ({
  backingQuery: { queryKey: ["backing"] },
  keepBackingHeard: api.keepBackingHeard,
  queryClient: { getQueryData: () => api.known, fetchQuery: api.fetchQuery },
  useBacking: (enabled: boolean) => {
    if (api.asked) return { isPending: false, data: api.answer }
    api.asked = enabled
    return { isPending: true }
  },
}))

const { firstDesk, keepHeard, useBackingSong, whenHeard, withBacking } = await import("./backing")

const track = (name: string, kind?: "backing") => ({ name, mp3: `/${name}.mp3`, peaks: `/${name}.peaks`, ...(kind ? { kind } : {}) })
/** A take of the song `song`, its Backing track last. */
const takeOf = (song: number | null) =>
  ({
    uid: `t${song}`,
    gen: 1,
    song: song === null ? null : { id: song, title: "Viasna" },
    tracks: [track("Drums"), track("Bass"), track("Backing", "backing")],
  }) as unknown as TakePage
const noBacking = { ...takeOf(1), tracks: [track("Drums"), track("Bass")] } as unknown as TakePage

/** What whenHeard said, and whether it said it at once. */
function heard(take: TakePage) {
  let said: boolean | null | undefined
  whenHeard(take, (h) => (said = h))
  return () => said
}

beforeEach(() => {
  api.known = undefined
  api.fetchQuery.mockReset()
  api.keepBackingHeard.mockClear()
  api.asked = false
})

test("a take starts with Backing muted before any player had it, and a take without one with nothing muted", () => {
  expect(firstDesk(takeOf(1))).toEqual({ muted: [2], solo: null })
  expect(firstDesk(noBacking)).toEqual({ muted: [], solo: null })
})

test("a take with no song, or no Backing track, does not wait, and keeps its M as it was", () => {
  for (const take of [takeOf(null), noBacking]) expect(heard(take)()).toBeNull()
  expect(api.fetchQuery).not.toHaveBeenCalled()
  const desk = { muted: [0], solo: null }
  expect(withBacking(takeOf(null), desk, null)).toBe(desk)
  expect(withBacking(noBacking, desk, false)).toBe(desk)
})

test("Backing starts as the member hears it for the take's song, at once when the service has said", () => {
  api.known = { heard: { "3": true, "4": false } }
  expect(heard(takeOf(3))()).toBe(true)
  expect(heard(takeOf(4))()).toBe(false)
  // A song not chosen for yet: muted.
  expect(heard(takeOf(5))()).toBe(false)
  expect(api.fetchQuery).not.toHaveBeenCalled()
  // Heard, its M off whatever the page or the take's last player had; muted, its S off too.
  expect(withBacking(takeOf(3), { muted: [2, 0], solo: null }, true)).toEqual({ muted: [0], solo: null })
  expect(withBacking(takeOf(3), { muted: [0], solo: 2 }, false)).toEqual({ muted: [0, 2], solo: null })
  expect(withBacking(takeOf(3), { muted: [], solo: 1 }, false)).toEqual({ muted: [2], solo: 1 })
})

test("a take played before the service has said waits for its answer; with none, Backing is muted", async () => {
  let answer = (_: { heard: Record<string, boolean> }) => {}
  api.fetchQuery.mockReturnValueOnce(new Promise((done) => (answer = done)))
  const first = heard(takeOf(6))
  expect(first()).toBeUndefined()
  expect(api.fetchQuery).toHaveBeenCalledWith({ queryKey: ["backing"] })
  answer({ heard: { "6": true } })
  await vi.waitFor(() => expect(first()).toBe(true))

  api.fetchQuery.mockRejectedValueOnce(new Error("The band service is resting"))
  const failed = heard(takeOf(6))
  await vi.waitFor(() => expect(failed()).toBe(false))
})

test("M pressed on Backing is how its song starts from then on, before the service keeps it and when it cannot", async () => {
  api.known = { heard: { "7": false } }
  api.keepBackingHeard.mockRejectedValueOnce(new Error("The band service is resting"))
  await expect(keepHeard(7, true)).rejects.toThrow("The band service is resting")
  expect(api.keepBackingHeard).toHaveBeenCalledWith(7, true)
  expect(heard(takeOf(7))()).toBe(true)
  // Not answered either, the press stands.
  api.known = undefined
  api.fetchQuery.mockRejectedValueOnce(new Error("The band service is resting"))
  const offline = heard(takeOf(7))
  await vi.waitFor(() => expect(offline()).toBe(true))
})

test("a take with Backing and no song asks the service already, so gaining a song keeps its player open", () => {
  api.answer = { heard: { "8": true } }
  // The page's first render: no song, the player opens at once.
  expect(useBackingSong(takeOf(null))).toBeNull()
  // The take gains a song while its page is open: the answer is there, never undefined.
  expect(useBackingSong(takeOf(8))).toEqual({ id: 8, heard: true })
  // A take without Backing does not ask.
  api.asked = false
  expect(useBackingSong(noBacking)).toBeNull()
  expect(api.asked).toBe(false)
})
