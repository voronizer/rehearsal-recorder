import { content } from "../content"
import { NEW_ISSUE, REPO } from "./links"

/** Open source, as one line before the footer. */
export function Closing() {
  return (
    <div className="oss">
      <p>{content.closing.title}</p>
      <div className="links">
        <a className="more" href={REPO}>
          Source on GitHub
        </a>
        <a className="more" href={NEW_ISSUE}>
          Report a problem
        </a>
      </div>
    </div>
  )
}
