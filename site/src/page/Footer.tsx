import { CHANGES, GUIDE, RELEASES } from "./links"

export function Footer() {
  return (
    <footer className="footer">
      <span>reha.stream · MIT license</span>
      <nav aria-label="More">
        <a href={GUIDE}>Guide</a>
        <a href={CHANGES}>Changelog</a>
        <a href={RELEASES}>Releases</a>
      </nav>
    </footer>
  )
}
