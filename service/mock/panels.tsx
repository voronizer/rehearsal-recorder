import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronDown, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { useAt, usePanel, usePlayer } from "./context"
import { isNew } from "./data"
import {
  addComment,
  addMark,
  bestOf,
  fmt,
  marksOf,
  memberOf,
  setMarkClosed,
  setSong,
  songOf,
  takeOf,
  useData,
  type Mark,
  type Song,
} from "./data"
import { Play } from "./Home"
import { Diamond, Dot, Group, Groups, Props, Rows, StarButton, TakeLink, TakeName, Tile, Wave } from "./parts"

export const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"].flatMap((n) => [`${n} major`, `${n} minor`])

// ---------- a song's parts, on its panel and its page ----------

export function StatusMenu({ song }: { song: Song }) {
  const data = useData()
  const { open } = usePanel()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="row" className="gap-1">
          {song.status}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup value={song.status} onValueChange={(status) => setSong(song.id, { status })}>
          {data.statuses.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {s}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => open({ kind: "statuses" })}>Edit statuses</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function KeySelect({ song }: { song: Song }) {
  return (
    <Select value={song.key || "none"} onValueChange={(v) => setSong(song.id, { key: v === "none" ? "" : v })}>
      <SelectTrigger size="sm" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Not set</SelectItem>
        {KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {k}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function BestTake({ song, big }: { song: Song; big?: boolean }) {
  const data = useData()
  const best = bestOf(data, song.title)
  if (!best) return <p className="text-muted-foreground">No takes yet. They come from РЭХА under the title “{song.title}”.</p>
  return (
    <Tile>
      <div className="flex items-center gap-3">
        <Play uid={best.take.uid} className={big ? "size-12" : undefined} />
        <Wave uid={best.take.uid} height={big ? 96 : 48} className="flex-1" />
        <StarButton take={best.take} />
      </div>
      <p className="text-muted-foreground">
        <TakeLink uid={best.take.uid} className="text-foreground" /> · {fmt(best.take.len)}
      </p>
    </Tile>
  )
}

export function Notes({ song }: { song: Song }) {
  const [edit, setEdit] = useState<string | null>(null)
  if (edit !== null)
    return (
      <Tile>
        <textarea
          autoFocus
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          rows={6}
          placeholder="Words, the form, who starts"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <div className="flex gap-2">
          <Button size="row" onClick={() => (setSong(song.id, { notes: edit }), setEdit(null))}>
            Save notes
          </Button>
          <Button size="row" variant="ghost" onClick={() => setEdit(null)}>
            Cancel
          </Button>
        </div>
      </Tile>
    )
  return (
    <Tile>
      {song.notes ? <p className="whitespace-pre-line">{song.notes}</p> : <p className="text-muted-foreground">No notes yet.</p>}
      <Button variant="outline" size="row" className="self-start" onClick={() => setEdit(song.notes)}>
        Edit notes
      </Button>
    </Tile>
  )
}

export function Files({ song }: { song: Song }) {
  if (!song.files.length) return <p className="text-muted-foreground">No files yet: the song's chart, words, a Guitar Pro file.</p>
  return (
    <Rows>
      {song.files.map((f) => (
        <div key={f.name} className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-[10px] font-semibold text-muted-foreground ring-1 ring-border">{f.kind}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate">{f.name}</div>
            <div className="truncate text-xs text-muted-foreground">{f.note}</div>
          </div>
          <Button
            variant="ghost"
            size="icon-row"
            aria-label={`Remove ${f.name}`}
            onClick={() => setSong(song.id, { files: song.files.filter((x) => x !== f) })}
          >
            <X className="text-muted-foreground" />
          </Button>
        </div>
      ))}
    </Rows>
  )
}

export const AddFile = () => (
  <Button variant="outline" size="row">
    Add a file
  </Button>
)

// ---------- the song's panel ----------

export function SongPanel({ id }: { id: string }) {
  const data = useData()
  const { close } = usePanel()
  const g = songOf(data, id)
  const best = bestOf(data, g.title)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 truncate text-xl font-semibold">{g.title}</h2>
        <Button asChild variant="outline" size="row">
          <Link to="/songs/$id" params={{ id }} onClick={close}>
            Song's page
            <ChevronRight />
          </Link>
        </Button>
        <Button variant="ghost" size="icon-row" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </div>
      <Groups>
        <Group>
          <Props
            rows={[
              ["Status", <StatusMenu song={g} />],
              ["Key", <KeySelect song={g} />],
              ["Tempo", g.bpm ? <span>{g.bpm} bpm <span className="text-xs text-muted-foreground">from РЭХА</span></span> : <span className="text-muted-foreground">Not set in РЭХА yet</span>],
              ["Length", best ? <span className="flex items-center gap-1.5"><span className="tnum">{fmt(best.take.len)}</span><span className="text-xs text-muted-foreground">of</span><TakeName take={best.take} className="text-xs text-muted-foreground" /></span> : <span className="text-muted-foreground">—</span>],
            ]}
          />
        </Group>
        <Group title="Best take" hint={best?.why}>
          <BestTake song={g} />
        </Group>
        <Group title="Notes">
          <Notes song={g} />
        </Group>
        <Group title="Files" action={<AddFile />}>
          <Files song={g} />
        </Group>
      </Groups>
    </div>
  )
}

// ---------- the take's panel ----------

const TRACKS = ["Drums", "Bass", "Guitar", "Vocals"]

export function Lanes({ uid }: { uid: string }) {
  const [mute, setMute] = useState<string[]>([])
  const [solo, setSolo] = useState<string[]>([])
  const flip = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])
  return (
    <Rows>
      {TRACKS.map((tr) => (
        <div key={tr} className="flex items-center gap-3">
          <span className="w-14 shrink-0">{tr}</span>
          <Toggle size="lane" variant="outline" pressed={mute.includes(tr)} onPressedChange={() => setMute(flip(mute, tr))} aria-label={`Mute ${tr}`}>
            M
          </Toggle>
          <Toggle size="lane" variant="outline" pressed={solo.includes(tr)} onPressedChange={() => setSolo(flip(solo, tr))} aria-label={`Solo ${tr}`}>
            S
          </Toggle>
          <Wave uid={uid} seed={`${uid}-${tr}`} height={26} className="flex-1" />
        </div>
      ))}
    </Rows>
  )
}

/**
 * A mark: its colour, its moment and what it says on one line; who set it
 * and when under that; the comments under that, all on one edge. `take`
 * names the take where the list mixes takes ("short" when the song is the
 * group's heading). `compact` is for Home: the last comment only, no
 * actions, and the row opens the take.
 */
export function MarkItem({ mark, take, compact }: { mark: Mark; take?: "full" | "short"; compact?: boolean }) {
  const data = useData()
  const p = usePlayer()
  const { open } = usePanel()
  const [reply, setReply] = useState<string | null>(null)
  const label = data.labels[mark.label]
  const who = mark.fromReha ? "Set in РЭХА" : memberOf(data, mark.by)?.name
  const comments = compact ? mark.comments.slice(-1) : mark.comments
  return (
    <div className={cn("grid grid-cols-[0.625rem_2.25rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1", mark.closed && "opacity-60")}>
      <Diamond colour={label.colour} className="translate-y-[-1px]" />
      <button type="button" className="tnum text-left text-muted-foreground hover:text-foreground" onClick={() => (compact ? open({ kind: "take", uid: mark.take }) : p.seek(mark.take, mark.at))}>
        {fmt(mark.at)}
      </button>
      <button type="button" className="text-left" onClick={() => compact && open({ kind: "take", uid: mark.take })}>
        {mark.note}
      </button>
      <span className="col-start-3 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {take && <TakeLink uid={mark.take} short={take === "short"} className="text-foreground" />}
        {take && <span>·</span>}
        <span>
          {who} · {mark.when}
        </span>
        {isNew(data, mark.id) && !isNew(data, mark.take) && <Dot />}
      </span>
      {comments.map((c) => (
        <p key={c.id} className="col-start-3 mt-1">
          <span className="text-xs text-muted-foreground">{memberOf(data, c.by)?.name}: </span>
          {c.text}
        </p>
      ))}
      {!compact &&
        (reply !== null ? (
          <form
            className="col-start-3 mt-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (reply.trim()) addComment(mark.id, reply.trim())
              setReply(null)
            }}
          >
            <Input autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Your comment" className="h-8" />
            <Button size="row" type="submit">
              Send
            </Button>
          </form>
        ) : (
          <span className="col-start-3 flex gap-4 text-xs">
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setReply("")}>
              Comment
            </button>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setMarkClosed(mark.id, !mark.closed)}>
              {mark.closed ? "Open again" : "Close"}
            </button>
          </span>
        ))}
    </div>
  )
}

