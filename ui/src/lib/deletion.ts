import { api, type Take } from "@/lib/api"
import { words } from "@/lib/platform"

/**
 * What deleting actually does on this machine, in words.
 *
 * macOS and most Linux desktops have a Trash we can reach; Windows has a
 * Recycle Bin that needs the send2trash package to use. When none of that is
 * available the app moves things into a _deleted folder instead — which is
 * still reversible, but it is not the Trash, and a dialog that says "goes to
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

/** "goes to the Trash" / "goes to the Recycle Bin" / "moves to the _deleted
 *  folder" — for a sentence. */
export function goesTo() {
  if (where?.kind === "folder") {
    return `moves to the ${where.folder} folder in your recordings`
  }
  return `goes to ${words().trash}`
}

/** The same, for several things at once. */
export function goPlural() {
  if (where?.kind === "folder") {
    return `move to the ${where.folder} folder in your recordings`
  }
  return `go to ${words().trash}`
}

/** "the Trash" / "the Recycle Bin" / "the _deleted folder": where a question
 *  says things go, in the words of the system. */
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

/** The notice for a take that was cropped: the take as it was is what went. */
export function croppedText(name: string): string {
  return `“${name}” is cropped. The uncut take ${wentToEnd()}`
}

export function canBePutBack(several = false) {
  const it = several ? "them" : "it"
  return where?.kind === "folder"
    ? `Nothing is destroyed — you can move ${it} back, or empty that folder yourself.`
    : `You can put ${it} back from there.`
}

/**
 * The sentence for a take's copy in the cloud, which a delete takes with it.
 * That folder is the band's, and somebody may be listening to the copy — so
 * a question that only mentioned the laptop would be answered not knowing.
 * Empty for a take that is not there.
 */
export function takeCloudToo(take: Take | null): string {
  return take?.cloud?.mix || take?.cloud?.tracks
    ? " Its copy in the cloud folder goes too."
    : ""
}

/** The same for a whole rehearsal: how many of its takes are there. */
export function rehearsalCloudToo(inCloud = 0, takes = 0): string {
  if (inCloud <= 0) return ""
  if (inCloud >= takes) {
    return takes === 1
      ? " So does its copy in the cloud folder."
      : " So do their copies in the cloud folder."
  }
  return inCloud === 1
    ? " So does the copy of one of them in the cloud folder."
    : ` So do the copies of ${inCloud} of them in the cloud folder.`
}
