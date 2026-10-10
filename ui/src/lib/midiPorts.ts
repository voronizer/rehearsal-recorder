/**
 * Which listed port a saved one is: the interface's side of
 * src/rehearsal_recorder/midi/identity.py find_port.
 *
 * The setup screen says a track's port is there, or not connected, from the
 * list Python sends every second. It has to find ports exactly as Python
 * does, or a card says "not connected" over a port the rehearsal would open,
 * or the other way round.
 */

import type { MidiPort, MidiPortRef } from "@/lib/api"

// What Windows adds to a port's name: "2- " in front of a second device of
// the same kind, and a number at the end ("TD-17 1").
const NUMBER_IN_FRONT = /^\d+-\s*/
const NUMBER_AT_END = /\s+\d+$/

/** A port's name without what Windows adds to it, which can change when a
 *  device is plugged in again (identity.bare_name). */
export function bareName(name: string): string {
  return name.trim().replace(NUMBER_IN_FRONT, "").replace(NUMBER_AT_END, "")
}

/** A field that says something: text that is not only space. */
function said(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

/**
 * The port in `ports` that `saved` is, tried in Python's order: the same id
 * where both have one, then the same name, then the same bare name on the
 * same device where both name one. The first way that finds any decides.
 * Two or more alike are not guessed between: `alike` is true and `port`
 * null, and the track shows its port as not connected.
 */
export function findPort(
  saved: MidiPortRef,
  ports: MidiPort[]
): { port: MidiPort | null; alike: boolean } {
  const decide = (found: MidiPort[]) =>
    found.length === 1 ? { port: found[0], alike: false } : { port: null, alike: true }

  if (said(saved.id)) {
    const found = ports.filter((p) => p.id === saved.id)
    if (found.length) return decide(found)
  }
  if (said(saved.name)) {
    const named = ports.filter((p) => p.name === saved.name)
    if (named.length) return decide(named)
    const bare = bareName(saved.name)
    // An empty bare name would match every port that is only Windows' numbers.
    if (bare) {
      const device = said(saved.device) ? saved.device : ""
      const found = ports.filter(
        (p) => bareName(p.name) === bare && (!said(p.device) || !device || p.device === device)
      )
      if (found.length) return decide(found)
    }
  }
  return { port: null, alike: false }
}

/** A listed port as a band keeps it (rules.port_ref): what the system said of
 *  it, without the check's count or a field that says nothing. */
export function portRef(port: MidiPort | MidiPortRef): MidiPortRef {
  const kept: MidiPortRef = { name: port.name }
  for (const key of ["device", "maker", "id"] as const) {
    const value = port[key]
    if (said(value)) kept[key] = value
  }
  return kept
}
