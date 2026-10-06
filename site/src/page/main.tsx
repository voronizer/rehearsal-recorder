import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { content } from "../content"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <h1>{content.hero.title}</h1>
  </StrictMode>
)
