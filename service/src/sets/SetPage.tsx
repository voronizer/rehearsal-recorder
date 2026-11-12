import { useEffect, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { Ellipsis, GripVertical, Mic, Pencil, Printer, X } from "lucide-react"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { SongPills } from "@/components/SongPills"
import { SortableList } from "@/components/SortableList"
import { Button, OPENS } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatMeter } from "@/lib/format"
import { cn } from "@/lib/utils"
import { same } from "../../worker/shared/names"
import { useChangeSet, useDeleteSet, useSongs, useTypeLength, type BandSet, type SongItem } from "../api"
import { InPlace, lineUnder } from "../shell/InPlace"
import { Back, BARE, ErrorLine, Group, Groups, Page, PAGE_TITLE } from "../shell/parts"
import { useSize } from "../shell/size"
import { clock, quoted } from "../shell/words"
import { lengthOf, parseLength, setLine, songsOf } from "./length"
import { PrintSheet } from "./Print"

/*
  A set's page, as РЭХА's Settings › Sets edits a set (Alex's pick, 9
  November): its name renamed where it stands, and its songs with a handle
  to drag, a number, ✕ to take one out, and the band's other songs as pills
  under them. Each change is saved at once.
*/

/** As long as a set's name can be, in РЭХА and the service (worker/sets/store.ts). */
const NAME_MAX = 40

/** The line under a set's name, its songs and length; while the name is a field, why a new one is turned down, in its place. */
const { say, Line: NameLine } = lineUnder()

/** The set **New set** just made: its page opens with the name selected, to be typed over. */
let fresh: number | null = null
export const madeNow = (id: number) => {
  fresh = id
}

/**
 * A set's songs as its page shows them. A change shows at once and is
 * saved; while it is on its way the page keeps it, so a song dragged does
 * not jump back.
 */
function useSetSongs(set: BandSet) {
  const all = useSongs().data?.songs ?? []
  const change = useChangeSet()
  const [held, setHeld] = useState<number[] | null>(null)
  const ids = held ?? set.songs
  const put = (next: number[]) => {
    setHeld(next)
    // Only the last change's: by then the band's sets are read again.
    change.mutate({ id: set.id, songs: next }, { onSettled: () => setHeld(null) })
  }
  return { ids, songs: songsOf(ids, all), all, put, error: change.error }
}
type SetSongs = ReturnType<typeof useSetSongs>

/**
 * The set's heading line: the name, renamed where it stands as a song's
 * title is (songs/edit.tsx): ✎ turns it into a field with ✓ and ✕; Enter
 * or ✓ renames, Esc or ✕ leaves it, and why a name is turned down takes
 * the place of the set's line under it (`NameLine`), as a song's title
 * does. Beside it, outside the heading, **Print**, **On stage** and ⋯ ›
 * **Delete set**. `big`: the page's own heading, on a phone.
 */
function SetHead({ set, songs, big }: { set: BandSet; songs: SongItem[]; big?: boolean }) {
  const [editing, setEditing] = useState(() => fresh === set.id)
  const [name, setName] = useState(set.name)
  const [asking, setAsking] = useState(false)
  const change = useChangeSet()
  const remove = useDeleteSet()
  const navigate = useNavigate()
  useEffect(() => {
    if (fresh === set.id) fresh = null
  }, [set.id])
  const refused = change.error?.message ?? ""
  useEffect(() => {
    if (editing) say({ id: set.id, text: refused, bad: true })
  }, [editing, refused, set.id])
  useEffect(() => () => say(null), [])
  const stop = () => {
    setEditing(false)
    say(null)
    change.reset()
  }
  const go = () => {
    const typed = name.trim()
    if (!typed) return
    if (typed === set.name) return stop()
    change.mutate({ id: set.id, name: typed }, { onSuccess: stop })
  }
  const title = editing ? (
    <InPlace
      label="Set's name"
      selectAll
      maxLength={NAME_MAX}
      value={name}
      invalid={!!change.error}
      onChange={(n) => {
        change.reset()
        setName(n)
      }}
      ok={{ label: "Rename", disabled: !name.trim() || change.isPending }}
      onOk={go}
      leave="Leave the name as it was"
      onLeave={stop}
      className="w-80 max-w-full"
      inputClassName={cn("font-semibold", big ? "text-xl md:text-xl" : "text-base md:text-base")}
    />
  ) : (
    <span className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 [overflow-wrap:anywhere]">{set.name}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-row"
            aria-label={`Rename set ${set.name}`}
            onClick={() => {
              setName(set.name)
              setEditing(true)
            }}
          >
            <Pencil className="text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Rename set</TooltipContent>
      </Tooltip>
    </span>
  )
  const Heading = big ? "h1" : "h2"
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Heading className={cn("min-w-0", big ? PAGE_TITLE : "text-base font-semibold")}>{title}</Heading>
      <span className="flex-1" />
      {/* The three wrap together on a phone, so ⋯ is never on a line of its own. */}
      <span className="flex items-center gap-3">
        <Button variant="outline" size="row" onClick={() => window.print()}>
          <Printer />
          Print
        </Button>
        <Button size="row" disabled={!songs.length} onClick={() => void navigate({ to: "/stage/$id/$n", params: { id: String(set.id), n: "1" } })}>
          <Mic />
          On stage
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-row" aria-label={`What to do with ${set.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setAsking(true)}>Delete set</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      <FieldError>{remove.error?.message}</FieldError>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={asking ? `Delete ${quoted(set.name)}?` : null}
        description={asking ? "It goes to the Trash, where anyone in the band can put it back for 30 days. Its songs stay as they are." : null}
        actionLabel="Delete set"
        destructive={false}
        // Once it is gone, to the list: on a computer the first set is picked there.
        onConfirm={() => void remove.mutateAsync(set.id).then(() => navigate({ to: "/sets", replace: true }), () => {})}
      />
    </div>
  )
}

