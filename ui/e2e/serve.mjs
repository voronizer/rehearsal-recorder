// Serves the built interface, ui/dist, for the interface's tests — and
// nothing else. /api/... is not there, the way it is not there for a window
// whose Python side is faked: the interface's polling then goes over the
// bridge, which is where the fake answers. Vite's own preview server would
// answer /api/... with index.html instead.
//
//     node e2e/serve.mjs 4178

import { createReadStream, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const DIST = fileURLToPath(new URL("../dist/", import.meta.url))
const PORT = Number(process.argv[2] ?? 4178)

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)
  const file = normalize(join(DIST, path === "/" ? "index.html" : path))
  let found = false
  try {
    found = file.startsWith(DIST) && statSync(file).isFile()
  } catch {
    found = false
  }
  if (!found) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  })
  createReadStream(file).pipe(res)
}).listen(PORT, "127.0.0.1")
