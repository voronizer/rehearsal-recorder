import { api, type CutAt, type PendingTake, type UndoResult } from "@/lib/api"
import { reportPageError } from "@/lib/bridgeErrors"
import { croppedText, goneText, startsOnBar, trashName } from "@/lib/deletion"
import { dismiss, getNotices, notify } from "@/lib/notices"

/**
 * Removing something happens at once, and can be taken back (spec B1).
 *
 * Deleting a take or a rehearsal, clearing false starts, discarding a take
 * and cropping one used to ask first, and the question was answered without
 * reading it. Now they are done when clicked, and a notice says what went,
 * with Undo, for ten seconds (lib/notices.ts); ⌘Z or Ctrl+Z is the same
 * Undo. Python keeps what went in its holding folder until then: its Undo
 * (undo_trash) puts it back whole, and the notice ending (end_trash) sends
 * it on to the Trash. Nothing is destroyed either way.
 */

/** What an Undo says that found what went back where it was already: its
 *  Undo, or an end, put it back (api.py BACK). */
const BACK_TEXT = "It is back where it was."

/**
 * Says what went, under a key of its own (`undo:{token}`), with Undo.
 *
 * Undo asks Python for it back and hands the answer to `onUndone`, which
 * puts the screen back as it was. An Undo refused for now (a crop of the
 * take still running, its place or number taken since) is offered again with
 * why, as an error, and its removal still ends when that notice goes. One
 * too late (`gone`) is said in the system's words for the Trash, and one
 * whose item is back where it was already (`back`) says so: nothing is left
 * to offer or end. One a crop's Undo could not finish (`finishing`) is
 * finished by ending it at once.
 *
 * Returns the offer's end: what the screen calls when the moment for Undo
 * has passed (another take started, the take saved). The notice goes, and
 * what went goes on to the Trash.
 */
export function offerUndo({
  text,
  token,
  onUndone,
}: {
  text: string
  token: string
  onUndone: (r: UndoResult) => unknown
}): () => void {
  const key = `undo:${token}`

  async function end() {
    const r = await api().end_trash(token)
    if (!r.ok) {
      notify({ key, kind: "error", text: r.error ?? `Could not move it to ${trashName()}` })
    }
  }

  async function undo() {
    const r = await api().undo_trash(token)
    if (r.ok) {
      await onUndone(r)
      return
    }
    if (r.finishing) {
      // Part of it is back and the rest would not follow: the end finishes
      // the Undo, as it would at the next start.
      const f = await api().end_trash(token)
      if (f.ok) await onUndone({ ok: true, kind: r.kind })
      else notify({ key, kind: "error", text: f.error ?? "Could not put it back" })
      return
    }
    // Python's flags, not its words: the words are the system's (spec P2).
    if (r.gone) {
      notify({ key, kind: "error", text: goneText() })
      return
    }
    if (r.back) {
      notify({ key, kind: "done", text: BACK_TEXT })
      return
    }
    offer("error", r.error ?? "Could not put it back")
  }

  // Both run from a notice, which calls them and goes on: what fails on the
  // way is said on the error bar, as any bridge failure is. A failure in
  // Python is already said and logged by api(); what is left to catch here
  // is the page's own, which reportPageError writes to crash.log too.
  function offer(kind: "done" | "error", said: string) {
    notify({
      key,
      kind,
      text: said,
      action: { label: "Undo", run: () => void undo().catch((e) => reportPageError("Undo", e)) },
      onGone: () => void end().catch((e) => reportPageError("end_trash", e)),
    })
  }

  offer("done", text)
  return () => dismiss(key)
}

/**
 * Lets go the notices of the removals Python has just ended on its own
 * (`ended`, answered by every call that removes, crops or keeps): removing
 * a take ends its earlier removals and crops, a crop the take's earlier
 * crops, a rehearsal all of it, takes and drafts, by what Python knows them
 * by, whatever their folder is called now. An Undo of one would only be told
 * it has gone. Their end_trash finds nothing left, and answers ok; what was
 * said of one whose end failed before goes with it, as it is ended now.
 */
export function endedByPython(tokens?: string[] | null) {
  for (const token of tokens ?? []) dismiss(`undo:${token}`)
}

/** Ends every offer, its removal with it: a switch of the recordings folder
 *  ended them all, or left them in the old folder, before it switched. An
 *  offer is a removal's notice that still has its Undo; what was said of
 *  one whose end failed stays. */
export function endEveryOffer() {
  for (const n of getNotices()) {
    if (n.key.startsWith("undo:") && n.action) dismiss(n.key)
  }
}

/**
 * What a crop says once it went through: its Undo, which `onUndone` answers
 * by putting the take back as it was; or, when the uncut take could not wait
 * for one, a warning under the screen's `key` that says where it is. The
 * take's earlier crops are ended by Python (the crop's `ended`, which the
 * caller hands to endedByPython); this one ends when the take is saved,
 * discarded, deleted or cropped again, and Python says so then.
 *
 * `asked` is where the region started. Python cuts a click take from the
 * bar line at or before it (its answer's `start_sec`), and the notice then
 * says where the take now starts, whichever screen the crop was made on.
 */
export function offerCropUndo(
  name: string,
  res: { undo?: string | null; error?: string } & CutAt,
  onUndone: (r: UndoResult) => unknown,
  key: string,
  asked: number
) {
  // Moved by more than a rounding: a crop cut where it was asked says
  // nothing more.
  const from =
    typeof res.start_sec === "number" && Math.abs(res.start_sec - asked) > 0.001 ? res.start_sec : null
  if (res.undo) {
    offerUndo({ text: croppedText(name, from), token: res.undo, onUndone })
    return
  }
  if (res.error) {
    // Python's words after a colon: they can end in a folder named
    // "… (before crop)", which brackets of our own would run into.
    notify({
      key,
      kind: "warning",
      text:
        from === null
          ? `“${name}” is cropped, but the uncut take could not be moved out of the way, so the crop cannot be undone: ${res.error}.`
          : `“${name}” is cropped. ${startsOnBar(from)} The uncut take could not be moved out of the way, so the crop cannot be undone: ${res.error}.`,
    })
  }
}

/**
 * A discarded take as its Undo brought it back: under `dir`, the folder
 * Python put the draft back in (undo_trash's `temp_dir`), which is not where
 * it went from once its rehearsal was renamed meanwhile. Its audio and notes
 * are moved there with it, so the review screen plays what is on disk.
 */
export function draftMovedTo<T extends PendingTake>(take: T, dir: string | undefined): T {
  const from = take.temp_dir
  if (!dir || dir === from) return take
  const moved = <F extends { file: string }>(f: F): F => {
    const rest = f.file.slice(from.length)
    return f.file.startsWith(from) && (rest[0] === "/" || rest[0] === "\\")
      ? { ...f, file: dir + rest }
      : f
  }
  return {
    ...take,
    temp_dir: dir,
    tracks: take.tracks.map(moved),
    notes: take.notes?.map(moved),
  }
}

/**
 * What a switch of the recordings folder says about removals it could not
 * end in the old folder (set_recordings_dir's `kept`): they stay there, and
 * no start of the app will look there again, so this is the one time they
 * are named.
 */
export function keptText(folders: string[]): string {
  const end = `put back or moved to ${trashName()}.`
  if (folders.length === 1) {
    return `Something that was being removed stays in “${folders[0]}”: it could not be ${end}`
  }
  const named = folders.map((f) => `“${f}”`).join(", ")
  return `${folders.length} things that were being removed stay where they were: ${named}. They could not be ${end}`
}
