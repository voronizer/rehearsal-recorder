import { api } from "@/lib/api"
import { notify } from "@/lib/notices"

/**
 * A rehearsal's folder, opened in the system's file manager; what went
 * wrong is said in a notice. The folder button beside a rehearsal's facts
 * and the one after the pencil in History's pane head both open it this
 * way. It sits beside lib/platform.ts, which has the system's words for
 * the button, rather than in it: that file asks nothing of Python.
 */
export async function showFolder(folder: string) {
  const res = await api().show_rehearsal_folder(folder)
  if (!res.ok) notify({ key: "folder", kind: "error", text: res.error ?? "Could not open the folder" })
}
