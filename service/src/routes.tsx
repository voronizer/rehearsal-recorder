import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router"
import { meQuery, queryClient, whenSignedOut } from "./api"
import { First } from "./feed/First"
import { Members } from "./members/Members"
import { Shell } from "./shell/Shell"
import { Name } from "./signin/Name"
import { SignIn } from "./signin/SignIn"
import { Song } from "./songs/Song"
import { Take } from "./takes/Take"
import { Trash } from "./trash/Trash"

/*
  The pages' addresses, written out here. Sign-in and the name stand alone;
  the rest are inside the shell, the column of songs on a computer.
*/

/** Where to go back to after signing in: a path on this site, never another one. */
const back = (search: Record<string, unknown>) => {
  const to = search.redirect
  return { redirect: typeof to === "string" && to.startsWith("/") && !to.startsWith("//") ? to : undefined }
}

const root = createRootRoute({ component: Outlet })

const signIn = createRoute({ getParentRoute: () => root, path: "/signin", validateSearch: back, component: SignIn })
const name = createRoute({ getParentRoute: () => root, path: "/name", validateSearch: back, component: Name })

const shell = createRoute({
  getParentRoute: () => root,
  id: "band",
  // A member with no name yet is asked for one first, then comes back here.
  // A session that has ended is sent to sign-in by whenSignedOut below.
  beforeLoad: async ({ location }) => {
    const me = await queryClient.ensureQueryData(meQuery).catch(() => undefined)
    if (me && !me.name) throw redirect({ to: "/name", search: { redirect: location.href }, replace: true })
  },
  component: Shell,
})
const first = createRoute({ getParentRoute: () => shell, path: "/", component: First })
const song = createRoute({ getParentRoute: () => shell, path: "/songs/$id", component: Song })
const take = createRoute({
  getParentRoute: () => shell,
  path: "/takes/$uid",
  // ?at= puts the playhead there: links from the band's chat carry it.
  validateSearch: (search: Record<string, unknown>): { at?: number } => {
    const at = Number(search.at)
    return Number.isFinite(at) && at >= 0 ? { at } : {}
  },
  component: Take,
})
const trash = createRoute({ getParentRoute: () => shell, path: "/trash", component: Trash })
const members = createRoute({ getParentRoute: () => shell, path: "/members", component: Members })

export const router = createRouter({
  routeTree: root.addChildren([signIn, name, shell.addChildren([first, song, take, trash, members])]),
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
