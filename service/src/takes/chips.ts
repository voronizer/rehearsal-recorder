import type { Marker } from "@/lib/api"

/**
 * A take's marks as РЭХА's player draws them, and the mark each one stands
 * for. Two of the band can mark the same second: each still opens its own
 * talk, found by its place in the list. A chip from an earlier drawing of
 * the page is found by its time and words, or else its time.
 */
export function chipsOf<M extends Marker>(marks: M[]): { markers: Marker[]; markOf: (m: Marker) => M | undefined } {
  const markers: Marker[] = marks.map((m) => ({ at: m.at, label_id: m.label_id, note: m.note }))
  const markOf = (m: Marker) =>
    marks[markers.indexOf(m)] ?? marks.find((x) => x.at === m.at && x.note === m.note) ?? marks.find((x) => x.at === m.at)
  return { markers, markOf }
}
