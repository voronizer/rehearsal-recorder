import type { MarkerKind } from "@/lib/api"

/**
 * What the four kinds of marker mean and look like.
 *
 * The colour is the point: after an hour of playing nobody reads notes, they
 * glance at the waveform and see where the red is.
 */
export const MARKER_KINDS: {
  kind: MarkerKind
  label: string
  /** Custom property the waveform reads to colour its tick. */
  cssVar: string
  /** Tailwind classes for chips and buttons. */
  chip: string
  dot: string
}[] = [
  {
    kind: "note",
    label: "Note",
    cssVar: "--wf-marker",
    chip: "border-border",
    dot: "bg-muted-foreground",
  },
  {
    kind: "good",
    label: "Keep this",
    cssVar: "--signal",
    chip: "border-signal/50 bg-signal/10",
    dot: "bg-signal",
  },
  {
    kind: "issue",
    label: "Went wrong",
    cssVar: "--destructive",
    chip: "border-destructive/50 bg-destructive/10",
    dot: "bg-destructive",
  },
  {
    kind: "redo",
    label: "Do again",
    cssVar: "--warn",
    chip: "border-warn/50 bg-warn/10",
    dot: "bg-warn",
  },
]

export function markerStyle(kind: MarkerKind) {
  return MARKER_KINDS.find((k) => k.kind === kind) ?? MARKER_KINDS[0]
}
