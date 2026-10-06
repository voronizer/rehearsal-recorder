// A frame of the site: one live piece of the app, on the fake Python side.
// #hero is the rehearsal screen, playing; #story goes through the steps the
// page tells it to. See ../frame.ts for what the page says.
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import "./stage.css"
import { ErrorBar } from "@/components/ErrorBar"
import { Notices } from "@/components/Notices"
import { applyAppearance } from "@/lib/appearance"
import { loadDeletionKind } from "@/lib/deletion"
import { loadLabels } from "@/lib/labels"
import { isToStage, type FromStage } from "../frame"
import { createHold, type HoldWindow } from "./hold"
import { installDemo } from "./demo"
import { Hero, playTheBridge, startHeroRehearsal } from "./Hero"
import { Story, startStory } from "./Story"

// First, before anything sets a timer: the fake's own ones are held too.
const hold = createHold(window as unknown as HoldWindow)
installDemo()
applyAppearance("light", 1)

const root = document.documentElement
root.dataset.held = "false"

let goto: ((step: number) => void) | null = null
let wanted: number | null = null
window.addEventListener("message", (e) => {
  if (e.source !== window.parent || !isToStage(e.data)) return
  if (e.data.type === "rr-hold") {
    hold.hold(e.data.hold)
    root.dataset.held = String(e.data.hold)
  } else if (goto) {
    goto(e.data.step)
  } else {
    wanted = e.data.step
  }
})

async function boot() {
  // What App does before its first screen, that these screens rely on.
  await loadDeletionKind()
  await loadLabels()

  const app = createRoot(document.getElementById("root")!)
  const screen = (main: ReactNode) => (
    <>
      {main}
      <ErrorBar />
      <Notices />
    </>
  )
  const hash = location.hash.slice(1)
  if (hash === "hero") {
    app.render(screen(<Hero initial={await startHeroRehearsal()} />))
    void playTheBridge().catch((e) => console.warn(e))
  } else if (hash === "story" || hash.startsWith("story-")) {
    app.render(screen(<Story />))
    const from = hash.startsWith("story-") ? Number(hash.slice("story-".length)) : null
    goto = startStory(Number.isInteger(from) ? from : wanted)
    if (from !== null && wanted !== null) goto(wanted)
  }
  const ready: FromStage = { type: "rr-ready" }
  window.parent.postMessage(ready, "*")
}

void boot()
