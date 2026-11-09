import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router"
import { meQuery, queryClient, whenSignedOut } from "./api"
import { Home } from "./home/Home"
import { Marks } from "./marks/Marks"
import { Members } from "./members/Members"
import { Rehearsal } from "./rehearsals/Rehearsal"
import { Rehearsals } from "./rehearsals/Rehearsals"
import { Sets } from "./sets/Sets"
import { Stage } from "./sets/Stage"
import { Shell } from "./shell/Shell"
import { Name } from "./signin/Name"
import { SignIn } from "./signin/SignIn"
import { Song } from "./songs/Song"
import { Songs } from "./songs/Songs"
import { Take } from "./takes/Take"
import { Trash } from "./trash/Trash"

/*
  The pages' addresses, written out here. Sign-in, the name and a set's
  stage view stand alone; the rest are inside the shell: the column of
  sections, the panel and the player.
*/

/** Where to go back to after signing in: a path on this site, never another one. */
const back = (search: Record<string, unknown>) => {
  const to = search.redirect
  return { redirect: typeof to === "string" && to.startsWith("/") && !to.startsWith("//") ? to : undefined }
}

const root = createRootRoute({ component: Outlet })

const signIn = createRoute({ getParentRoute: () => root, path: "/signin", validateSearch: back, component: SignIn })
const name = createRoute({ getParentRoute: () => root, path: "/name", validateSearch: back, component: Name })

/**
 * A member with no name yet is asked for one first, then comes back here.
 * A session that has ended is sent to sign-in by whenSignedOut below.
 */
const named = async ({ location }: { location: { href: string } }) => {
  const me = await queryClient.ensureQueryData(meQuery).catch(() => undefined)
  if (me && !me.name) throw redirect({ to: "/name", search: { redirect: location.href }, replace: true })
}

const shell = createRoute({
  getParentRoute: () => root,
  id: "band",
  beforeLoad: named,
  // ?panel= is the panel open over the page (shell/panel.tsx).
  validateSearch: (search: Record<string, unknown>): { panel?: string } => (typeof search.panel === "string" ? { panel: search.panel } : {}),
  component: Shell,
})
const home = createRoute({ getParentRoute: () => shell, path: "/", component: Home })
const rehearsals = createRoute({ getParentRoute: () => shell, path: "/rehearsals", component: Rehearsals })
const rehearsal = createRoute({ getParentRoute: () => shell, path: "/rehearsals/$uid", component: Rehearsal })
/** ?edit= is the editor open at the top of the page (shell/editor.ts). */
const editOf =
  <K extends string>(...kinds: K[]) =>
  (search: Record<string, unknown>): { edit?: K } =>
    kinds.includes(search.edit as K) ? { edit: search.edit as K } : {}
const songs = createRoute({ getParentRoute: () => shell, path: "/songs", validateSearch: editOf("statuses", "new-song"), component: Songs })
const song = createRoute({ getParentRoute: () => shell, path: "/songs/$id", component: Song })
/** On a computer the list and the picked set beside it; on a phone the list, then the set on its own page. */
const sets = createRoute({ getParentRoute: () => shell, path: "/sets", component: Sets })
const set = createRoute({ getParentRoute: () => shell, path: "/sets/$id", component: Sets })
/** **On stage**: the set's song number `n`, from 1, over the whole screen. */
const stage = createRoute({ getParentRoute: () => root, path: "/stage/$id/$n", beforeLoad: named, component: Stage })
const marks = createRoute({ getParentRoute: () => shell, path: "/marks", validateSearch: editOf("labels"), component: Marks })
const members = createRoute({ getParentRoute: () => shell, path: "/members", component: Members })
const trash = createRoute({ getParentRoute: () => shell, path: "/trash", component: Trash })
const take = createRoute({
  getParentRoute: () => shell,
  path: "/takes/$uid",
  // ?at= puts the playhead there; ?mark= or ?comment= is what a link from
  // the band's chat is about, and the page scrolls to it.
  validateSearch: (search: Record<string, unknown>): { at?: number; mark?: number; comment?: number } => {
    const n = (v: unknown) => {
      const x = Number(v)
      return v !== undefined && Number.isFinite(x) && x >= 0 ? x : undefined
    }
    const out: { at?: number; mark?: number; comment?: number } = {}
    const [at, mark, comment] = [n(search.at), n(search.mark), n(search.comment)]
    if (at !== undefined) out.at = at
    if (mark !== undefined) out.mark = mark
    if (comment !== undefined) out.comment = comment
    return out
  },
  component: Take,
})

export const router = createRouter({
  routeTree: root.addChildren([
    signIn,
    name,
    stage,
    shell.addChildren([home, rehearsals, rehearsal, songs, song, sets, set, marks, members, trash, take]),
  ]),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

// A session that has ended sends the page to sign-in, and back here after.
whenSignedOut(() => {
  const { pathname, href } = router.state.location
  if (pathname === "/signin") return
  queryClient.clear()
  void router.navigate({ to: "/signin", search: { redirect: href }, replace: true })
})
