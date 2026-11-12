import logo from "../../../ui/public/logo.svg"

/** The app's icon, as the app draws it. */
export function Logo() {
  return <img src={logo} alt="" />
}

/** The menu: on the page itself `home` is "", and on another page (the 404
 *  one, a story) it is "/", so the links go to the page's parts from there. */
export function Nav({ repo, home = "" }: { repo: string; home?: string }) {
  return (
    <header className="nav">
      <a className="brand" href={home || "#top"} aria-label="РЭХА">
        <Logo />
        <span>РЭХА</span>
      </a>
      <nav className="menu">
        <a href={`${home}#how`}>How it works</a>
        <a href={`${home}#faq`}>FAQ</a>
        <a className="stories" href="/stories">
          Stories
        </a>
        <a href={repo}>GitHub</a>
        <a className="get" href={`${home}#top`}>
          Download
        </a>
      </nav>
    </header>
  )
}
