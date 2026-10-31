import type { SendTo, ServiceFile, Take } from "@/lib/api"
import { formatBytes } from "@/lib/format"

/** A take on its way, as the rehearsal screen and History say it. */
export type SendState = "queued" | "working"

/**
 * Whether a take is in the place takes go to (Settings › Folders' switch):
 * a copy in the cloud folder, or in the band service, sent or on its way.
 * One the service turned down is not: its cloud button sends it again.
 */
export function isIn(take: Take, place: SendTo): boolean {
  if (place === "service") return Boolean(take.service) && !take.service?.error
  return Boolean(take.cloud?.mix || take.cloud?.tracks)
}

/** Whether it is there for the band to hear: drawn in the signal colour. */
export function isUp(take: Take, place: SendTo): boolean {
  if (place === "service") return Boolean(take.service?.up)
  return isIn(take, "cloud")
}

/** Why it is not there, when something went wrong. */
export function sendError(take: Take, place: SendTo): string | undefined {
  if (place === "service") return take.service?.error ?? undefined
  return take.cloud_error
}

/** A pending send or an error, in words. */
export function sendStatus(take: Take, state: SendState | undefined, place: SendTo): string | null {
  if (place === "service") {
    if (state) return state === "working" ? "Sending to the band service" : "Waiting for the band service"
    return take.service?.error ? "Not in the band service" : null
  }
  if (state) return state === "working" ? "Copying to the cloud" : "Waiting for the cloud"
  return take.cloud_error ? "Not in the cloud" : null
}

/** The cloud button's words: its name for a screen reader, and its tip. */
export function sendButton(take: Take, place: SendTo): { label: string; tip: string } {
  const there = isIn(take, place)
  if (place === "service") {
    return there
      ? { label: `“${take.name}” in the band service`, tip: "In the band service" }
      : { label: `Send ${take.name} to the band service`, tip: "Send this take to the band service" }
  }
  return there
    ? { label: `Cloud copies of ${take.name}`, tip: "In the cloud folder" }
    : { label: `Copy ${take.name} to the cloud`, tip: "Copy this take to the cloud folder" }
}

/** The tick beside a take that is there. */
export function upLabel(place: SendTo): string {
  return place === "service" ? "In the band service" : "In the cloud folder"
}

/** What of one track is up in the band service, in words. */
export function trackUp(file: ServiceFile): string {
  if (file.mp3 && file.flac) return "MP3 and FLAC"
  if (file.mp3) return "MP3, FLAC on its way"
  return "On its way"
}

/** "Still sending 3 takes to the band service, 1.2 GB left." */
export function stillSending(takes: number, bytes: number): string {
  const what = takes === 1 ? "1 take" : `${takes} takes`
  // Nothing to weigh when only a take's details are left (a rename made
  // while offline): no size, rather than “0 B left”.
  if (bytes <= 0) return `Still sending ${what} to the band service.`
  return `Still sending ${what} to the band service, ${formatBytes(bytes)} left.`
}
