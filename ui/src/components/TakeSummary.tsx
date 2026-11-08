import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TakeColumns } from "@/components/ui/take-columns"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useFitted } from "@/components/ui/whole"
import { RenameTakeDialog } from "@/components/ConfirmDialog"
import { GoTitle } from "@/components/TakeTitle"
import type { SongChoices } from "@/lib/api"
import type { TakeFacts } from "@/lib/takeFacts"
import { cn } from "@/lib/utils"

/**
 * The take as the header's title: its song and number on up to two lines,
 * then cut with the number kept, whole in the shared tooltip; grey for a
 * take nobody named. The pencil after the last word opens Rename take.
 * `figures` is the columns in words once they have given way to the title:
 * the title's tip says them then.
 */
export function TakeName({
  facts,
  name,
  fallback,
  choices,
  onRename,
  figures,
}: {
  facts: TakeFacts
  name: string
  /** What ✕ in Rename take puts back: the name it would have had. */
  fallback: string
  choices: SongChoices | null
  onRename: (name: string) => void
  figures?: string
}) {
  const [renaming, setRenaming] = useState(false)
  return (
    <span
      data-take-summary
      className={cn("flex min-w-0", facts.unnamed && "text-muted-foreground")}
    >
      <GoTitle
        title={facts.shown}
        go={facts.go}
        cut
        lines={2}
        start
        figures={figures}
        after={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-row"
                aria-label="Rename take"
                onClick={() => setRenaming(true)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span aria-hidden>Rename take</span>
            </TooltipContent>
          </Tooltip>
        }
      />
      <RenameTakeDialog
        draft={renaming ? { name, fallback } : null}
        choices={choices}
        onOpenChange={setRenaming}
        onSubmit={onRename}
      />
    </span>
  )
}

/**
 * The song's takes tonight as columns at the header's right, where the
 * rehearsal screen has its figures, as small as Last time's, each as tall as
 * it ran with its number under it, said in words on hover and to a screen
 * reader. They take only the room the title leaves and give way to it whole:
 * `onGone` hears when they have, so the title's tip, which still has room to
 * hover, says them. `onRoom` hears how wide the room is that they leave empty
 * at the box's left, all of it once they have gone: the subtitle over the
 * title runs on into it rather than be cut at the title's end, and never
 * reaches the columns.
 */
export function TakeFigures({
  facts,
  onGone,
  onRoom,
}: {
  facts: TakeFacts
  /** Told true while the columns have given way; a state setter, or
   *  anything that keeps its identity. */
  onGone?: (gone: boolean) => void
  /** Told the empty room, in px; a state setter, or anything that keeps its
   *  identity. */
  onRoom?: (px: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLSpanElement>(null)
  const [room] = useFitted(
    1,
    facts.columnsText,
    () => {
      const b = box.current
      const r = ruler.current
      if (!b || !r) return null
      const free = b.clientWidth - parseFloat(getComputedStyle(b).paddingLeft)
      const wide = r.getBoundingClientRect().width
      const fits = free >= wide
      onRoom?.(Math.max(0, fits ? free - wide : free))
      return [fits]
    },
    [box, ruler]
  )
  const gone = facts.columns.length > 0 && !room
  // Before the frame is drawn, so the header's line after the columns goes
  // with them, not a frame later (Shell's factsGone).
  useLayoutEffect(() => {
    onGone?.(gone)
  }, [gone, onGone])
  // Gone with them when they go: a song's first take tonight has none.
  useEffect(
    () => () => {
      onGone?.(false)
      onRoom?.(0)
    },
    [onGone, onRoom]
  )
  const said = `Takes of ${facts.song} tonight: ${facts.columnsSaid}`
  return (
    <div
      ref={box}
      data-take-figures
      data-columns-gone={gone || undefined}
      // Contained, so the figures ask for no room of their own: the title
      // takes what it needs first and they have what is left. The empty part
      // of the box is the subtitle's, which runs on into it, so only the
      // columns take the pointer.
      className="pointer-events-none relative flex min-w-0 flex-1 items-center justify-end self-stretch overflow-hidden pl-6 [contain:inline-size]"
    >
      {gone ? (
        <span className="sr-only">{said}</span>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <div role="img" aria-label={said} className="pointer-events-auto">
              <TakeColumns columns={facts.columns} height={24} numbers />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tnum">
            <span aria-hidden>{facts.columnsText}</span>
          </TooltipContent>
        </Tooltip>
      )}
      {/* The columns as drawn, out of sight, to measure. */}
      <div
        aria-hidden
        className="pointer-events-none invisible absolute top-0 right-0 h-0 overflow-hidden"
      >
        <span ref={ruler} className="block w-max">
          <TakeColumns columns={facts.columns} height={24} numbers />
        </span>
      </div>
    </div>
  )
}
