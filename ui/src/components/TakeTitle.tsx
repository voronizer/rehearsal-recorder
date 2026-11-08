import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { flushSync } from "react-dom"
import { WholeTip } from "@/components/ui/whole"
import type { Take } from "@/lib/api"
import { GO_SPACE, goMark } from "@/lib/takeText"
import { cn } from "@/lib/utils"

/**
 * A title on up to two lines, centred, the go right after its last word. One
 * longer than two lines is cut at a word, with the go kept after the "…", and
 * is whole in the shared tooltip on hover and whole to a screen reader. It is
 * fitted on an unseen copy from the room it has, so it is fitted again only
 * when that room changes size (the window, the scale, the size it is drawn
 * at), never while a take records.
 *
 * Every line is 1.1 tall, so a second line's capitals clear the first's
 * tails. One line has that leading too: then how tall the title is depends
 * only on the lines drawn, never on what it was last fitted to, and the
 * screen round it, which is fitted to it in turn, comes to rest (Recording).
 *
 * `start` sets it at the start of its lines, as Review's header has it.
 * `after` is a button that follows the last word, such as Review's pencil: the
 * title keeps room for it on its last line, held to the last word so it never
 * starts a line alone, and it is fitted with that room counted, so on two
 * lines it sits after the last word and not at the box's edge. The button is
 * laid over that room rather than inside the title, so the title's tip is not
 * the button's and a cut title, hidden from a screen reader for the whole one
 * beside it, does not hide the button too.
 */
function TwoLines({
  title,
  go,
  start = false,
  after,
  figures,
}: {
  title: string
  go: number | null | undefined
  start?: boolean
  after?: ReactNode
  figures?: ReactNode
}) {
  const probe = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLSpanElement>(null)
  const room = useRef<HTMLSpanElement>(null)
  // After a no-break space, so the go never starts a line of its own.
  const suffix = go != null ? `${GO_SPACE}${goMark(go)}` : ""
  const [fit, setFit] = useState({ text: title, cut: false, lines: 1, room: 0 })
  const measure = useCallback(() => {
    const el = probe.current
    if (!el) return
    const line = parseFloat(getComputedStyle(el).fontSize) * 1.1
    // The button's room, as wide as it is drawn.
    const wide = button.current?.offsetWidth ?? 0
    // The same markup as the title drawn, the go in its own figures: a
    // tabular 2 is wider than a plain one, and a line that only just fits in
    // plain text does not with it.
    const lines = (t: string) => {
      el.textContent = t
      // With a button, the last character goes on with the go and the
      // button's room, which never start a line alone.
      let tail: HTMLElement = el
      if (wide) {
        const chars = Array.from(t)
        tail = document.createElement("span")
        tail.className = "whitespace-nowrap"
        tail.textContent = chars.pop() ?? ""
        el.textContent = chars.join("")
        el.appendChild(tail)
      }
      if (suffix) {
        const number = document.createElement("span")
        number.className = "tnum"
        number.textContent = suffix
        tail.appendChild(number)
      }
      if (wide) {
        const kept = document.createElement("span")
        kept.className = "ml-1.5 inline-block"
        kept.style.width = `${wide}px`
        tail.appendChild(kept)
      }
      return Math.round(el.getBoundingClientRect().height / line)
    }
    let next = { text: title, cut: false, lines: lines(title), room: wide }
    if (next.lines > 2) {
      let lo = 0
      let hi = title.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (lines(`${title.slice(0, mid).trimEnd()}…`) <= 2) lo = mid
        else hi = mid - 1
      }
      // At the end of a word, where one ends a little before the room does,
      // as a person would cut it.
      const space = title.lastIndexOf(" ", lo)
      const at = space > 0 && lo - space <= 12 ? space : lo
      next = { text: `${title.slice(0, at).trimEnd()}…`, cut: true, lines: 2, room: wide }
    }
    // The copy holds no words between fits: the heading's are the title's.
    el.textContent = ""
    setFit((was) =>
      was.text === next.text &&
      was.cut === next.cut &&
      was.lines === next.lines &&
      was.room === next.room
        ? was
        : next
    )
  }, [title, suffix])
  // The button over the room kept for it, wherever the last line put it.
  const place = useCallback(() => {
    const b = button.current
    const r = room.current
    if (!b || !r) return
    b.style.left = `${r.offsetLeft}px`
    b.style.top = `${r.offsetTop}px`
    b.style.height = `${r.offsetHeight}px`
  }, [])
  useLayoutEffect(() => place())
  useLayoutEffect(() => {
    measure()
    const el = box.current
    if (!el) return
    // The measure above comes before the screen's own fit (Recording's),
    // which can draw the title smaller. The observer measures it again at
    // that size before the frame is drawn, and flushSync puts the words it
    // finds in that frame, not the next. A new width can move the last word
    // without changing the words, so the button is placed again either way.
    const watch = new ResizeObserver(() => {
      flushSync(measure)
      place()
    })
    watch.observe(el)
    if (button.current) watch.observe(button.current)
    return () => watch.disconnect()
  }, [measure, place])
  const chars = Array.from(fit.text)
  const last = after ? (chars.pop() ?? "") : ""
  const number = suffix && <span data-go className="tnum text-muted-foreground">{suffix}</span>
  return (
    <span
      ref={box}
      className={cn("relative flex w-full min-w-0", start ? "justify-start" : "justify-center")}
    >
      <span
        ref={probe}
        aria-hidden
        className={cn(
          "invisible absolute inset-x-0 top-0 leading-[1.1] break-words",
          start ? "text-left" : "text-center"
        )}
      />
      {fit.cut && (
        <span className="sr-only">
          {title}
          {suffix}
        </span>
      )}
      <WholeTip cut={fit.cut} text={title} figures={figures}>
        <span
          data-go-title
          data-lines={fit.lines}
          data-cut={fit.cut || undefined}
          aria-hidden={fit.cut || undefined}
          className={cn(
            "line-clamp-2 min-w-0 leading-[1.1] break-words",
            start ? "text-left" : "text-center"
          )}
        >
          {after ? (
            <>
              {chars.join("")}
              <span className="whitespace-nowrap">
                {last}
                {number}
                <span
                  ref={room}
                  className="ml-1.5 inline-block h-lh align-top"
                  style={{ width: fit.room }}
                />
              </span>
            </>
          ) : (
            <>
              {fit.text}
              {number}
            </>
          )}
        </span>
      </WholeTip>
      {after && (
        <span ref={button} className="absolute flex items-center">
          {after}
        </span>
      )}
    </span>
  )
}

