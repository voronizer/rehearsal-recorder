// `npm run bridge-check`: the seam between РЭХА's Python and its interface.
//
// The interface lists every call it may make of Python in ui/src/lib/api.ts
// (`type PyApi`). Python answers them from the class Api in
// src/rehearsal_recorder/api.py, and the interface's tests talk to a stand-in
// for it, ui/e2e/fake-bridge.js. Nothing else compares the three, so a call
// renamed in Python, or one the stand-in lacks, would pass every other check.
//
// This fails when a listed call is missing in Python or in the stand-in, or
// when the stand-in has a call the list does not have, and names each one.
// Python may have public methods the list lacks. Names only: comparing what
// each call takes would need the two languages' types side by side, and
// neither file has them.
//
// It reads PyApi by its layout: one block, each call starting a line of its
// own two spaces in. TypeScript 7 keeps its parser out of its stable exports.
// Python is read with Python's own parser (ast), importing nothing; the
// stand-in is loaded in Node with a stand-in window. It runs in
// .github/workflows/bridge.yml, and by hand.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const LIST = "ui/src/lib/api.ts"
const PYTHON = "src/rehearsal_recorder/api.py"
const FAKE = "ui/e2e/fake-bridge.js"

/** The calls PyApi lists, in its order. */
export function pyApiNames(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const start = lines.findIndex((line) => /^type PyApi = \{\s*$/.test(line))
  const names = []
  if (start >= 0)
    for (const line of lines.slice(start + 1)) {
      if (/^\}/.test(line)) break
      const call = /^ {2}([A-Za-z_]\w*)\s*[<(]/.exec(line)
      if (call) names.push(call[1])
    }
  if (!names.length) throw new Error(`${LIST} has no type PyApi`)
  return names
}

// Prints, as JSON, the public methods of the module's top-level class Api:
// no leading underscore, and not a property or one of its setters.
const PYTHON_NAMES = `
import ast, json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    tree = ast.parse(f.read(), path)
api = next((n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Api"), None)
if api is None:
    sys.exit(path + " has no class Api")
def is_property(d):
    if isinstance(d, ast.Name):
        return d.id in ("property", "cached_property")
    if isinstance(d, ast.Attribute):
        return d.attr in ("setter", "getter", "deleter", "cached_property")
    return False
print(json.dumps([
    n.name for n in api.body
    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    and not n.name.startswith("_")
    and not any(is_property(d) for d in n.decorator_list)
]))
`

/** The public methods of Python's class Api in this file. */
export function pythonApiNames(file, python = process.env.PYTHON || "python3") {
  try {
    const out = execFileSync(python, ["-I", "-c", PYTHON_NAMES, file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return JSON.parse(out)
  } catch (e) {
    const said = e.stderr?.toString().trim()
    throw new Error(said || e.message)
  }
}

/** A window with just enough for the stand-in to load: nothing it sets up
 *  runs until a call is made. */
function standInWindow() {
  const store = () => {
    const items = new Map()
    return {
      getItem: (key) => (items.has(key) ? items.get(key) : null),
      setItem: (key, value) => void items.set(key, String(value)),
      removeItem: (key) => void items.delete(key),
      clear: () => items.clear(),
    }
  }
  const noop = () => {}
  const window = {
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    location: { href: "http://localhost/", search: "", hash: "", pathname: "/" },
    localStorage: store(),
    sessionStorage: store(),
    performance: { now: () => performance.now() },
    navigator: { userAgent: "node", platform: "node" },
    document: {
      addEventListener: noop,
      removeEventListener: noop,
      querySelector: () => null,
      createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
      documentElement: { style: {}, dataset: {} },
      body: { appendChild: noop },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type
        this.detail = init?.detail
      }
    },
    Event: class Event {
      constructor(type) {
        this.type = type
      }
    },
    console,
  }
  window.window = window
  return window
}

/** The calls the stand-in answers. */
export function fakeNames(source) {
  const window = standInWindow()
  try {
    vm.runInNewContext(source, window, { filename: FAKE })
    const api = window.__MAKE_API__()
    return Object.keys(api).filter((name) => typeof api[name] === "function")
  } catch (e) {
    throw new Error(`${FAKE} would not load: ${e.message}`)
  }
}

/** One line for each call missing on a side, in the order of the list. */
export function compare({ listed, python, fake }) {
  const inPython = new Set(python)
  const inFake = new Set(fake)
  const inList = new Set(listed)
  return [
    ...listed.filter((name) => !inPython.has(name)).map((name) => `${name} is in ${LIST} but not in Python's Api (${PYTHON})`),
    ...listed.filter((name) => !inFake.has(name)).map((name) => `${name} is in ${LIST} but not in ${FAKE}`),
    ...fake.filter((name) => !inList.has(name)).map((name) => `${name} is in ${FAKE} but not in ${LIST}`),
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url))
  const listed = pyApiNames(readFileSync(repo(LIST), "utf8"))
  const problems = compare({
    listed,
    python: pythonApiNames(repo(PYTHON)),
    fake: fakeNames(readFileSync(repo(FAKE), "utf8")),
  })
  const mark = process.env.GITHUB_ACTIONS ? "::error::" : ""
  for (const problem of problems) console.log(mark + problem)
  if (problems.length) process.exitCode = 1
  else console.log(`The interface's ${listed.length} calls are in Python and in the stand-in.`)
}