function MarkDraft({ uid, at, done }: { uid: string; at: number; done: () => void }) {
  const data = useData()
  const [label, setLabel] = useState("0")
  const [note, setNote] = useState("")
  return (
    <Tile className="rounded-xl ring-1 ring-primary/40">
      <span className="text-muted-foreground">
        A mark at <span className="tnum text-foreground">{fmt(at)}</span>
      </span>
      <ToggleGroup type="single" variant="outline" value={label} onValueChange={(v) => v && setLabel(v)} className="flex-wrap">
        {data.labels.map((l, i) => (
          <ToggleGroupItem key={l.name} value={String(i)} className="gap-1.5">
            <Diamond colour={l.colour} />
            {l.name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is it about?" />
      <div className="flex gap-2">
        <Button size="row" onClick={() => (addMark(uid, at, Number(label), note.trim()), done())}>
          Add mark
        </Button>
        <Button size="row" variant="ghost" onClick={done}>
          Cancel
        </Button>
      </div>
    </Tile>
  )
}

export function TakeMarks({ uid, markAt }: { uid: string; markAt?: number }) {
  const data = useData()
  const at = useAt(uid)
  const [draft, setDraft] = useState<number | undefined>(markAt)
  const marks = marksOf(data, uid)
  return (
    <Group title="Marks" hint={marks.length ? String(marks.length) : undefined} action={draft === undefined && <Button variant="outline" size="row" onClick={() => setDraft(at)}>Add a mark at {fmt(at)}</Button>}>
      {draft !== undefined && <MarkDraft uid={uid} at={draft} done={() => setDraft(undefined)} />}
      {marks.length ? (
        <Rows>
          {marks.map((k) => (
            <MarkItem key={k.id} mark={k} />
          ))}
        </Rows>
      ) : (
        draft === undefined && <p className="text-muted-foreground">No marks yet. Play the take and add one where something happens.</p>
      )}
    </Group>
  )
}

export function TakePanel({ uid, markAt }: { uid: string; markAt?: number }) {
  const data = useData()
  const { close } = usePanel()
  const t = takeOf(data, uid)
  const at = useAt(uid)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-semibold">
          <TakeName take={t} />
        </h2>
        <StarButton take={t} who />
        <Button asChild variant="outline" size="row">
          <Link to="/takes/$uid" params={{ uid }} onClick={close}>
            Take's page
            <ChevronRight />
          </Link>
        </Button>
        <Button variant="ghost" size="icon-row" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </div>
      <Groups>
        <Group>
          <Tile>
            <div className="flex items-center gap-3">
              <Play uid={uid} />
              <span className="tnum w-20 shrink-0 text-xs text-muted-foreground">
                {fmt(at)} / {fmt(t.len)}
              </span>
              <Wave uid={uid} height={56} className="flex-1" />
            </div>
          </Tile>
        </Group>
        <Group title="Tracks" hint="4" fold="closed">
          <Lanes uid={uid} />
        </Group>
        <TakeMarks uid={uid} markAt={markAt} />
      </Groups>
    </div>
  )
}
