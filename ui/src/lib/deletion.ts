import { api } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { words } from "@/lib/platform"

/**
 * What deleting actually does on this machine, in words.
 *
 * macOS and most Linux desktops have a Trash we can reach; Windows has a
 * Recycle Bin that needs the send2trash package to use. When none of that is
 * available the app moves things into a _deleted folder instead — which is
 * still reversible, but it is not the Trash, and a notice that says "went to
 * the Trash" on a machine with no Trash is simply a lie.
 *
 * Nothing is ever destroyed either way. That part is the same everywhere, and
 * it is the part worth promising.
 */
type Where = { kind: string; folder: string }
let where: Where | null = null

/** Says where deleting goes without asking the settings: for the tests,
 *  and for the showcase. null forgets it, as before the settings are read. */
export function setDeletionKind(w: Where | null) {
  where = w
}

export async function loadDeletionKind() {
  try {
    const s = await api().get_settings()
    where = { kind: s.trash_kind ?? "system", folder: s.fallback_trash ?? "_deleted" }
  } catch {
    where = null
  }
}

/** "the Trash" / "the Recycle Bin" / "the _deleted folder": where things go,
 *  in the words of the system. */
export function trashName() {
  return where?.kind === "folder" ? `the ${where.folder} folder` : words().trash
}

/** How a sentence ends that says where a removed thing went. */
function wentToEnd() {
  return where?.kind === "folder"
    ? `moved to the ${where.folder} folder.`
    : `went to ${words().trash}.`
}

/** What the notice says when something has gone: "“Palyn 3” went to the
 *  Trash." / "… the Recycle Bin." / "… moved to the _deleted folder." The
 *  subject comes with its quotes, or its count, already on. */
export function wentTo(subject: string): string {
  return `${subject} ${wentToEnd()}`
}

/** What an Undo too late says, Python having answered "gone": "It has
 *  already gone to the Trash." / "… the Recycle Bin." / "It has already
 *  moved to the _deleted folder." */
export function goneText(): string {
  return where?.kind === "folder"
    ? `It has already moved to the ${where.folder} folder.`
    : `It has already gone to ${words().trash}.`
}

/** Where a click take now starts, its start moved back by a crop to the
 *  bar line before the region: "It now starts on the bar at 0:01." `from`
 *  is in the take's seconds before the crop. */
export function startsOnBar(from: number): string {
  return `It now starts on the bar at ${formatClock(from)}.`
}

/** The notice for a take that was cropped: the take as it was is what went,
 *  and before that, for a click take, where it now starts (startsOnBar):
 *  "“Palyn 3” is cropped. It now starts on the bar at 0:01. The uncut take
 *  went to the Trash." */
export function croppedText(name: string, from: number | null = null): string {
  const starts = from === null ? "" : ` ${startsOnBar(from)}`
  return `“${name}” is cropped.${starts} The uncut take ${wentToEnd()}`
}
