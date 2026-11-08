import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { same, TAKE_NAME } from "../../worker/shared/names"
import { useMoveTake, useSongs } from "../api"
import { usePanel } from "../shell/panel"

/**
 * ⋯ › **Move to song** (Alex, 5 November: in the menu, a list of the songs
 * and a field for a new one; **Not named** first, to take it out of its
 * song). РЭХА renames the take at its next check.
 */

/** A take as the menu knows it: a row has its song's number, a page its song. */
export type Movable = { uid: string; song_id?: number | null; song?: { id: number } | null }

const songOf = (t: Movable) => t.song?.id ?? t.song_id ?? null

/** The list's value for a take with no song. */
const NONE = "none"

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
/** Fields open now: one that goes with its panel closes, so it is not there when the panel opens again. */
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

/**
 * **Not named**, then the band's songs, with the take's place ticked, then
 * **New song…**. From a row, New song… opens the take's panel first (on a
 * phone its page): the field stands in its line.
 */
export function MoveSub({
  take,
  move,
  row,
  onNew,
}: {
  take: Movable
  move: ReturnType<typeof useMoveTake>
  row?: boolean
  onNew: () => void
}) {
  const songs = useSongs().data?.songs ?? []
  const { panel, open } = usePanel()
  const own = songOf(take)
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Move to song</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={own === null ? NONE : String(own)}
          onValueChange={(v) => {
            const to = v === NONE ? null : Number(v)
            if (to !== own) move.mutate({ uid: take.uid, song: to })
          }}
        >
          <DropdownMenuRadioItem value={NONE}>Not named</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {songs.map((s) => (
            <DropdownMenuRadioItem key={s.id} value={String(s.id)}>
              <span className="truncate">{s.title}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {songs.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onSelect={() => {
            onNew()
            if (row && !(panel?.kind === "take" && panel.uid === take.uid)) open({ kind: "take", uid: take.uid })
            setNaming(take.uid)
          }}
        >
          New song…
        </DropdownMenuItem>
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
    <span className="inline-flex flex-wrap items-center gap-1">
      <Input
        aria-label="New song"
        autoFocus
        maxLength={100}
        value={text}
        placeholder="New song"
        onChange={(e) => {
          move.reset()
          setText(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            go()
          } else if (e.key === "Escape") {
            // The panel closes on Esc too; here it only leaves the field.
            e.preventDefault()
            e.stopPropagation()
            setNaming(null)
          }
        }}
        className="h-7 w-44 px-2 text-xs text-foreground"
      />
      <Button variant="ghost" size="icon-tiny" aria-label="Make the song" disabled={!t || !!refused || move.isPending} onClick={go}>
        <Check />
      </Button>
      <Button variant="ghost" size="icon-tiny" aria-label="Leave it where it is" onClick={() => setNaming(null)}>
        <X />
      </Button>
      {said && (
        <span role="alert" className="text-destructive">
          {said}
        </span>
      )}
    </span>
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
