// `npm run design-check`: refuses source that breaks the design rules (K3),
// in РЭХА's interface (ui/src), the band service (service/src) and the site
// (site/src). The rules themselves are in design-rules.mjs; this walks the
// parts and reports.
//
// Given parts by name, it walks only those: `npm run design-check -- ui`, or
// `node ../ui/scripts/design-check.mjs service` from service/. With none, all
// three. Each part's workflow checks its own part. It finds the repository's
// root from its own place (ui/scripts/), not from the directory it is started
// in, so the paths it reads and prints are from the root wherever it runs.
//
// design-check.allow.json let a screen not yet redone break a rule, as
// { "ui/src/screens/X.tsx": ["radius", ...] }, while the screens were redone
// one PR at a time. Every screen is redone, and the list is empty for good,
// `{}`: design-rules.test.mjs fails when anything is put back on it. The check
// still reads it, and fails on an entry that matches nothing and on any entry
// in ui/src/components/ui/.
//
// Prints one line per problem, `path:line rule text`, the path from the
// repository's root, and exits 1 if there is any; 2 for a part it does not
// know.

import { readdirSync, readFileSync } from "node:fs"
import { sep } from "node:path"
import { fileURLToPath } from "node:url"
import { checkText, isChecked, judge, missingStories, partsToCheck, RULES } from "./design-rules.mjs"

// The repository's root, whatever directory the script is started from.
const root = fileURLToPath(new URL("../..", import.meta.url))

let parts
try {
  parts = partsToCheck(process.argv.slice(2))
} catch (e) {
  console.error(`design-check: ${e.message}`)
  process.exit(2)
}

// Every .tsx and .ts under each part's src/ but the tests (isChecked), as
// `ui/src/...` with forward slashes (the allow-list is the same on every
// system), in a fixed order.
const files = parts
  .flatMap((part) =>
    readdirSync(`${root}${part}/src`, { recursive: true }).map((p) => `${part}/src/${p.split(sep).join("/")}`),
  )
  .filter(isChecked)
  .sort()

const findings = [
  ...files.flatMap((path) =>
    checkText(path, readFileSync(`${root}${path}`, "utf8")).map((f) => ({ path, ...f })),
  ),
  ...missingStories(files),
]

const allow = JSON.parse(readFileSync(`${root}ui/design-check.allow.json`, "utf8"))
const problems = judge(findings, allow)

if (problems.length === 0) {
  const pairs = Object.values(allow).reduce((n, rules) => n + rules.length, 0)
  console.log(
    `design-check: ok, ${files.length} files checked in ${parts.join(", ")}; ${pairs} known cases in ` +
      `${Object.keys(allow).length} files are on the allow-list`,
  )
} else {
  for (const p of problems) console.log(`${p.path}:${p.line} ${p.rule} ${p.text}`)

  console.log("")
  for (const rule of RULES) {
    if (problems.some((p) => p.rule === rule.name)) console.log(`${rule.name}: ${rule.why}`)
  }
  console.log(
    "\nFix what is listed. Only a graphic 1-2 px thick, text sized from the window, or a sheet " +
      "made for paper (black on white, sized for A4) may be waived, with a comment: " +
      "design-ok(<rule>): <reason>.",
  )
  process.exitCode = 1
}
