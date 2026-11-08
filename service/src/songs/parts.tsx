import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { ChevronDown, Download, Ellipsis, ExternalLink, X } from "lucide-react"
import { ConfirmDialog } from "@/components/ConfirmDialog"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { KEYS } from "../../worker/shared/keys"
import { MAX_FILE, TOO_BIG } from "../../worker/songs/limits"
import { useAddFile, useChangeSong, useDeleteFile, useDeleteSong, useSongs, type SongFile, type SongPage } from "../api"
import { OPENS, Rows, TEXTAREA, Tile, useFlash } from "../shell/parts"
import { count, quoted } from "../shell/words"
import { TakeLine } from "../takes/parts"

type Song = SongPage["song"]

/** Why the best take is the best, in words. */
export const why = (s: Song) => (s.best_why === "latest" ? "latest, no stars yet" : s.best_why ?? undefined)

/** The song's status, as a list with **Edit statuses** under it. */
export function StatusMenu({ song }: { song: Song }) {
  const statuses = useSongs().data?.statuses ?? []
  const change = useChangeSong()
  const navigate = useNavigate()
  const name = statuses.find((s) => s.id === song.status_id)?.name ?? ""
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="row" className="gap-1" aria-label={`Status: ${name}`}>
          {name}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup value={String(song.status_id)} onValueChange={(v) => change.mutate({ id: song.id, status_id: Number(v) })}>
          {statuses.map((s) => (
            <DropdownMenuRadioItem key={s.id} value={String(s.id)}>
              {s.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate({ to: "/songs", search: { edit: "statuses" } })}>Edit statuses</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The song's key, one of the 24. */
export function KeySelect({ song }: { song: Song }) {
  const change = useChangeSong()
  return (
    <Select value={song.key ?? "none"} onValueChange={(v) => change.mutate({ id: song.id, key: v === "none" ? null : v })}>
      <SelectTrigger size="sm" className="w-36" aria-label="Key">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No key</SelectItem>
        {KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {k}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The song's best take as a row; `big` lists its marks under it. */
export function BestTake({ song, big }: { song: Song; big?: boolean }) {
  if (!song.best) return <p className="text-muted-foreground">No takes yet. They come from РЭХА under the title “{song.title}”.</p>
  return <TakeLine take={song.best} marks={big} />
}

/**
 * The song's notes: words, the form, who starts. Anyone in the band edits
 * them, and they save themselves, as the band's name does (Alex, 2026-11-02):
 * a second after the last key, on leaving the box, and when it closes.
 */
export function Notes({ song }: { song: Song }) {
  return <NotesBox key={song.id} song={song} />
}

/** How long after the last key the notes save. */
const PAUSE_MS = 1000

function NotesBox({ song }: { song: Song }) {
  const change = useChangeSong()
  const [text, setText] = useState(song.notes)
  const [saved, flash] = useFlash()
  /** What the band has, as far as this box knows. */
  const sent = useRef(song.notes)
  const writing = useRef(false)
  // The latest, for the timer and the close to call.
  const save = useRef<(now: string) => void>(() => {})
  save.current = (now: string) => {
    if (now === sent.current) return
    sent.current = now
    change.mutate({ id: song.id, notes: now }, { onSuccess: flash })
  }
  // Someone else's notes come in while you are not writing.
  useEffect(() => {
    if (writing.current || song.notes === sent.current) return
    sent.current = song.notes
    setText(song.notes)
  }, [song.notes])
  useEffect(() => {
    const t = setTimeout(() => save.current(text), PAUSE_MS)
    return () => clearTimeout(t)
  }, [text])
  const latest = useRef(text)
  latest.current = text
  // Another page or another song opened: what is written goes too.
  useEffect(() => () => save.current(latest.current), [])
  return (
    <Tile>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => (writing.current = true)}
        onBlur={() => {
          writing.current = false
          save.current(text)
        }}
        rows={Math.min(14, Math.max(3, text.split("\n").length + 1))}
        maxLength={10000}
        aria-label="Notes"
        placeholder="Words, the form, who starts"
        className={TEXTAREA}
      />
      {change.error ? (
        <p role="alert" className="text-destructive">
          Not saved: {change.error.message}
        </p>
      ) : (
        <span role="status" className="min-h-4 text-xs text-muted-foreground">
          {change.isPending ? "Saving…" : saved ? "Saved" : ""}
        </span>
      )}
    </Tile>
  )
}

/** The badge, and whether a press opens the file in a tab (↗) or downloads it (↓). */
const KIND: Record<SongFile["kind"], [string, boolean]> = {
  gp: ["GP", false],
  pdf: ["PDF", true],
  picture: ["IMG", true],
  other: ["FILE", false],
}

/** The song's files: a Guitar Pro file downloads, a PDF or a picture opens in a new tab. */
export function Files({ song, files }: { song: Song; files: SongFile[] }) {
  const remove = useDeleteFile()
  const [removing, setRemoving] = useState<SongFile | null>(null)
  if (!files.length) return <p className="text-muted-foreground">No files yet: the song's chart, words, a Guitar Pro file.</p>
  return (
    <>
    <Rows>
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-[10px] font-semibold text-muted-foreground ring-1 ring-border">
            {KIND[f.kind][0]}
          </span>
          <a
            href={f.url}
            {...(f.kind === "pdf" || f.kind === "picture" ? { target: "_blank", rel: "noreferrer" } : { download: f.name })}
            className="min-w-0 flex-1"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn("truncate", OPENS)}>{f.name}</span>
              {KIND[f.kind][1] ? (
                <ExternalLink role="img" aria-label="opens in a new tab" className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Download role="img" aria-label="downloads" className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </span>
            {f.added_by && <span className="block truncate text-xs text-muted-foreground">added by {f.added_by}</span>}
          </a>
          <Button variant="ghost" size="icon-row" aria-label={`Remove ${f.name}`} disabled={remove.isPending} onClick={() => setRemoving(f)}>
            <X className="text-muted-foreground" />
          </Button>
        </div>
      ))}
    </Rows>
    {remove.error && (
      <p role="alert" className="text-destructive">
        {remove.error.message}
      </p>
    )}
    <ConfirmDialog
      open={removing !== null}
      onOpenChange={(open) => !open && setRemoving(null)}
      title={removing && `Remove “${removing.name}”?`}
      description={removing && "It goes for the whole band, for good."}
      actionLabel="Remove file"
      onConfirm={() => removing && remove.mutate({ song: song.id, file: removing.id })}
    />
    </>
  )
}

/** **Add a file**: up to 50 MB. */
export function AddFile({ song }: { song: Song }) {
  const pick = useRef<HTMLInputElement>(null)
  const add = useAddFile()
  const [tooBig, setTooBig] = useState(false)
  const error = tooBig ? TOO_BIG : add.error?.message
  return (
    <span className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <input
        ref={pick}
        type="file"
        hidden
        aria-label="A file for the song"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          // Said here, before minutes of sending what the service would refuse.
          setTooBig(file.size > MAX_FILE)
          if (file.size <= MAX_FILE) add.mutate({ song: song.id, file })
        }}
      />
      <Button variant="outline" size="row" disabled={add.isPending} onClick={() => pick.current?.click()}>
        {add.isPending ? "Adding…" : "Add a file"}
      </Button>
    </span>
  )
}

/**
 * ⋯ › **Delete song**. The song goes to the Trash, with its takes when it
 * has any, so the button is the accent. One that never had a take goes there
 * too, so РЭХА learns of it at its check and removes it as well.
 */
export function SongMenu({ song, onGone }: { song: Song; onGone: () => void }) {
  const remove = useDeleteSong()
  const [asking, setAsking] = useState(false)
  // Any take at all, in the Trash or still on its way from РЭХА: the takes stay in РЭХА.
  const taken = song.takes > 0 || song.trashed_takes > 0 || song.coming_takes > 0
  const said =
    song.takes > 0
      ? `It goes to the Trash with its ${count(song.takes, "take")}, notes and files, where anyone in the band can put it back for 30 days. In РЭХА the takes stay as they are.`
      : taken
        ? "It goes to the Trash with its notes and files, where anyone in the band can put it back for 30 days."
        : "It goes to the Trash with its notes and files, where anyone in the band can put it back for 30 days. РЭХА removes it too, unless that computer has takes of it."
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-row" aria-label={`What to do with ${song.title}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setAsking(true)}>Delete song</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {remove.error && (
        <span role="alert" className="text-xs text-destructive">
          {remove.error.message}
        </span>
      )}
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={asking ? `Delete ${quoted(song.title)}?` : null}
        description={asking ? said : null}
        actionLabel="Delete song"
        destructive={false}
        // Away from the song first, so its page does not ask for it once it is gone.
        onConfirm={() => {
          onGone()
          remove.mutate(song.id)
        }}
      />
    </>
  )
}
