import type { SVGProps } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Signature } from "@/lib/api"
import { formatMeter, tempoUnit } from "@/lib/format"
import { unitTitle } from "@/lib/metronome"
import { cn } from "@/lib/utils"

/**
 * The eighth note, drawn: the fonts' ♪ is small and sits unevenly beside
 * figures. It stands after a tempo in 6/8, which counts eighths, wherever
 * the interface draws one; plain text says "♪" (`tempoUnit`). It is as tall
 * as the figures round it and takes their colour.
 */
export function NoteGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 14 18"
      fill="currentColor"
      aria-hidden
      className={cn("inline-block h-[1.05em] w-auto align-[-0.18em]", className)}
      {...props}
    >
      <ellipse cx="4.6" cy="14.2" rx="3.7" ry="2.6" transform="rotate(-22 4.6 14.2)" />
      <rect x="7.4" y="1.5" width="1.3" height="12.8" />
      <path d="M8.7 1.5c.4 2.2 1.6 3.4 3 4.6 1.1 1 1.6 2.4 1 4.4-.2-1.6-1.2-2.7-4-3.4z" />
    </svg>
  )
}

/**
 * What a tempo counts, after its number: "bpm", or the drawn eighth in 6/8,
 * with a tip that says it in words. It keeps the room "bpm" takes whichever
 * it shows, so a song in 6/8 moves nothing beside it.
 */
export function TempoUnit({ signature, className }: { signature: Signature; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span data-tempo-unit className={cn("inline-grid text-muted-foreground", className)}>
          <span
            aria-hidden
            data-text={tempoUnit("4/4")}
            className="invisible col-start-1 row-start-1 before:content-[attr(data-text)]"
          />
          <span className="col-start-1 row-start-1">
            {signature === "6/8" ? (
              <NoteGlyph role="img" aria-hidden={false} aria-label={unitTitle(signature)} />
            ) : (
              tempoUnit(signature)
            )}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{unitTitle(signature)}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A tempo and its signature in a line of words, "128 bpm · 4/4", with the
 * drawn eighth in 6/8 where plain text says "♪" (formatMeter), named for a
 * screen reader as the unit's tip says it.
 */
export function MeterText({ tempo, signature }: { tempo: number; signature: Signature }) {
  if (signature !== "6/8") return <span className="tnum">{formatMeter(tempo, signature)}</span>
  return (
    <span className="tnum">
      {tempo} <NoteGlyph role="img" aria-hidden={false} aria-label={unitTitle(signature)} /> · {signature}
    </span>
  )
}
