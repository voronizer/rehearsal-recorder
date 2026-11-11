import {
  keepPreviousData,
  MutationCache,
  MutationObserver,
  QueryCache,
  QueryClient,
  queryOptions,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { hc, type InferResponseType } from "hono/client"
// Only the routes' types: no Worker code reaches the pages.
import type { AppType } from "../worker/index"
import { parseFrames } from "./takes/player/mp3"

/*
  The band's API, through Hono's client: its types come from the Worker's
  routes, so a page that no longer matches a route does not build. Each
  read has a TanStack Query hook. A change (a star, a mark, a song's key)
  reads the band's pages again once the service has it: the band is small,
  and every page then shows the same.
*/

export const client = hc<AppType>("/")

/** The session is gone (signed out everywhere, or removed): the page goes to sign-in. */
export class SignedOut extends Error {}

/** The service said no, in its own words. */
export class Refused extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

type Answer = { ok: boolean; status: number; json(): Promise<unknown> }
type Body<R> = R extends { ok: true; json(): Promise<infer T> } ? T : never

/** What a call answered, or SignedOut, or Refused with the service's words. */
export async function data<R extends Answer>(call: Promise<R>): Promise<Body<R>> {
  const res = await call
  if (res.status === 401) throw new SignedOut("Sign in first")
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Refused(res.status, body.error ?? "Something went wrong in the band service")
  }
  return (await res.json()) as Body<R>
}

export type Me = InferResponseType<typeof client.api.me.$get, 200>
export type Band = InferResponseType<typeof client.api.band.$get, 200>
export type Frame = InferResponseType<typeof client.api.frame.$get, 200>
export type Home = InferResponseType<typeof client.api.home.$get, 200>
export type HomeSong = Home["songs"][number]
export type Mark = Home["latest_marks"][number]
export type MarkComment = Mark["comments"][number]
export type TakeRow = Home["favourites"][number]
export type FirstSteps = NonNullable<Home["steps"]>
export type RehearsalItem = InferResponseType<typeof client.api.rehearsals.$get, 200>[number]
export type RehearsalPage = InferResponseType<(typeof client.api.rehearsals)[":uid"]["$get"], 200>
export type SongList = InferResponseType<typeof client.api.songs.$get, 200>
export type SongItem = SongList["songs"][number]
export type Status = SongList["statuses"][number]
export type SongPage = InferResponseType<(typeof client.api.songs)[":id"]["$get"], 200>
export type SongFile = SongPage["files"][number]
export type TakePage = InferResponseType<(typeof client.api.takes)[":uid"]["$get"], 200>
export type MarkList = InferResponseType<typeof client.api.marks.$get, 200>
export type Label = InferResponseType<typeof client.api.labels.$get, 200>[number]
export type Person = InferResponseType<typeof client.api.people.$get, 200>[number]
export type Member = InferResponseType<typeof client.api.members.$get, 200>[number]
export type Key = InferResponseType<typeof client.api.keys.$get, 200>[number]
export type TrashList = InferResponseType<typeof client.api.trash.$get, 200>
export type Trashed = TrashList["takes"][number]
export type TrashedSong = TrashList["songs"][number]
export type TrashedSet = TrashList["sets"][number]
export type BandSet = InferResponseType<typeof client.api.sets.$get, 200>["sets"][number]
export type Show = "open" | "closed" | "all"

/** Where the page goes when the session is gone; set by routes.tsx. */
let onSignedOut = () => {}
export const whenSignedOut = (go: () => void) => {
  onSignedOut = go
}

const signedOut = (e: unknown) => {
  if (e instanceof SignedOut) onSignedOut()
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: signedOut }),
  mutationCache: new MutationCache({ onError: signedOut }),
  defaultOptions: {
    queries: {
      // A refusal is the answer; only a failed connection or the server's own fault is tried again.
      retry: (count, e) => !(e instanceof SignedOut) && !(e instanceof Refused && e.status < 500) && count < 2,
    },
  },
})

/** The member signed in; the shell reads it before a page opens, to ask a new member for a name. */
export const meQuery = queryOptions({ queryKey: ["me"], queryFn: () => data(client.api.me.$get()) })
export const useMe = () => useQuery(meQuery)

/** The band's name and picture: the sign-in page shows them too. */
export const useBand = () => useQuery({ queryKey: ["band"], queryFn: () => data(client.api.band.$get()) })
export const useFrame = () => useQuery({ queryKey: ["frame"], queryFn: () => data(client.api.frame.$get()) })
export const useHome = () => useQuery({ queryKey: ["home"], queryFn: () => data(client.api.home.$get()) })
export const useRehearsals = () => useQuery({ queryKey: ["rehearsals"], queryFn: () => data(client.api.rehearsals.$get()) })
export const useRehearsal = (uid: string) =>
  useQuery({ queryKey: ["rehearsal", uid], queryFn: () => data(client.api.rehearsals[":uid"].$get({ param: { uid } })) })
