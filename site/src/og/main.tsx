// The link picture's page: what scripts/og.mjs photographs into og.png. The
// words are the page's own, from site/content/hero.md, and the app is the
// same frame the page's top shows. No analytics: nobody visits it.
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./og.css"
import { content } from "../content"
import { Logo } from "../page/Nav"

function Og() {
  const { hero } = content
  return (
    <>
      <div className="og-text">
        <div className="og-brand">
          <Logo />
          <span>РЭХА</span>
        </div>
        <h1>{hero.title}</h1>
        <p className="og-eyebrow">{hero.eyebrow}</p>
      </div>
      <div className="og-shot">
        <iframe src="/stage.html#hero" title="РЭХА playing a take" tabIndex={-1} />
      </div>
    </>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Og />
  </StrictMode>
)

// Whether the page's own font came, for scripts/og.mjs: once nothing is
// loading, fonts.ready is done whether or not the font did, and the picture
// would be drawn in the fallback.
void document.fonts.ready
  .then(() => document.fonts.load('600 60px "Instrument Sans"'))
  .then((faces) => (document.documentElement.dataset.og = faces.length > 0 ? "ready" : "no-font"))
