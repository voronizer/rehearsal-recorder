/*
  A mark's label colour, as РЭХА sends it, drawn in the interface's label
  colours. Written out colour by colour, since Tailwind finds class names by
  reading the source. The stored "blue" is drawn orange, as in РЭХА
  (ui/src/lib/labels.ts). A comment written here has no colour.
*/
const LOOK: Record<string, { dot: string; line: string }> = {
  grey: { dot: "bg-label-grey", line: "stroke-label-grey" },
  red: { dot: "bg-label-red", line: "stroke-label-red" },
  amber: { dot: "bg-label-amber", line: "stroke-label-amber" },
  green: { dot: "bg-label-green", line: "stroke-label-green" },
  teal: { dot: "bg-label-teal", line: "stroke-label-teal" },
  blue: { dot: "bg-label-orange", line: "stroke-label-orange" },
  violet: { dot: "bg-label-violet", line: "stroke-label-violet" },
  pink: { dot: "bg-label-pink", line: "stroke-label-pink" },
}

const COMMENT = { dot: "bg-muted-foreground/60", line: "stroke-muted-foreground" }

export const colourOf = (colour: string | null) => (colour && LOOK[colour]) || COMMENT
