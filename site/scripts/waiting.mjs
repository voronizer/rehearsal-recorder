// `node site/scripts/waiting.mjs [tag]`: whether a block on the main page
// waits for a version newer than this release (see src/content/markdown.ts).
// Prints true or false; each waiting block goes to stderr, for the log.
// Without a tag, the version is the newest in CHANGELOG.md, as the build's.
//
// site.yml's first job asks it, to know whether a pull request also builds
// and tests the site with every block in (site · after release). It reads
// the files with the page's own reader, so a mark written wrong stops it,
// with the same message the site's tests give.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { displayVersion, latestVersion } from "../src/content/changelog.ts"
import { PAGE_FILES } from "../src/content/files.ts"
import { parseDoc } from "../src/content/markdown.ts"

const at = (path) => fileURLToPath(new URL(path, import.meta.url))
const tag = process.argv[2] || latestVersion(readFileSync(at("../../CHANGELOG.md"), "utf8"))
const release = displayVersion(tag)

let waits = false
for (const file of PAGE_FILES) {
  const { waiting } = parseDoc(readFileSync(at(`../content/${file}`), "utf8"), { release, file })
  for (const block of waiting) console.error(`site/content/${file}: ${block.title} waits for ${block.from}`)
  waits ||= waiting.length > 0
}
console.log(waits ? "true" : "false")
