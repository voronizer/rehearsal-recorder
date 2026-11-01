import { useRef, useState } from "react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KEYS } from "../../worker/shared/keys"
import { useAddFile, useChangeSong, useDeleteFile, useSong, useSongs, type SongFile, type SongPage } from "../api"
import { Group, Groups, Note, Props, Rows, Tile } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { clock } from "../shell/words"
import { TakeLine, TakeName } from "../takes/parts"

type Song = SongPage["song"]

/** Why the best take is the best, in words. */
export const why = (s: Song) => (s.best_why === "latest" ? "latest, no stars yet" : s.best_why ?? undefined)

/** The song's status, as a list with **Edit statuses** under it. */
export function StatusMenu({ song }: { song: Song }) {
  const statuses = useSongs().data?.statuses ?? []
  const change = useChangeSong()
  const { open } = usePanel()
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
        <DropdownMenuItem onSelect={() => open({ kind: "statuses" })}>Edit statuses</DropdownMenuItem>
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

/** The song's best take as a row; `big` lists its marks under it. */
export function BestTake({ song, big }: { song: Song; big?: boolean }) {
  if (!song.best) return <p className="text-muted-foreground">No takes yet. They come from РЭХА under the title “{song.title}”.</p>
  return <TakeLine take={song.best} marks={big} />
}

/** The song's notes: words, the form, who starts. Anyone in the band edits them. */
export function Notes({ song }: { song: Song }) {
  const change = useChangeSong()
  const [edit, setEdit] = useState<string | null>(null)
  if (edit !== null)
    return (
      <Tile>
        <textarea
          autoFocus
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          rows={6}
          maxLength={10000}
          aria-label="Notes"
          placeholder="Words, the form, who starts"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {change.error && (
          <p role="alert" className="text-destructive">
            {change.error.message}
          </p>
        )}
        <div className="flex gap-2">
          <Button size="row" disabled={change.isPending} onClick={() => change.mutate({ id: song.id, notes: edit }, { onSuccess: () => setEdit(null) })}>
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

const KIND: Record<SongFile["kind"], [string, string]> = {
  gp: ["GP", "Guitar Pro · downloads to open in Guitar Pro"],
  pdf: ["PDF", "PDF · opens in a new tab"],
  picture: ["IMG", "Picture · opens in a new tab"],
  other: ["FILE", "Downloads"],
}

/** The song's files: a Guitar Pro file downloads, a PDF or a picture opens in a new tab. */
export function Files({ song, files }: { song: Song; files: SongFile[] }) {
  const remove = useDeleteFile()
  if (!files.length) return <p className="text-muted-foreground">No files yet: the song's chart, words, a Guitar Pro file.</p>
  return (
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
            <span className="block truncate hover:underline">{f.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {KIND[f.kind][1]}
              {f.added_by && ` · added by ${f.added_by}`}
            </span>
          </a>
          <Button variant="ghost" size="icon-row" aria-label={`Remove ${f.name}`} disabled={remove.isPending} onClick={() => remove.mutate({ song: song.id, file: f.id })}>
            <X className="text-muted-foreground" />
          </Button>
        </div>
      ))}
    </Rows>
  )
}

/** **Add a file**: up to 50 MB. */
export function AddFile({ song }: { song: Song }) {
  const pick = useRef<HTMLInputElement>(null)
  const add = useAddFile()
  return (
    <span className="flex items-center gap-2">
      {add.error && (
        <span role="alert" className="text-xs text-destructive">
          {add.error.message}
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
          if (file) add.mutate({ song: song.id, file })
        }}
      />
      <Button variant="outline" size="row" disabled={add.isPending} onClick={() => pick.current?.click()}>
        {add.isPending ? "Adding…" : "Add a file"}
      </Button>
    </span>
  )
}

/** The song's panel: status, key, tempo and length, its best take, notes, files. */
export function SongPanel({ id }: { id: number }) {
  const { close } = usePanel()
  const page = useSong(id)
  if (page.error) return <Note>{page.error.message}</Note>
  if (!page.data) return null
  const { song, files } = page.data
  return (
    <div className="flex flex-col gap-6" aria-label={song.title}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 truncate text-lg font-semibold">{song.title}</h2>
        <Button asChild variant="outline" size="row">
          <Link to="/songs/$id" params={{ id: String(id) }} onClick={close}>
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
              ["Status", <StatusMenu song={song} />],
              ["Key", <KeySelect song={song} />],
              [
                "Tempo",
                song.tempo ? (
                  <span>
                    {Math.round(song.tempo)} bpm <span className="text-xs text-muted-foreground">from РЭХА</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not set in РЭХА yet</span>
                ),
              ],
              [
                "Length",
                song.best ? (
                  <span className="flex items-center gap-1.5">
                    <span className="tnum">{clock(song.best.duration_sec)}</span>
                    <span className="text-xs text-muted-foreground">of</span>
                    <TakeName take={song.best} className="text-xs text-muted-foreground" />
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
              ],
            ]}
          />
        </Group>
        <Group title="Best take" hint={why(song)}>
          <BestTake song={song} />
        </Group>
        <Group title="Notes">
          <Notes song={song} />
        </Group>
        <Group title="Files" action={<AddFile song={song} />}>
          <Files song={song} files={files} />
        </Group>
      </Groups>
    </div>
  )
}
