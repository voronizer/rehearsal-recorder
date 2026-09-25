import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { App } from "./App"
import { ErrorBar } from "./components/ErrorBar"
import { Notices } from "./components/Notices"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    {/* Outside App, which returns a different screen from each of its
        branches: a failure has to be said over whichever one is open. */}
    <ErrorBar />
    {/* Outside App for the same reason, and because a notice outlives the
        screen that raised it: a warning about playback is still true after
        leaving Settings. */}
    <Notices />
  </StrictMode>
)
