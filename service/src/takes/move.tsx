import { useEffect, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { Check } from "lucide-react"
import { Command, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { fold, same, TAKE_NAME } from "../../worker/shared/names"
import { useMoveTake, useSongs } from "../api"
import { InPlace } from "../shell/InPlace"
import { ErrorLine } from "../shell/parts"

/**
 * ⋯ › **Move to song** (Alex, 5 November: in the menu, a list of the songs
 * and a field for a new one; **Not named** first, to take it out of its
 * song). РЭХА renames the take at its next check.
 */

/** A take as the menu knows it: a row has its song's number, a page its song. */
export type Movable = { uid: string; song_id?: number | null; song?: { id: number } | null }

const songOf = (t: Movable) => t.song?.id ?? t.song_id ?? null

/** The list's values for a take with no song, and for New song…. */
const NONE = "none"
const NEW = "new"

/** The take whose line has the field for a new song open. */
let naming: string | null = null
const heard = new Set<() => void>()
function setNaming(uid: string | null) {
  naming = uid
  heard.forEach((f) => f())
}
const useNaming = (uid: string) =>
  useSyncExternalStore(
    (f) => (heard.add(f), () => heard.delete(f)),
    () => naming === uid
  )
/** Fields open now: one that goes with its page closes, so it is not there when the page opens again. */
let shown = 0
function useShown() {
  useEffect(() => {
    shown++
    return () => {
      shown--
      // After a moment: React mounts a field twice while developing.
      queueMicrotask(() => shown === 0 && setNaming(null))
    }
  }, [])
}

/** A ticked line's look and its tick, as the menu's own radio lines have them. */
const LINE = "cursor-pointer pr-2 pl-8"
const tick = (on: boolean) => (
  <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">{on && <Check className="size-4 text-foreground" />}</span>
)

/**
 * **Not named**, then the band's songs, with the take's place ticked, then
 * **New song…**; over them a search, focused as the list opens (S16), that
 * keeps the songs whose title has what is typed. Not named and New song…
 * stay whatever is typed. From a row, New song… opens the take's page
 * first: the field stands in its line.
 */
export function MoveSub({
  take,
  move,
  row,
  onNew,
  onDone,
}: {
  take: Movable
  move: ReturnType<typeof useMoveTake>
  row?: boolean
  onNew: () => void
  /** A line was picked: the menu closes. */
  onDone: () => void
}) {
  const songs = useSongs().data?.songs ?? []
  const navigate = useNavigate()
  const here = useRouterState({ select: (s) => s.location.pathname === `/takes/${take.uid}` })
  const own = songOf(take)
  const [search, setSearch] = useState("")
  const typed = fold(search)
  const shown = typed ? songs.filter((s) => fold(s.title).includes(typed)) : songs
  const to = (song: number | null) => {
    onDone()
    if (song !== own) move.mutate({ uid: take.uid, song })
  }
  // The menu's own keys stop here, so a letter goes into the search and not
  // to the menu's typeahead; Esc still closes it, and ← in an empty search
  // goes back to the menu.
  const keep = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Tab" || (e.key === "ArrowLeft" && !search)) return
    e.stopPropagation()
  }
  return (
    <DropdownMenuSub onOpenChange={(open) => !open && setSearch("")}>
      <DropdownMenuSubTrigger>Move to song</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56 p-0">
        {/* The search is this list's own (shouldFilter off): the Command
            would sort what it finds and put Not named at the bottom. */}
        <Command label="Move to song" shouldFilter={false} loop defaultValue={own === null ? NONE : `song-${own}`} onKeyDown={keep}>
          <CommandInput autoFocus value={search} onValueChange={setSearch} />
          {/* The songs come first in the page, so the first one found is the
              one Enter picks; Not named is drawn over them. ↑ and ↓ go round,
              in the order the lines are drawn. */}
          <CommandList label="Move to song" className="max-h-72 p-1 [&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:flex-col">
            {shown.map((s) => (
              <CommandItem key={s.id} value={`song-${s.id}`} aria-checked={s.id === own} onSelect={() => to(s.id)} className={LINE}>
                {tick(s.id === own)}
                <span className="truncate">{s.title}</span>
              </CommandItem>
            ))}
            {shown.length > 0 && <CommandSeparator alwaysRender className="order-1 my-1" />}
            <CommandItem
              value={NEW}
              onSelect={() => {
                onNew()
                onDone()
                if (row && !here) void navigate({ to: "/takes/$uid", params: { uid: take.uid } })
                setNaming(take.uid)
              }}
              className="order-2 cursor-pointer"
            >
              New song…
            </CommandItem>
            <CommandSeparator alwaysRender className="-order-1 my-1" />
            <CommandItem value={NONE} aria-checked={own === null} onSelect={() => to(null)} className={cn(LINE, "-order-2")}>
              {tick(own === null)}
              Not named
            </CommandItem>
          </CommandList>
        </Command>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** New song…: a field in the take's line; Enter or ✓ makes the song with this take in it. */
function NewSongField({ take }: { take: Movable }) {
  const [text, setText] = useState("")
  const songs = useSongs().data?.songs ?? []
  const move = useMoveTake()
  useShown()
  const t = text.trim()
  const other = songs.find((s) => same(s.title, t))
  const refused = TAKE_NAME.test(t) ? `${t} is what a take with no song is called.` : other ? `“${other.title}” is already a song: pick it in the list.` : ""
  const said = refused || move.error?.message
  const go = () => {
    if (t && !refused) move.mutate({ uid: take.uid, new_song: t }, { onSuccess: () => setNaming(null) })
  }
  return (
    <>
      <InPlace
        small
        label="New song"
        maxLength={100}
        value={text}
        placeholder="New song"
        onChange={(next) => {
          move.reset()
          setText(next)
        }}
        ok={{ label: "Make the song", disabled: !t || !!refused || move.isPending }}
        onOk={go}
        leave="Leave it where it is"
        onLeave={() => setNaming(null)}
        className="w-56"
        inputClassName="text-xs text-foreground"
      />
      {/* Its line for what went wrong (S11), a line of its own under the
          take's line, so the pills beside the field stay where they are. */}
      <ErrorLine error={said} className="order-last basis-full" />
    </>
  )
}

/** The take's song in its line, or while New song… is open, the field in its place. */
export function SongWord({ take, children }: { take: Movable; children?: ReactNode }) {
  const open = useNaming(take.uid)
  if (!open) return <>{children}</>
  return (
    <>
      <span>{" · "}</span>
      <NewSongField take={take} />
    </>
  )
}
