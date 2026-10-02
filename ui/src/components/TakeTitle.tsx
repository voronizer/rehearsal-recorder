import type { Take } from "@/lib/api"

/**
 * A song's title with a go beside it, in the muted colour the song pills
 * have always given the number: "Polyn 3". The go is a number of its own,
 * never typed (songs in the store, D2–D3), so it is drawn apart from the
 * title rather than as part of it.
 */
export function GoTitle({ title, go }: { title: string; go: number | null | undefined }) {
  return (
    <>
      {title}
      {go != null && (
        <span className="tnum text-muted-foreground">
          {" "}
          {go}
        </span>
      )}
    </>
  )
}

/** A take as it is shown: its song and go, or "Take 3" for a take nobody
 *  named. Plain text — a dialog's title, a label — uses take.name. */
export function TakeTitle({ take }: { take: Pick<Take, "name" | "song" | "go"> }) {
  return take.song ? <GoTitle title={take.song} go={take.go} /> : <>{take.name}</>
}
