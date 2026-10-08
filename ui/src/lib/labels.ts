import { useSyncExternalStore } from "react"
import { api, type Label, type LabelColour, type Marker } from "@/lib/api"

/**
 * The labels a mark can have, read from the library once when the app starts
 * and again whenever they may have changed. Every place that draws a mark
 * reads them here, so a label renamed or recoloured in Settings is the new
 * one everywhere at once (spec D5).
 *
 * A label is a name and a colour and nothing more: nothing here, or anywhere,
 * treats one label differently from another (spec D1). The one rule about
 * the list is that its first label is what a mark gets when it has none.
 */

/** The palette, in the order Settings offers it. LABEL_COLOURS in
 *  store/library.py is the same list. */
export const LABEL_COLOURS: readonly LabelColour[] = [
  "grey",
  "red",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
]

// Written out colour by colour: Tailwind finds class names by reading the
// source, and one put together at runtime ("bg-label-" + colour) would never
// be built.
const LOOK: Record<LabelColour, { dot: string; chip: string; swatch: string }> = {
  grey: { dot: "bg-label-grey", chip: "border-label-grey/50 bg-label-grey/10", swatch: "bg-label-grey" },
  red: { dot: "bg-label-red", chip: "border-label-red/50 bg-label-red/10", swatch: "bg-label-red" },
  amber: { dot: "bg-label-amber", chip: "border-label-amber/50 bg-label-amber/10", swatch: "bg-label-amber" },
  green: { dot: "bg-label-green", chip: "border-label-green/50 bg-label-green/10", swatch: "bg-label-green" },
  teal: { dot: "bg-label-teal", chip: "border-label-teal/50 bg-label-teal/10", swatch: "bg-label-teal" },
  blue: { dot: "bg-label-blue", chip: "border-label-blue/50 bg-label-blue/10", swatch: "bg-label-blue" },
  violet: { dot: "bg-label-violet", chip: "border-label-violet/50 bg-label-violet/10", swatch: "bg-label-violet" },
  pink: { dot: "bg-label-pink", chip: "border-label-pink/50 bg-label-pink/10", swatch: "bg-label-pink" },
}

/** How a colour is drawn: the variable the waveform reads, and the classes
 *  for a dot, a chip and a swatch in the palette. */
export function labelLook(colour: LabelColour) {
  // A colour this version does not know, from a newer one's library, is grey.
  const known: LabelColour = colour in LOOK ? colour : "grey"
  return { cssVar: `--label-${known}`, ...LOOK[known] }
}

// What a mark is drawn with in the moment before the labels have been read.
const UNREAD: Label = { id: 0, name: "Mark", colour: "grey", marks: 0 }

/** A mark's label. One that is not in the list — read before a change in
 *  Settings came back — is drawn as the first, which is what Python gives
 *  such a mark. */
export function labelOf(labels: Label[], id: number): Label {
  return labels.find((l) => l.id === id) ?? labels[0] ?? UNREAD
}

/** A mark in words: its label's name, then its comment when it has one. */
export function markText(label: Label, note: string): string {
  return note.trim() ? `${label.name} · ${note.trim()}` : label.name
}

/** How many of these marks each label has, in the labels' order, leaving
 *  out the labels with none. */
export function labelCounts(labels: Label[], markers: Marker[]): { label: Label; n: number }[] {
  const counts = new Map<number, number>()
  for (const m of markers) {
    const id = labelOf(labels, m.label_id).id
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return labels.filter((l) => counts.has(l.id)).map((l) => ({ label: l, n: counts.get(l.id)! }))
}

/** The colour a new label starts with: the first no label has, or grey. */
export function firstFreeColour(labels: Label[]): LabelColour {
  return LABEL_COLOURS.find((c) => !labels.some((l) => l.colour === c)) ?? "grey"
}

let current: Label[] = []
/** How many times the labels were asked for: only the last answer counts. */
let asked = 0
const listeners = new Set<() => void>()

function set(next: Label[]) {
  current = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The library's labels, in order. */
export function useLabels(): Label[] {
  return useSyncExternalStore(subscribe, () => current)
}

/**
 * Asks Python for the labels: when the app starts, after another recordings
 * folder is chosen (another library has other labels), and when Settings ›
 * Marks opens, for fresh counts. A failure keeps what was there; the bridge
 * has already said it.
 */
export async function loadLabels() {
  const ticket = ++asked
  try {
    const labels = await api().list_labels()
    // Python answers each call on a thread of its own: an answer asked for
    // before the last one has older counts.
    if (ticket === asked) set(labels)
  } catch {
    // Said by the bridge's error bar.
  }
}

/** What a change in Settings answered: every label as it is now. */
export function labelsChanged(labels: Label[]) {
  asked++
  set(labels)
}
