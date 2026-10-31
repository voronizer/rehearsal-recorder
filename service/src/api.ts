import { QueryCache, QueryClient, MutationCache, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hc, type InferResponseType } from "hono/client"
// Only the routes' types: no Worker code reaches the pages.
import type { AppType } from "../worker/index"

/*
  The band's API, through Hono's client: its types come from the Worker's
  routes, so a page that no longer matches a route does not build. Each call
  has a TanStack Query hook. A star, a seen take, a comment and a closed one
  are mutations that refresh the take and the feed.
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

export type Feed = InferResponseType<typeof client.api.feed.$get, 200>
export type TakeRow = NonNullable<Feed["songs"][number]["best"]>
export type SongPage = InferResponseType<(typeof client.api.songs)[":id"]["$get"], 200>
export type TakePage = InferResponseType<(typeof client.api.takes)[":uid"]["$get"], 200>
export type Comment = TakePage["comments"][number]
export type Me = InferResponseType<typeof client.api.me.$get, 200>
export type Member = InferResponseType<typeof client.api.members.$get, 200>[number]
export type Key = InferResponseType<typeof client.api.keys.$get, 200>[number]

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

const keys = {
  me: ["me"] as const,
  feed: ["feed"] as const,
  song: (id: string) => ["song", id] as const,
  take: (uid: string) => ["take", uid] as const,
  trash: ["trash"] as const,
  members: ["members"] as const,
  keys: ["keys"] as const,
}

/** The member signed in; the shell reads it before a page opens, to ask a new member for a name. */
export const meQuery = queryOptions({ queryKey: keys.me, queryFn: () => data(client.api.me.$get()) })

export const useMe = () => useQuery(meQuery)

export const useFeed = () => useQuery({ queryKey: keys.feed, queryFn: () => data(client.api.feed.$get()) })

export const useSong = (id: string) =>
  useQuery({ queryKey: keys.song(id), queryFn: () => data(client.api.songs[":id"].$get({ param: { id } })) })

/** A take's page; nothing is asked for while `uid` is "". */
export const useTake = (uid: string) =>
  useQuery({
    queryKey: keys.take(uid),
    enabled: uid !== "",
    queryFn: () => data(client.api.takes[":uid"].$get({ param: { uid } })),
  })

export const useTrash = () => useQuery({ queryKey: keys.trash, queryFn: () => data(client.api.trash.$get()) })

export const useMembers = () => useQuery({ queryKey: keys.members, queryFn: () => data(client.api.members.$get()) })

export const useKeys = () => useQuery({ queryKey: keys.keys, queryFn: () => data(client.api.keys.$get()) })

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

/** After a change to a take: the take, its song, the feed and the trash are read again. */
function useRefresh() {
  const qc = useQueryClient()
  return (uid?: string) =>
    Promise.all([
      uid ? qc.invalidateQueries({ queryKey: keys.take(uid) }) : null,
      qc.invalidateQueries({ queryKey: keys.feed }),
      qc.invalidateQueries({ queryKey: ["song"] }),
      qc.invalidateQueries({ queryKey: keys.trash }),
    ])
}

/** ★ on or off, shown at once, before the service answers. */
export function useStar(uid: string) {
  const qc = useQueryClient()
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (on: boolean) =>
      data(on ? client.api.takes[":uid"].star.$post({ param: { uid } }) : client.api.takes[":uid"].star.$delete({ param: { uid } })),
    onMutate: async (on) => {
      await qc.cancelQueries({ queryKey: keys.take(uid) })
      const before = qc.getQueryData<TakePage>(keys.take(uid))
      const me = qc.getQueryData<Me>(keys.me)
      if (before && me) {
        const others = before.stars.filter((s) => s.member_id !== me.id)
        const mine = { member_id: me.id, initial: (Array.from(me.name.trim())[0] ?? "?").toUpperCase(), name: me.name }
        qc.setQueryData<TakePage>(keys.take(uid), {
          ...before,
          starred_by_me: on,
          stars: on ? [...others, mine].sort((a, b) => a.name.localeCompare(b.name)) : others,
        })
      }
      return { before }
    },
    onError: (_e, _on, saved) => {
      if (saved?.before) qc.setQueryData(keys.take(uid), saved.before)
    },
    onSettled: () => refresh(uid),
  })
}

/** The member opened the take: it and its comments are no longer new for them. */
export function useSeen(uid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => data(client.api.takes[":uid"].seen.$post({ param: { uid } })),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: keys.feed }), qc.invalidateQueries({ queryKey: ["song"] })]),
  })
}

export function useComment(uid: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (json: { at: number; text: string; parent_id?: number }) =>
      data(client.api.takes[":uid"].comments.$post({ param: { uid }, json })),
    onSuccess: () => refresh(uid),
  })
}

export function useCloseComment(uid: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, closed }: { id: number; closed: boolean }) =>
      data(client.api.comments[":id"].$patch({ param: { id: String(id) }, json: { closed } })),
    onSuccess: () => refresh(uid),
  })
}

export function useRestore() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (uid: string) => data(client.api.trash[":uid"].restore.$post({ param: { uid } })),
    onSuccess: (_d, uid) => refresh(uid),
  })
}

export function useSaveName() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => data(client.api.me.$put({ json: { name } })),
    onSuccess: () => qc.invalidateQueries(),
  })
}

function useMembersChange<T>(call: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: call,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.members }), qc.invalidateQueries({ queryKey: keys.keys })]),
  })
}

export const useAddMember = () =>
  useMembersChange((email: string) => data(client.api.members.$post({ json: { email } })))

export const useRemoveMember = () =>
  useMembersChange((id: string) => data(client.api.members[":id"].$delete({ param: { id } })))

export const useSignOutMember = () =>
  useMembersChange((id: string) => data(client.api.members[":id"].signout.$post({ param: { id } })))

export const useMakeKey = () => useMembersChange((name: string) => data(client.api.keys.$post({ json: { name } })))

export const useRemoveKey = () => useMembersChange((id: string) => data(client.api.keys[":id"].$delete({ param: { id } })))
