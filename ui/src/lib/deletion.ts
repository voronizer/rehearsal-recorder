import { api } from "@/lib/api"

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
let where: { kind: string; folder: string } | null = null

export async function loadDeletionKind() {
  try {
    const s = await api().get_settings()
    where = { kind: s.trash_kind ?? "system", folder: s.fallback_trash ?? "_deleted" }
  } catch {
    where = null
  }
}

/** "goes to the Trash" / "moves to the _deleted folder" — for a sentence. */
export function goesTo() {
  if (where?.kind === "folder") {
    return `moves to the ${where.folder} folder in your recordings`
  }
  return "goes to the Trash"
}

/** The same, for several things at once. */
export function goPlural() {
  if (where?.kind === "folder") {
    return `move to the ${where.folder} folder in your recordings`
  }
  return "go to the Trash"
}

export function canBePutBack() {
  return where?.kind === "folder"
    ? "Nothing is destroyed — you can move it back, or empty that folder yourself."
    : "You can put it back from there."
}
