import type { Take } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * A song's title with a go beside it, in the muted colour the song pills
 * have always given the number: "Polyn 3". The go is a number of its own,
 * never typed (songs in the store, D2–D3), so it is drawn apart from the
 * title rather than as part of it.
 *
 * With `cut`, the title alone is cut short when the room runs out and the
 * go stays whole: it is what tells goes at a song apart. The wrapper is a
 * flex box that takes the room it is given, so give it a width to cut at.
 */
export function GoTitle({
  title,
  go,
  cut = false,
}: {
  title: string
  go: number | null | undefined
  cut?: boolean
}) {
  const number =
    go != null ? (
      <span data-go className={cn("tnum text-muted-foreground", cut && "shrink-0 whitespace-pre")}>
        {" "}
        {go}
      </span>
    ) : null
  if (!cut)
    return (
      <>
        {title}
        {number}
      </>
    )
  return (
    <span className="flex max-w-full min-w-0">
      <span data-go-title className="truncate">{title}</span>
      {number}
    </span>
  )
}

/** A take as it is shown: its song and go, or "Take 3" for a take nobody
 *  named. Plain text — a dialog's title, a label — uses take.name. With
 *  `cut`, see GoTitle; a name with no song is cut as a whole. */
export function TakeTitle({
  take,
  cut = false,
}: {
  take: Pick<Take, "name" | "song" | "go">
  cut?: boolean
}) {
  if (take.song) return <GoTitle title={take.song} go={take.go} cut={cut} />
  return cut ? <span className="block truncate">{take.name}</span> : <>{take.name}</>
}
