// What the page and a frame of stage.html say to each other.

/** From the page: which step of the story to show, or to hold still. */
export type ToStage = { type: "rr-step"; step: number } | { type: "rr-hold"; hold: boolean }

/** From the frame: it is up, and listening. */
export type FromStage = { type: "rr-ready" }

export function isToStage(data: unknown): data is ToStage {
  if (typeof data !== "object" || data === null) return false
  const m = data as Record<string, unknown>
  return (
    (m.type === "rr-step" && typeof m.step === "number") ||
    (m.type === "rr-hold" && typeof m.hold === "boolean")
  )
}

export function isFromStage(data: unknown): data is FromStage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "rr-ready"
}
