import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { inject } from "@vercel/analytics"
import { injectSpeedInsights } from "@vercel/speed-insights"
import "./page.css"
import { loadDeletionKind } from "@/lib/deletion"
import { loadLabels } from "@/lib/labels"
import { installDemo } from "../stage/demo"
import { onlyOnSite } from "./analytics"
import { Page } from "./Page"
import { loadPieces } from "./pieces"

// Visits are counted by Vercel's Web Analytics, and how fast the page loads
// for them by its Speed Insights: the page only, so a visit is one view
// however many frames of the app it shows. Built here and not on Vercel, it
// loads Vercel's scripts from /_vercel/insights/ and /_vercel/speed-insights/,
// which a deployment serves once the project has each switched on and Vercel
// has made the deployment through its own build step (see site.yml). A pull
// request's preview loads the same page, and only reha.stream's visitors are
// counted.
inject({ beforeSend: onlyOnSite })
injectSpeedInsights({ beforeSend: onlyOnSite })

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
