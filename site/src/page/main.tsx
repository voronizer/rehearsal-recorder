import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./page.css"
import { loadDeletionKind } from "@/lib/deletion"
import { loadLabels } from "@/lib/labels"
import { installDemo } from "../stage/demo"
import { Page } from "./Page"
import { loadPieces } from "./pieces"

// The tiles' pieces of the app are drawn here, in the page, from the same
// fake Python side the frames run on.
installDemo()

async function boot() {
  await loadDeletionKind()
  await loadLabels()
  const pieces = await loadPieces()
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Page pieces={pieces} />
    </StrictMode>
  )
}

void boot()
