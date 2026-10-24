import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RowSentence } from "@/lib/backing"
import type { StatusLine as Line } from "@/lib/metronome"
import { cn } from "@/lib/utils"

/**
 * The line under the metronome's row: where its tempo comes from, or what
 * the click is doing in a take (`statusLine` in lib/metronome.ts says which).
 * Its one link follows the words, as a link button in the text's colour. A
 * warning is the warning icon in amber before the words, the words in the
 * text's colour, as the disk line has it.
 *
 * It keeps two lines' room whatever it says, so a song picked with a longer
 * line moves nothing under it (B4).
 *
 * On the rehearsal screen it goes on with the backing track's sentence
 * (`then`, backing-track spec Part 5): when it comes in, or why takes record
 * without it, which is a warning of its own.
 */
export function StatusLine({
  line,
  onLink,
  then,
  className,
}: {
  line: Line
  onLink?: (action: NonNullable<Line["link"]>["action"]) => void
  then?: RowSentence | null
  className?: string
}) {
  return (
    <p
      data-status-line
      className={cn(
        "min-h-[2lh] text-xs",
        line.warn ? "text-foreground" : "text-muted-foreground",
        className
      )}
    >
      {line.warn && (
        <TriangleAlert className="mr-1 inline size-3.5 align-[-0.2em] text-warn" />
      )}
      {line.text}
      {line.link && (
        <>
          {" "}
          <Button
            variant="link"
            onClick={() => onLink?.(line.link!.action)}
            // Words in the line, not a control of its own: no height or
            // padding, and the line's size.
            className="inline h-auto rounded-sm p-0 text-xs whitespace-normal"
          >
            {line.link.label}
          </Button>
        </>
      )}
      {then && (
        <>
          {line.text || line.link ? " " : null}
          {then.amber ? (
            <span className="text-foreground">
              <TriangleAlert className="mr-1 inline size-3.5 align-[-0.2em] text-warn" />
              {then.text}
            </span>
          ) : (
            <span className="text-muted-foreground">{then.text}</span>
          )}
        </>
      )}
    </p>
  )
}