export const useSongs = () => useQuery({ queryKey: ["songs"], queryFn: () => data(client.api.songs.$get()) })
export const useSong = (id: number) =>
  useQuery({ queryKey: ["song", id], queryFn: () => data(client.api.songs[":id"].$get({ param: { id: String(id) } })) })
/** The Marks section; while another switch is read, the last one stays, so the page does not jump. */
export const useMarks = (show: Show) =>
  useQuery({ queryKey: ["marks", show], placeholderData: keepPreviousData, queryFn: () => data(client.api.marks.$get({ query: { show } })) })
export const useLabels = () => useQuery({ queryKey: ["labels"], queryFn: () => data(client.api.labels.$get()) })
export const usePeople = () => useQuery({ queryKey: ["people"], queryFn: () => data(client.api.people.$get()) })
export const useTrash = () => useQuery({ queryKey: ["trash"], queryFn: () => data(client.api.trash.$get()) })
/** The band's sets in their order, each with its songs' numbers; a song in the Trash is left out until it is back. */
export const useSets = () => useQuery({ queryKey: ["sets"], queryFn: () => data(client.api.sets.$get()) })
export const useMembers = () => useQuery({ queryKey: ["members"], queryFn: () => data(client.api.members.$get()) })
export const useKeys = () => useQuery({ queryKey: ["keys"], queryFn: () => data(client.api.keys.$get()) })

/** The member's own levels for tracks, by name: only they hear them. */
export const levelsQuery = queryOptions({ queryKey: ["levels"], queryFn: () => data(client.api.me.levels.$get()) })
export const useLevels = () => useQuery(levelsQuery)

const KEEP_LEVELS = ["keep-levels"]

/** Levels turned while an earlier change was on its way, not yet sent. */
let unsent: Record<string, number | null> = {}

/**
 * Keeps the member's levels; a level of null forgets that track's. Nothing
 * else in the band changes, so only the levels are read again, from the
 * answer. A change waits for the one before it, so their answers cannot
 * cross, and it is a mutation, so a lapsed session goes to sign-in. The
 * changes that waited go in one, so the last turn is kept soon.
 */
export function keepLevels(levels: Record<string, number | null>) {
  unsent = { ...unsent, ...levels }
  return new MutationObserver(queryClient, {
    mutationKey: KEEP_LEVELS,
    scope: { id: "levels" },
    mutationFn: async () => {
      const levels = unsent
      unsent = {}
      // An earlier change already took these levels with it.
      if (!Object.keys(levels).length) return null
      return data(client.api.me.levels.$put({ json: { levels } }))
    },
    onSuccess: async (after) => {
      if (!after) return
      // A read asked before this change would put the old levels back.
      await queryClient.cancelQueries({ queryKey: levelsQuery.queryKey })
      queryClient.setQueryData(levelsQuery.queryKey, after)
    },
  }).mutate()
}

/** Why your levels were not kept the last time, or null if they were. */
export function useLevelsTrouble(): string | null {
  const last = useMutationState({ filters: { mutationKey: KEEP_LEVELS }, select: (m) => m.state.error }).at(-1)
  return last instanceof Error ? last.message : null
}

export const takeQuery = (uid: string) =>
  queryOptions({ queryKey: ["take", uid], queryFn: () => data(client.api.takes[":uid"].$get({ param: { uid } })) })

/** A take's page; nothing is asked for while `uid` is "". */
export const useTake = (uid: string) => useQuery({ ...takeQuery(uid), enabled: uid !== "" })

/** A track's waveform as РЭХА drew it: `peaks`, the louder side in each slice, and for a stereo file a row a side. */
export type Wave = { peaks: number[]; sides?: [number[], number[]] }

const numbers = (row: unknown): row is number[] => Array.isArray(row) && row.every((v) => typeof v === "number")

/**
 * A track's waveform. РЭХА may send it again for the same generation (with
 * both sides of a stereo file), so the browser asks the service each time
 * and is told when its copy is still the one; the page keeps what came. A
 * `sides` that is not two rows as long as `peaks` is left out.
 */
export const peaksQuery = (path: string) =>
  queryOptions({
    queryKey: ["peaks", path],
    staleTime: Infinity,
    queryFn: async (): Promise<Wave | null> => {
      const res = await fetch(path, { cache: "no-cache" })
      if (res.status === 401) throw new SignedOut("Sign in first")
      if (!res.ok) return null
      const { peaks, sides } = (await res.json()) as { peaks?: unknown; sides?: unknown }
      if (!numbers(peaks)) return null
      const both = Array.isArray(sides) && sides.length === 2 && sides.every((s) => numbers(s) && s.length === peaks.length)
      return both ? { peaks, sides: sides as [number[], number[]] } : { peaks }
    },
  })

