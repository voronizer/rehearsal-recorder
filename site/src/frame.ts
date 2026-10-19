// What the page and a frame of stage.html say to each other.

/** From the page: a step of the story to run through, a moment of a step
 *  (its line `beat`) to go to and stay at, or to hold still. */
export type ToStage =
  | { type: "rr-step"; step: number }
  | { type: "rr-moment"; step: number; beat: number }
  | { type: "rr-hold"; hold: boolean }

/**
 * From the frame: it is up, and listening; it has got to a step's line; it
 * was asked for a place behind it and needs a fresh frame started there
 * (stage.html#<hash>); or, started fresh, it has got to that place.
 */
export type FromStage =
  | { type: "rr-ready" }
  | { type: "rr-beat"; step: number; beat: number }
  | { type: "rr-restart"; hash: string }
  | { type: "rr-there" }

export function isToStage(data: unknown): data is ToStage {
  if (typeof data !== "object" || data === null) return false
  const m = data as Record<string, unknown>
  return (
    (m.type === "rr-step" && typeof m.step === "number") ||
    (m.type === "rr-moment" && typeof m.step === "number" && typeof m.beat === "number") ||
    (m.type === "rr-hold" && typeof m.hold === "boolean")
  )
}

export function isFromStage(data: unknown): data is FromStage {
  if (typeof data !== "object" || data === null) return false
  const m = data as Record<string, unknown>
  return (
    m.type === "rr-ready" ||
    m.type === "rr-there" ||
    (m.type === "rr-beat" && Number.isInteger(m.step) && Number.isInteger(m.beat)) ||
    (m.type === "rr-restart" && typeof m.hash === "string" && /^story-\d+(\.\d+)?$/.test(m.hash))
  )
}
