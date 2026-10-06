/// <reference types="vitest/config" />
import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { changelogHead } from "./src/content/changelog.ts"

const ui = (path: string) => new URL(`../ui/${path}`, import.meta.url).pathname

/**
 * `virtual:changelog`: the section of CHANGELOG.md for the version the page
 * is for. The page shows one line of it, and the whole file would be most of
 * the page's weight.
 */
function changelog(): Plugin {
  const id = "\0virtual:changelog"
  const file = new URL("../CHANGELOG.md", import.meta.url).pathname
  return {
    name: "site-changelog",
    resolveId: (source) => (source === "virtual:changelog" ? id : null),
    load(source) {
      if (source !== id) return null
      this.addWatchFile(file)
      const head = changelogHead(readFileSync(file, "utf-8"), process.env.VITE_SITE_VERSION || undefined)
      return `export default ${JSON.stringify(head)}`
    },
  }
}

// The website: a page (index.html) and the app in a frame (stage.html), both
// drawn by the interface's own components. They are imported from ../ui/src
// with the interface's `@/`, and run on the interface's own React, so there
// is one copy of it; the site's package.json does not list it.
export default defineConfig({
  base: "/",
  // The app's icons: the favicon, and the logo its screens show.
  publicDir: ui("public"),
  plugins: [react(), tailwindcss(), changelog()],
  resolve: {
    alias: {
      "@": ui("src"),
      react: ui("node_modules/react"),
      "react-dom": ui("node_modules/react-dom"),
    },
  },
  server: {
    // The interface, its fake Python side and CHANGELOG.md are outside site/.
    fs: { allow: [".."] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: new URL("./index.html", import.meta.url).pathname,
        stage: new URL("./stage.html", import.meta.url).pathname,
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
})
