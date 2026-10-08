/** The app's icon, as the app draws it. */
export function Logo() {
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true">
      <rect x="24" y="24" width="208" height="208" rx="48" fill="#1b1b21" />
      <circle cx="128" cy="128" r="78" fill="#e5484d" />
      <g fill="#fff">
        <rect x="69" y="115" width="10" height="26" rx="5" />
        <rect x="87" y="100" width="10" height="56" rx="5" />
        <rect x="105" y="82" width="10" height="92" rx="5" />
        <rect x="123" y="96" width="10" height="64" rx="5" />
        <rect x="141" y="78" width="10" height="100" rx="5" />
        <rect x="159" y="104" width="10" height="48" rx="5" />
        <rect x="177" y="117" width="10" height="22" rx="5" />
      </g>
    </svg>
  )
}

/** The menu: on the page itself `home` is "", and on another page (the 404
 *  one) it is "/", so the links go to the page's parts from there. */
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
        <a href={repo}>GitHub</a>
        <a className="get" href={`${home}#top`}>
          Download
        </a>
      </nav>
    </header>
  )
}