/**
 * The song's length in the set: its best take's, or one typed. Pressed, it
 * is an “m:ss” field: Enter keeps what was typed, an empty field goes back
 * to the best take's, and Esc or a press elsewhere leaves it as it was.
 */
function LengthCell({ song }: { song: SongItem }) {
  const type = useTypeLength()
  const [field, setField] = useState<{ text: string; from: string } | null>(null)
  const [bad, setBad] = useState(false)
  const sec = lengthOf(song)
  const close = () => {
    setField(null)
    setBad(false)
    type.reset()
  }
  if (field)
    return (
      // The field, 4 px taller than the words it opens from, and its line
      // for what went wrong lie in the row's own room above and below, so
      // the row keeps its height (B4); the line runs left from under the field.
      <Field className="-mt-0.5 -mb-6.5 w-16 shrink-0 gap-1">
        <Input
          autoFocus
          value={field.text}
          placeholder="m:ss"
          aria-label={`Length of ${song.title}`}
          aria-invalid={bad || !!type.error}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setField({ ...field, text: e.target.value })
            setBad(false)
            type.reset()
          }}
          onBlur={close}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              e.stopPropagation()
              close()
            }
            if (e.key !== "Enter") return
            e.preventDefault()
            // Nothing changed: the best take's length stays the best take's.
            if (field.text.trim() === field.from) return close()
            const typed = parseLength(field.text)
            if (typed === "bad") return setBad(true)
            type.mutate({ id: song.id, length: typed }, { onSuccess: close })
          }}
          className="tnum h-7 w-16 px-1.5"
        />
        <ErrorLine error={type.error?.message} className="flex justify-end whitespace-nowrap" />
      </Field>
    )
  const hint =
    song.typed_length !== null
      ? "Typed in. Empty it to use the best take's length again."
      : sec !== null
        ? "The best take's length. Press it to type your own."
        : "Press it to type a length."
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="link"
          onClick={() => {
            const text = sec !== null ? clock(sec) : ""
            setField({ text, from: text })
          }}
          className={cn(BARE, "tnum w-fit", sec === null && "text-xs text-muted-foreground")}
        >
          {sec !== null ? clock(sec) : "no takes"}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

const COLS = "grid-cols-[1.5rem_minmax(0,1fr)_6rem_4rem_4rem]"

/** A song of the set: its number, its title as a link to it, its key, tempo and length. */
function SongCells({ at, song }: { at: number; song: SongItem }) {
  const size = useSize()
  const title = (
    <Link to="/songs/$id" params={{ id: String(song.id) }} className={cn("truncate text-left", OPENS)}>
      {song.title}
    </Link>
  )
  if (size === "wide")
    return (
      <div className={cn("grid min-w-0 flex-1 items-center gap-3", COLS)}>
        <span className="tnum text-right text-xs text-muted-foreground">{at + 1}</span>
        <span className="min-w-0 truncate">{title}</span>
        <span>{song.key}</span>
        <span className="tnum">{song.tempo !== null ? Math.round(song.tempo) : ""}</span>
        <LengthCell song={song} />
      </div>
    )
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span className="tnum w-5 shrink-0 text-right text-xs text-muted-foreground">{at + 1}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[song.key, song.tempo !== null && formatMeter(Math.round(song.tempo), song.signature ?? "4/4")].filter(Boolean).join(" · ")}
        </span>
      </span>
      <LengthCell song={song} />
    </div>
  )
}

