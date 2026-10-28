import { Closing } from "./Closing"
import { Controller } from "./Controller"
import { Faq } from "./Faq"
import { Footer } from "./Footer"
import { GetIt } from "./GetIt"
import { Hero } from "./Hero"
import { Nav } from "./Nav"
import { Ribbon } from "./Ribbon"
import { StoriesBlock } from "./StoriesBlock"
import { Story } from "./Story"
import { REPO } from "./links"
import { isWindows } from "./os"
import type { PieceData } from "./pieces"

export function Page({ pieces }: { pieces: PieceData }) {
  const windows = isWindows(navigator.platform, navigator.userAgent)
  return (
    <>
      <Ribbon />
      <div className="wrap">
        <Nav repo={REPO} />
        <main>
          <Hero windows={windows} />
          <StoriesBlock />
          <Story pieces={pieces} />
          <Controller />
          <Faq />
          <GetIt windows={windows} />
        </main>
        <Closing />
        <Footer />
      </div>
    </>
  )
}
