// The seam check's own tests (bridge-check.mjs). They run with Node's own
// test runner in .github/workflows/bridge.yml, not under Vitest with the
// interface's: one of them calls Python, which the interface's machines
// (Playwright's image) do not have.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compare, fakeNames, pyApiNames, pythonApiNames } from "./bridge-check.mjs"

const repo = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

test("pyApiNames reads plain and generic calls", () => {
  const source = [
    "type Other = {",
    "  not_this(): void",
    "}",
    "",
    "type PyApi = {",
    "  get_x(): Promise<X>",
    "  // a note on the next one",
    "  set_y<K extends keyof Y>(",
    "    key: K,",
    "    value: Y[K]",
    "  ): Promise<Ok>",
    "}",
    "",
    "type After = {",
    "  nor_this(): void",
    "}",
  ].join("\n")
  assert.deepEqual(pyApiNames(source), ["get_x", "set_y"])
})

test("pyApiNames names the file when PyApi is missing", () => {
  assert.throws(() => pyApiNames("type Other = {\n  a(): void\n}\n"), /ui\/src\/lib\/api\.ts has no type PyApi/)
})

test("pythonApiNames skips private methods and properties", () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-check-"))
  const file = join(dir, "api.py")
  writeFileSync(
    file,
    [
      "import json",
      "",
      "def outside():",
      "    pass",
      "",
      "class Api:",
      "    def get_x(self):",
      "        def inner():",
      "            pass",
      "        return 1",
      "",
      "    async def get_y(self):",
      "        return 2",
      "",
      "    def _hidden(self):",
      "        pass",
      "",
      "    @property",
      "    def ui_url(self):",
      "        return ''",
      "",
      "    @ui_url.setter",
      "    def ui_url(self, value):",
      "        pass",
      "",
      "    @staticmethod",
      "    def made():",
      "        pass",
      "",
    ].join("\n")
  )
  assert.deepEqual(pythonApiNames(file), ["get_x", "get_y", "made"])
})

test("pythonApiNames names the file when it has no class Api", () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-check-"))
  const file = join(dir, "api.py")
  writeFileSync(file, "class Other:\n    def a(self):\n        pass\n")
  assert.throws(() => pythonApiNames(file), /api\.py has no class Api/)
})

test("fakeNames lists the stand-in's calls", () => {
  const source =
    "window.__MAKE_API__ = () => ({ a: async () => 1, b() {}, c: 3 });\n" +
    "window.pywebview = { api: window.__MAKE_API__() };\n"
  assert.deepEqual(fakeNames(source), ["a", "b"])
})

test("fakeNames says the stand-in would not load", () => {
  assert.throws(() => fakeNames('throw new Error("boom")'), {
    message: "ui/e2e/fake-bridge.js would not load: boom",
  })
})

test("compare names each side's missing call", () => {
  assert.deepEqual(compare({ listed: ["a", "b", "c"], python: ["a", "c", "extra"], fake: ["a", "b", "d"] }), [
    "b is in ui/src/lib/api.ts but not in Python's Api (src/rehearsal_recorder/api.py)",
    "c is in ui/src/lib/api.ts but not in ui/e2e/fake-bridge.js",
    "d is in ui/e2e/fake-bridge.js but not in ui/src/lib/api.ts",
  ])
})

test("the repository's three agree", () => {
  const listed = pyApiNames(readFileSync(repo("ui/src/lib/api.ts"), "utf8"))
  const python = pythonApiNames(repo("src/rehearsal_recorder/api.py"))
  const fake = fakeNames(readFileSync(repo("ui/e2e/fake-bridge.js"), "utf8"))
  assert.deepEqual(compare({ listed, python, fake }), [])
})
