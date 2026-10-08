import { useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import { contentClass, overlayClass } from "@/components/ConfirmDialog"
import { TakeNameField } from "@/components/TakeNameField"
import type { SongChoices, SongSummary } from "@/lib/api"
import { goesLabel } from "@/lib/format"
import { songNamed } from "@/lib/goes"

// What a take with no song is called: never a song's title, or the song
// could not be named again (Library.rename_song refuses it too).
const UNNAMED = /^take \d+$/i

/**
 * Rename song, from the pencil beside a song's title (rename-and-merge-songs
 * spec, R1-R7). The take name field without the goes: a rename gives none.
 * Under it the other songs as pills, the latest played first; one picked,
 * or its title or old name typed, turns Rename into Merge…, which goes to
 * `onMerge` for the question. A title no song has goes to `onRename`.
 *
 * A title is taken as typed: a number at its end is part of it. The line
 * under the field says what pressing the button will do, in a box of its
 * own height, so the buttons do not move as it changes.
 */
export function RenameSongDialog({
  song,
  songs,
  onOpenChange,
  onRename,
  onMerge,
}: {
  song: SongSummary | null
  /** Every song in the Songs view, this one among them. */
  songs: SongSummary[]
  onOpenChange: (open: boolean) => void
  onRename: (title: string) => void
  onMerge: (into: { id: number; title: string }) => void
}) {
  return (
    <DialogPrimitive.Root open={song !== null} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content className={contentClass}>
          <DialogPrimitive.Title className="text-base font-semibold">
            Rename song
          </DialogPrimitive.Title>
          {/* Keyed by the song, so another song opened starts from its title. */}
          {song && (
            <RenameSongForm
              key={song.id}
              song={song}
              songs={songs}
              onRename={(title) => {
                onOpenChange(false)
                onRename(title)
              }}
              onMerge={(into) => {
                onOpenChange(false)
                onMerge(into)
              }}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function RenameSongForm({
  song,
  songs,
  onRename,
  onMerge,
}: {
  song: SongSummary
  songs: SongSummary[]
  onRename: (title: string) => void
  onMerge: (into: { id: number; title: string }) => void
}) {
  const [title, setTitle] = useState(song.title)
  // What is being typed, so the line and the button follow every key.
  const [draft, setDraft] = useState<string | null>(null)
  const others = songs
    .filter((s) => s.id !== song.id)
    .sort((a, b) => b.last_played.localeCompare(a.last_played))
  const choices: SongChoices = {
    here: [],
    other: others.map((s) => ({ song: s.title, go: s.goes + 1, also: s.also })),
  }

  // What the button would do with `text` in the field.
  const outcome = (text: string) => {
    const typed = text.trim()
    const named = songNamed(typed, choices)
    const into = named ? others.find((s) => s.title === named.choice.song) : undefined
    if (into) return { kind: "merge" as const, into }
    if (typed === "" || typed === song.title) return { kind: "none" as const }
    if (UNNAMED.test(typed)) return { kind: "refused" as const, typed }
    return { kind: "rename" as const, typed }
  }
  const now = outcome(draft ?? title)

  const submit = (text: string) => {
    const what = outcome(text)
    if (what.kind === "merge") onMerge({ id: what.into.id, title: what.into.title })
    else if (what.kind === "rename") onRename(what.typed)
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <span className="text-xs text-muted-foreground">
        Every go is renamed, with its folder on disk and its copies in the cloud folder.
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <TakeNameField
          id="rename-song"
          label="Song title"
          size="compact"
          autoFocus
          value={title}
          fallback={song.title}
          choices={choices}
          goes={false}
          offerNewSong={false}
          onCommit={setTitle}
          onDraft={setDraft}
          onEnter={submit}
        />
        <p data-rename-says className="min-h-5 text-xs break-words text-muted-foreground">
          {now.kind === "merge"
            ? `${now.into.title} is another song: ${song.title}'s goes join it.`
            : now.kind === "refused"
              ? `${now.typed} is what a take with no song is called.`
              : now.kind === "rename"
                ? now.typed.toLocaleLowerCase() === song.title.toLocaleLowerCase()
                  ? "Spelled anew: the same song."
                  : `${goesLabel(song.goes)} ${song.goes === 1 ? "becomes" : "become"} ${now.typed}.`
                : ""}
        </p>
      </div>
      {/* As PromptDialog draws them. */}
      <div className="mt-2 flex justify-end gap-3">
        <DialogPrimitive.Close asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogPrimitive.Close>
        <Button
          onClick={() => submit(draft ?? title)}
          disabled={now.kind === "none" || now.kind === "refused"}
        >
          {now.kind === "merge" ? "Merge…" : "Rename"}
        </Button>
      </div>
    </div>
  )
}