/** The columns' names over the songs, on a computer's window. */
function Head() {
  if (useSize() !== "wide") return null
  return (
    <div className={cn("grid gap-3 px-8 text-xs text-muted-foreground", COLS)}>
      <span />
      <span>Song</span>
      <span>Key</span>
      <span>Tempo</span>
      <span>Length</span>
    </div>
  )
}

/** The set's songs, dragged into order by their handles; ✕ takes one out. */
function Editable({ ids, songs, put }: Pick<SetSongs, "ids" | "songs" | "put">) {
  if (!songs.length) return <p className="text-muted-foreground">No songs yet. Add them in the order you play them.</p>
  return (
    // No lines between the songs, 24 px from one to the next, as every list of the service.
    <SortableList
      items={songs.map((s) => ({ id: s.id, song: s }))}
      label="Songs of the set"
      lines={false}
      onMove={(id, to) => {
        const next = ids.filter((x) => x !== id)
        next.splice(to, 0, id)
        put(next)
      }}
    >
      {({ song }, handleRef) => (
        <div data-song={song.title} className="flex min-h-9 items-center gap-2 py-3">
          <Button
            ref={handleRef}
            variant="ghost"
            size="icon-tiny"
            aria-label={`Move ${song.title}`}
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          >
            <GripVertical className="size-4" />
          </Button>
          <SongCells at={songs.indexOf(song)} song={song} />
          <Button
            variant="ghost"
            size="icon-tiny"
            aria-label={`Take ${song.title} out`}
            onClick={() => put(ids.filter((x) => x !== song.id))}
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            <X />
          </Button>
        </div>
      )}
    </SortableList>
  )
}

/** **Add**, under the songs: a field and the band's songs not in the set as pills, with **All songs…**. */
function AddSongs({ ids, all, put }: Pick<SetSongs, "ids" | "all" | "put">) {
  const [typed, setTyped] = useState("")
  const left = all.filter((s) => !ids.includes(s.id))
  const add = (title: string) => {
    const s = left.find((x) => same(x.title, title))
    if (!s) return
    put([...ids, s.id])
    setTyped("")
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Add</span>
      {left.length ? (
        <>
          <Input
            aria-label="Another song"
            value={typed}
            placeholder="Another song…"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              e.preventDefault()
              add(typed)
            }}
            className="h-8 max-w-64"
          />
          <SongPills choices={{ here: [], other: left.map((s) => ({ song: s.title, go: 1 })) }} value={typed} initial="" onPick={add} goes={false} rows={3} />
        </>
      ) : (
        <p className="text-muted-foreground">All the band's songs are in the set.</p>
      )}
    </div>
  )
}

/** The set's songs to edit, and under them what to add. */
function SetBody({ songs }: { songs: SetSongs }) {
  return (
    <Groups>
      <Group>
        {songs.songs.length > 0 && <Head />}
        <Editable ids={songs.ids} songs={songs.songs} put={songs.put} />
        <FieldError>{songs.error && `Not saved: ${songs.error.message}`}</FieldError>
      </Group>
      <Group>
        <AddSongs ids={songs.ids} all={songs.all} put={songs.put} />
      </Group>
    </Groups>
  )
}

/** On a computer, the picked set beside the list of sets, as РЭХА has it. */
export function SetPane({ set }: { set: BandSet }) {
  const songs = useSetSongs(set)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SetHead set={set} songs={songs.songs} />
        <NameLine id={set.id}>
          <p className="text-muted-foreground">{setLine(songs.songs)}</p>
        </NameLine>
      </div>
      <SetBody songs={songs} />
      <PrintSheet set={set} songs={songs.songs} />
    </div>
  )
}

/** On a phone, a set on its own page, with **Sets** to go back. */
export function SetPage({ set }: { set: BandSet }) {
  const songs = useSetSongs(set)
  return (
    <Page head={<Back to="/sets" label="Sets" />} heading={<SetHead set={set} songs={songs.songs} big />} sub={<NameLine id={set.id}>{setLine(songs.songs)}</NameLine>}>
      <SetBody songs={songs} />
      <PrintSheet set={set} songs={songs.songs} />
    </Page>
  )
}
