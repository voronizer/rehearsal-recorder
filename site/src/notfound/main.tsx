// The 404 page: the site's menu and words, and a take of the app's with
// nothing on it, on the same fake Python side as the page's pieces. No
// analytics: a visit here is a link gone wrong, not a visit.
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "../page/page.css"
import { loadDeletionKind } from "@/lib/deletion"
import { loadLabels } from "@/lib/labels"
import { demoApi, installDemo } from "../stage/demo"
import { isWindows } from "../page/os"
import { NotFound, SILENT_FOLDER, SILENT_SECONDS } from "./NotFound"
import { silence } from "./silence"

installDemo()
silence(demoApi(), SILENT_FOLDER, SILENT_SECONDS)

// The app's player listens for its keys on the whole window (Home, R, ?, the
// arrows). Here the take is a picture and the keys are the page's, so they
// stop before the player hears them; what a key does by itself (scrolling,
// following a link) still happens.
window.addEventListener("keydown", (e) => e.stopPropagation(), true)

async function boot() {
  await loadDeletionKind()
  await loadLabels()
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <NotFound windows={isWindows(navigator.platform, navigator.userAgent)} />
    </StrictMode>
  )
}

void boot()
