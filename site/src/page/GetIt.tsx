import { content } from "../content"
import { Downloads } from "./Downloads"
import { Inline } from "./Md"
import { Logo } from "./Nav"

/** The end of the main page: the icon, a line, and the downloads again, as
 *  on the first screen, for whoever read this far. */
export function GetIt({ windows }: { windows: boolean }) {
  const { download } = content
  return (
    <section className="get-it" id="download">
      <Logo />
      <h2 className="h2">{download.title}</h2>
      <p className="lede">
        <Inline text={download.lede} />
      </p>
      <Downloads windows={windows} />
      <p className="fine">
        Version {content.version} · {content.hero.finePrint}
      </p>
    </section>
  )
}
