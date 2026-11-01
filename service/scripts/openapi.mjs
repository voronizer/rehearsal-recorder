// Writes openapi.json: the description /api/openapi.json serves, kept in
// the repository for РЭХА's tests. Run it after changing a route:
//   npm run openapi
import { build } from "esbuild"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const dir = await mkdtemp(join(tmpdir(), "reha-band-openapi-"))
try {
  const out = join(dir, "app.mjs")
  await build({
    stdin: {
      contents: 'export { app } from "./worker/index.ts"; export { DOC } from "./worker/shared/openapi.ts"',
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    external: ["cloudflare:*"],
    logLevel: "error",
  })
  const { app, DOC } = await import(pathToFileURL(out).href)
  const doc = app.getOpenAPI31Document(DOC)
  await writeFile(join(root, "openapi.json"), JSON.stringify(doc, null, 2) + "\n")
  console.log(`openapi.json: ${Object.keys(doc.paths).length} paths`)
} finally {
  await rm(dir, { recursive: true, force: true })
}