/**
 * A song's title with a go beside it, in the muted colour the song pills
 * have always given the number, after a #: "Polyn #3", so that a title that
 * ends in a number reads apart from it. The go is a number of its own, never
 * typed (songs in the store, D2–D3), so it is drawn apart from the title
 * rather than as part of it.
 *
 * With `cut`, the title alone is cut short when the room runs out and the
 * go stays whole: it is what tells goes at a song apart. The wrapper is a
 * flex box that takes the room it is given, so give it a width to cut at.
 * With `lines={2}` as well, the title wraps to a second line before it is
 * cut (TwoLines), and can take `start`, `after` and `figures`.
 */
export function GoTitle({
  title,
  go,
  cut = false,
  lines = 1,
  start = false,
  after,
  figures,
}: {
  title: string
  go: number | null | undefined
  cut?: boolean
  /** With `cut`, how many lines the title may take before it is cut. */
  lines?: 1 | 2
  /** With two lines, at the start of the line rather than centred. */
  start?: boolean
  /** With two lines, a button right after the last word (TwoLines). */
  after?: ReactNode
  /** With two lines, figures beside the title that have given way to it:
   *  its tip says them under it (WholeTip). */
  figures?: ReactNode
}) {
  const number =
    go != null ? (
      <span data-go className={cn("tnum text-muted-foreground", cut && "shrink-0 whitespace-pre")}>
        {GO_SPACE}
        {goMark(go)}
      </span>
    ) : null
  if (!cut)
    return (
      <>
        {title}
        {number}
      </>
    )
  if (lines === 2)
    return <TwoLines title={title} go={go} start={start} after={after} figures={figures} />
  return (
    <span className="flex max-w-full min-w-0">
      <span data-go-title className="truncate">{title}</span>
      {number}
    </span>
  )
}

/** A take as it is shown: its song and go, or "Take 3" for a take nobody
 *  named. Plain text, such as a dialog's title or a notice, says the same
 *  through takeText; an aria-label keeps take.name. With `cut`, see GoTitle;
 *  a name with no song is cut as a whole. */
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