/** How much of an MP3 is read for its channels: its first frames, and a tag before them. */
const HEAD_BYTES = 16 * 1024

/**
 * How many channels a track's MP3 has, from its first frame: 1, 2, or 0
 * when it cannot be read. A take sent before РЭХА sent both sides of a
 * stereo wave says so only here. Never changes for a generation.
 */
export const channelsQuery = (path: string) =>
  queryOptions({
    queryKey: ["channels", path],
    staleTime: Infinity,
    // Asked again, the take's rows would wait for it: a file that cannot be read has no rings.
    retry: false,
    queryFn: async (): Promise<0 | 1 | 2> => {
      try {
        const res = await fetch(path, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } })
        if (res.status === 401) throw new SignedOut("Sign in first")
        if (!res.ok) return 0
        // From a server that sent the whole file, its first bytes alone.
        const bytes = new Uint8Array(await res.arrayBuffer()).subarray(0, HEAD_BYTES)
        const { sampleRate, channels } = parseFrames(bytes)
        return sampleRate ? (channels === 1 ? 1 : 2) : 0
      } catch (e) {
        if (e instanceof SignedOut) throw e
        return 0
      }
    },
  })

/**
 * Whether the member hears each song's Backing track, by the song's
 * number; a song not listed has its Backing muted. Only they have it, on
 * any device, as with their levels. A failed read is not asked again: the
 * take opens after it, with Backing muted.
 */
export const backingQuery = queryOptions({ queryKey: ["backing"], retry: false, queryFn: () => data(client.api.me.backing.$get()) })
/** The same, asked for only while `enabled`. */
export const useBacking = (enabled: boolean) => useQuery({ ...backingQuery, enabled })

/**
 * Keeps whether the member hears a song's Backing track. One change waits
 * for the one before it, so the last press is the one kept, and the answer
 * is what is read from then on.
 */
export function keepBackingHeard(song_id: number, heard: boolean) {
  return new MutationObserver(queryClient, {
    scope: { id: "backing" },
    mutationFn: () => data(client.api.me.backing.$put({ json: { song_id, heard } })),
    onSuccess: async (after) => {
      // A read asked before this change would put the old answer back.
      await queryClient.cancelQueries({ queryKey: backingQuery.queryKey })
      queryClient.setQueryData(backingQuery.queryKey, after)
    },
  }).mutate()
}

/**
 * A change to the band: once the service has it, every page of the band is
 * read again (not who you are, and not a track's waveform or channels,
 * which no change in the band touches). Changes with the same `scope` go one
 * after another, so a later one cannot reach the service before an earlier
 * one.
 */
export function useChange<T, R = unknown>(call: (arg: T) => Promise<R>, scope?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: call,
    ...(scope && { scope: { id: scope } }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => !["me", "peaks", "channels"].includes(String(q.queryKey[0])) }),
  })
}

const id = (n: number) => ({ id: String(n) })

/** ★ on or off. */
export const useStar = () =>
  useChange(({ uid, on }: { uid: string; on: boolean }) =>
    data(on ? client.api.takes[":uid"].star.$post({ param: { uid } }) : client.api.takes[":uid"].star.$delete({ param: { uid } }))
  )

export const useAddMark = () =>
  useChange(({ uid, ...json }: { uid: string; at: number; label_id?: number; note: string }) =>
    data(client.api.takes[":uid"].marks.$post({ param: { uid }, json }))
  )
export const useChangeMark = () =>
  useChange(({ id: n, ...json }: { id: number; label_id?: number; note?: string; closed?: boolean }) =>
    data(client.api.marks[":id"].$patch({ param: id(n), json }))
  )
export const useDeleteMark = () => useChange((n: number) => data(client.api.marks[":id"].$delete({ param: id(n) })))
export const useAddComment = () =>
  useChange(({ mark, text }: { mark: number; text: string }) =>
    data(client.api.marks[":id"].comments.$post({ param: id(mark), json: { text } }))
  )
export const useChangeComment = () =>
  useChange(({ id: n, text }: { id: number; text: string }) => data(client.api.comments[":id"].$patch({ param: id(n), json: { text } })))
export const useDeleteComment = () => useChange((n: number) => data(client.api.comments[":id"].$delete({ param: id(n) })))

export const useAddLabel = () =>
  useChange((json: { name: string; colour: Label["colour"] }) => data(client.api.labels.$post({ json })))
export const useChangeLabel = () =>
  useChange(({ id: n, ...json }: { id: number; name?: string; colour?: Label["colour"] }) =>
    data(client.api.labels[":id"].$patch({ param: id(n), json }))
  )
