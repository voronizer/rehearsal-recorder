import { content } from "../content"
import { releaseNotes } from "./links"

/** What's new, as one line above the menu. */
export function Ribbon() {
  return (
    <p className="ribbon">
      <b>New in {content.version}.</b> {content.news && <>{content.news} </>}
      <a className="more" href={releaseNotes(content.tag)}>
        Release notes
      </a>
    </p>
  )
}
