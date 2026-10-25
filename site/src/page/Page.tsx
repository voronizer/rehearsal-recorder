import { Closing } from "./Closing"
import { Controller } from "./Controller"
import { Faq } from "./Faq"
import { Footer } from "./Footer"
import { Hero } from "./Hero"
import { Nav } from "./Nav"
import { Ribbon } from "./Ribbon"
import { StoriesBlock } from "./StoriesBlock"
import { Story } from "./Story"
import { REPO } from "./links"
import { isWindows } from "./os"
import type { PieceData } from "./pieces"

export function Page({ pieces }: { pieces: PieceData }) {
  return (
    <>
      <Ribbon />
      <div className="wrap">
        <Nav repo={REPO} />
        <main>
          <Hero windows={isWindows(navigator.platform, navigator.userAgent)} />
          <StoriesBlock />
          <Controller />
          <Story pieces={pieces} />
          <Faq />
        </main>
        <Closing />
        <Footer />
      </div>
    </>
  )
}