export const useOrderLabels = () => useChange((ids: number[]) => data(client.api.labels.order.$put({ json: { ids } })))
export const useDeleteLabel = () =>
  useChange(({ id: n, to }: { id: number; to?: number }) => data(client.api.labels[":id"].$delete({ param: id(n), json: { to } })))

export const useAddSong = () => useChange((json: { title: string; status_id?: number }) => data(client.api.songs.$post({ json })))
export const useDeleteSong = () => useChange((n: number) => data(client.api.songs[":id"].$delete({ param: id(n) })))
export type SongChange = {
  id: number
  title?: string
  tempo?: number | null
  signature?: "4/4" | "3/4" | "2/4" | "6/8" | null
  status_id?: number
  key?: string | null
  notes?: string
}
export const useChangeSong = () =>
  useChange(({ id: n, ...json }: SongChange) => data(client.api.songs[":id"].$patch({ param: id(n), json })))
/** A song's length typed for its sets, in seconds; null goes back to the best take's. */
export const useTypeLength = () =>
  useChange(({ id: n, length }: { id: number; length: number | null }) =>
    data(client.api.songs[":id"].$patch({ param: id(n), json: { typed_length: length } }))
  )
export const useAddStatus = () => useChange((name: string) => data(client.api.statuses.$post({ json: { name } })))
export const useChangeStatus = () =>
  useChange(({ id: n, name }: { id: number; name: string }) => data(client.api.statuses[":id"].$patch({ param: id(n), json: { name } })))
export const useOrderStatuses = () => useChange((ids: number[]) => data(client.api.statuses.order.$put({ json: { ids } })))
export const useDeleteStatus = () =>
  useChange(({ id: n, to }: { id: number; to?: number }) => data(client.api.statuses[":id"].$delete({ param: id(n), json: { to } })))

/** Sends a file as the request's body, as the service's file routes take it. */
async function send(path: string, method: "POST" | "PUT", file: File, headers: Record<string, string> = {}) {
  return data(fetch(path, { method, body: file, headers: { "Content-Type": file.type || "application/octet-stream", ...headers } }))
}

export const useAddFile = () =>
  useChange(({ song, file }: { song: number; file: File }) =>
    send(`/api/songs/${song}/files`, "POST", file, { "x-file-name": encodeURIComponent(file.name) })
  )
export const useDeleteFile = () =>
  useChange(({ song, file }: { song: number; file: number }) =>
    data(client.api.songs[":id"].files[":file"].$delete({ param: { id: String(song), file: String(file) } }))
  )

export const useNameBand = () => useChange((name: string) => data(client.api.band.$put({ json: { name } })))
export const useBandPicture = () =>
  useChange((file: File | null) => (file ? send("/api/band/picture", "PUT", file) : data(client.api.band.picture.$delete())))

/** **New set**, at the end of the list, with no songs; its number. */
export const useMakeSet = () => useChange((name: string) => data(client.api.sets.$post({ json: { name } })), "sets")
/** A set's new name, its songs in their new order, or both. One at a time, so the last order pressed is the one kept. */
export const useChangeSet = () =>
  useChange(
    ({ id: n, ...json }: { id: number; name?: string; songs?: number[] }) => data(client.api.sets[":id"].$patch({ param: id(n), json })),
    "sets"
  )
export const useDeleteSet = () => useChange((n: number) => data(client.api.sets[":id"].$delete({ param: id(n) })), "sets")
export const useRestoreSet = () => useChange((n: number) => data(client.api.trash.sets[":id"].restore.$post({ param: id(n) })), "sets")

export const useRestore = () => useChange((uid: string) => data(client.api.trash[":uid"].restore.$post({ param: { uid } })))
export const useRestoreSong = () => useChange((n: number) => data(client.api.trash.songs[":id"].restore.$post({ param: id(n) })))
export const useDeleteTake = () => useChange((uid: string) => data(client.api.takes[":uid"].$delete({ param: { uid } })))
/** **Move to song**: to a song of the band's, out of its song (`song` null), or to a new one. */
export const useMoveTake = () =>
  useChange(({ uid, ...json }: { uid: string } & ({ song: number | null } | { new_song: string })) =>
    data(client.api.takes[":uid"].$patch({ param: { uid }, json }))
  )

export function useSaveName() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => data(client.api.me.$put({ json: { name } })),
    onSuccess: () => qc.invalidateQueries(),
  })
}

export const useAddMember = () => useChange((email: string) => data(client.api.members.$post({ json: { email } })))
export const useRemoveMember = () => useChange((m: string) => data(client.api.members[":id"].$delete({ param: { id: m } })))
export const useSignOutMember = () => useChange((m: string) => data(client.api.members[":id"].signout.$post({ param: { id: m } })))
export const useMakeKey = () => useChange((name: string) => data(client.api.keys.$post({ json: { name } })))
export const useRemoveKey = () => useChange((k: string) => data(client.api.keys[":id"].$delete({ param: { id: k } })))
