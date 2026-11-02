import { keepPreviousData, QueryCache, QueryClient, MutationCache, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hc, type InferResponseType } from "hono/client"
// Only the routes' types: no Worker code reaches the pages.
import type { AppType } from "../worker/index"

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
export type Trashed = InferResponseType<typeof client.api.trash.$get, 200>[number]
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
export const useMembers = () => useQuery({ queryKey: ["members"], queryFn: () => data(client.api.members.$get()) })
export const useKeys = () => useQuery({ queryKey: ["keys"], queryFn: () => data(client.api.keys.$get()) })

/** The member's own levels for tracks, by name: only they hear them. */
export const levelsQuery = queryOptions({ queryKey: ["levels"], queryFn: () => data(client.api.me.levels.$get()) })
export const useLevels = () => useQuery(levelsQuery)

/**
 * Keeps the member's levels; a level of null forgets that track's. Nothing
 * else in the band changes, so only the levels are read again, from the
 * answer.
 */
export async function keepLevels(levels: Record<string, number | null>) {
  const after = await data(client.api.me.levels.$put({ json: { levels } }))
  queryClient.setQueryData(levelsQuery.queryKey, after)
  return after
}

export const takeQuery = (uid: string) =>
  queryOptions({ queryKey: ["take", uid], queryFn: () => data(client.api.takes[":uid"].$get({ param: { uid } })) })

/** A take's page; nothing is asked for while `uid` is "". */
export const useTake = (uid: string) => useQuery({ ...takeQuery(uid), enabled: uid !== "" })

/** A track's waveform, as РЭХА drew it: never changes for a generation. */
export const usePeaks = (path: string) =>
  useQuery({
    queryKey: ["peaks", path],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(path)
      if (res.status === 401) throw new SignedOut("Sign in first")
      if (!res.ok) return null
      return ((await res.json()) as { peaks: number[] }).peaks
    },
  })

/**
 * A change to the band: once the service has it, every page of the band is
 * read again (not who you are, and not the waveforms, which never change).
 */
export function useChange<T, R = unknown>(call: (arg: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: call,
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => !["me", "peaks"].includes(String(q.queryKey[0])) }),
  })
}

const id = (n: number) => ({ id: String(n) })

/** ★ on or off. */
export const useStar = () =>
  useChange(({ uid, on }: { uid: string; on: boolean }) =>
    data(on ? client.api.takes[":uid"].star.$post({ param: { uid } }) : client.api.takes[":uid"].star.$delete({ param: { uid } }))
  )

/** The member opened or played the take: it and its marks are no longer new for them. */
export const useSeen = () => useChange((uid: string) => data(client.api.takes[":uid"].seen.$post({ param: { uid } })))

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

export const useAddSong = () => useChange((title: string) => data(client.api.songs.$post({ json: { title } })))
export const useDeleteSong = () => useChange((n: number) => data(client.api.songs[":id"].$delete({ param: id(n) })))
export const useChangeSong = () =>
  useChange(({ id: n, ...json }: { id: number; status_id?: number; key?: string | null; notes?: string }) =>
    data(client.api.songs[":id"].$patch({ param: id(n), json }))
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

export const useRestore = () => useChange((uid: string) => data(client.api.trash[":uid"].restore.$post({ param: { uid } })))

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
