// A frame of the site: one live piece of the app, on the fake Python side.
// #hero is the rehearsal screen, playing; #story goes through the steps the
// page tells it to, and #story-<step> or #story-<step>.<beat> starts it
// walking to that place. See ../frame.ts for what the page says.
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
import { Story, startStory, type Target } from "./Story"

// First, before anything sets a timer: the fake's own ones are held too.
const hold = createHold(window as unknown as HoldWindow)
installDemo()
applyAppearance("light", 1)

const root = document.documentElement
root.dataset.held = "false"

let goto: ((target: Target) => void) | null = null
let wanted: Target | null = null
window.addEventListener("message", (e) => {
  if (e.source !== window.parent || !isToStage(e.data)) return
  if (e.data.type === "rr-hold") {
    hold.hold(e.data.hold)
    root.dataset.held = String(e.data.hold)
    return
  }
  const target = { step: e.data.step, beat: e.data.type === "rr-moment" ? e.data.beat : null }
  if (goto) goto(target)
  else wanted = target
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
    const at = /^story-(\d+)(?:\.(\d+))?$/.exec(hash)
    goto = startStory(at && { step: Number(at[1]), beat: at[2] === undefined ? null : Number(at[2]) })
    if (wanted) goto(wanted)
  }
  const ready: FromStage = { type: "rr-ready" }
  window.parent.postMessage(ready, "*")
}

void boot()
