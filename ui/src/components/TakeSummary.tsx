import { useEffect, useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RenameTakeDialog } from "@/components/ConfirmDialog"
import { GoTitle } from "@/components/TakeTitle"
import { api, type SongChoices, type Take } from "@/lib/api"
import { against, formatDate, formatMMSS } from "@/lib/format"
import { UNNAMED, goFor, songFor } from "@/lib/goes"
import { cn } from "@/lib/utils"

type Go = { take_number: number; go: number | null; duration_sec: number; starred: boolean }
/** The go before tonight, asked for `song`: null when there was none. */
type Before = { song: string; go: { sec: number; day: string } | null }

/** The bars' room: the longest go is this tall. */
const BAR_PX = 36
/** The most bars shown: the last goes, this one last, so a song played all
 *  evening still leaves its title the room. */
const MOST_BARS = 10

/**
 * The take on the screen after it, where its name field was (issue #12
 * step 8, A1–A4): its song big, with the go it will be and a pencil that
 * opens Rename take; under it how long it ran against the song's go before;
 * left of it the song's goes tonight as bars, each as tall as it ran, this
 * one in the text colour and ★ goes green, the last ten at most. A take
 * nobody named is "Take 7", grey, with its length alone. A first go at a song has no bars.
 */
export function TakeSummary({
  name,
  takeNumber,
  durationSec,
  takes,
  choices,
  fallback,
  onRename,
}: {
  name: string
  takeNumber: number
  durationSec: number
  /** Tonight's takes kept so far. */
  takes: Take[]
  choices: SongChoices | null
  /** What ✕ in Rename take puts back: the name it would have had. */
  fallback: string
  onRename: (name: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  // A title no song has yet is a new song, at its first go; "Take 7" is a
  // take nobody named.
  const typed = name.trim()
  const unnamed = typed === "" || UNNAMED.test(typed)
  const song = unnamed ? null : (songFor(typed, choices)?.choice.song ?? typed)
  // Until the songs are in, the go is not guessed.
  const go = song ? goFor(typed, choices) : null

  const tonight: Go[] = song
    ? takes
        .filter((t) => t.song === song && t.take_number !== takeNumber)
        .map((t) => ({
          take_number: t.take_number,
          go: t.go ?? null,
          duration_sec: t.duration_sec,
          starred: Boolean(t.starred),
        }))
    : []
  const last = tonight.at(-1) ?? null

  // With no go tonight, the go before tonight, with its day, as the
  // recording screen measures against. Until it is in, the length is said
  // alone, so nothing said is taken back.
  const [before, setBefore] = useState<Before | null>(null)
  const askBefore = song !== null && last === null
  useEffect(() => {
    if (!askBefore || song === null) return
    let current = true
    api()
      .last_attempt(song)
      .then((a) => {
        if (current)
          setBefore({
            song,
            go: a?.created_at ? { sec: a.duration_sec, day: formatDate(a.created_at) } : null,
          })
      })
      .catch(() => {
        if (current) setBefore({ song, go: null })
      })
    return () => {
      current = false
    }
  }, [askBefore, song])
  const told = before && before.song === song ? before : null

  const compare = last
    ? against(durationSec, last.duration_sec, `go ${last.go ?? last.take_number}`)
    : told?.go
      ? against(durationSec, told.go.sec, `on ${told.go.day}`)
      : told
        ? "the first go at it tonight"
        : null

  const goes: (Go & { here?: boolean })[] = [
    ...tonight,
    { take_number: takeNumber, go, duration_sec: durationSec, starred: false, here: true },
  ].slice(-MOST_BARS)
  const longest = Math.max(...goes.map((g) => g.duration_sec), 1)
  const shown = song ?? name

  return (
    <div data-take-summary className="flex min-w-0 items-center gap-4">
      {song && tonight.length > 0 && (
        <div
          role="img"
          aria-label={`Goes at ${song} tonight`}
          title={goes.map((g) => `Go ${g.go ?? "?"}: ${formatMMSS(g.duration_sec)}`).join(", ")}
          className="flex shrink-0 items-end gap-1"
        >
          {goes.map((g) => (
            <span
              key={g.take_number}
              data-go-bar={g.go ?? undefined}
              data-here={g.here ? "" : undefined}
              data-starred={g.starred ? "" : undefined}
              className="flex w-3.5 flex-col items-center gap-1"
            >
              <span className="flex items-end" style={{ height: BAR_PX }}>
                <span
                  data-bar
                  className={cn(
                    "w-2 rounded-[2px]",
                    g.here
                      ? "bg-foreground"
                      : g.starred
                        ? "bg-signal/80"
                        : "bg-muted-foreground/40"
                  )}
                  style={{ height: Math.max(5, (g.duration_sec / longest) * BAR_PX) }}
                />
              </span>
              <span
                className={cn(
                  "text-[10px] leading-none tabular-nums",
                  g.here ? "font-semibold text-foreground" : "text-muted-foreground"
                )}
              >
                {g.go}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2
            title={shown}
            className={cn(
              "flex min-w-0 text-xl leading-7 font-semibold tracking-tight",
              !song && "text-muted-foreground"
            )}
          >
            <GoTitle title={shown} go={go} cut />
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Rename take"
            title="Rename"
            onClick={() => setRenaming(true)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Pencil />
          </Button>
        </div>
        <p data-take-line className="truncate text-sm text-muted-foreground tabular-nums">
          {formatMMSS(durationSec)}
          {compare && ` · ${compare}`}
        </p>
      </div>

      <RenameTakeDialog
        draft={renaming ? { name, fallback } : null}
        choices={choices}
        onOpenChange={setRenaming}
        onSubmit={onRename}
      />
    </div>
  )
}
