/// <reference types="vitest/config" />
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { changelogHead, displayVersion, latestVersion } from "./src/content/changelog.ts"
import { parseDoc } from "./src/content/markdown.ts"
import { jsonLdText, noscriptHtml, robotsTxt, sitemapXml, softwareJsonLd } from "./src/content/seo.ts"

const ui = (path: string) => fileURLToPath(new URL(`../ui/${path}`, import.meta.url))

/**
 * `virtual:changelog`: the section of CHANGELOG.md for the version the page
 * is for. The page shows one line of it, and the whole file would be most of
 * the page's weight.
 */
function changelog(): Plugin {
  const id = "\0virtual:changelog"
  const file = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url))
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

/**
 * What the page says to readers that run no script, written into the HTML:
 * the app as JSON-LD and a <noscript> text with the downloads, both in
 * index.html only; robots.txt and sitemap.xml beside it. The version is the
 * one the page shows (see changelog() above and src/content/index.ts).
 */
function seo(): Plugin {
  const changes = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url))
  const heroFile = fileURLToPath(new URL("./content/hero.md", import.meta.url))
  return {
    name: "site-seo",
    transformIndexHtml(_html, ctx) {
      if (ctx.path !== "/index.html") return
      const version = displayVersion(process.env.VITE_SITE_VERSION || latestVersion(readFileSync(changes, "utf-8")))
      const hero = parseDoc(readFileSync(heroFile, "utf-8"))
      return [
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          children: jsonLdText(softwareJsonLd(version)),
          injectTo: "head",
        },
        { tag: "noscript", children: noscriptHtml({ title: hero.title ?? "", lede: hero.intro }), injectTo: "body-prepend" },
      ]
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt() })
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml() })
    },
  }
}

// The website: a page (index.html) and the app in a frame (stage.html), both
// drawn by the interface's own components. They are imported from ../ui/src
// with the interface's `@/`, and run on the interface's own React, so there
// is one copy of it; the site's package.json does not list it. og.html is
// the link picture's page, which scripts/og.mjs photographs into og.png.
export default defineConfig({
  base: "/",
  // The app's icons: the favicon, and the logo its screens show.
  publicDir: ui("public"),
  plugins: [react(), tailwindcss(), changelog(), seo()],
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
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        stage: fileURLToPath(new URL("./stage.html", import.meta.url)),
        og: fileURLToPath(new URL("./og.html", import.meta.url)),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
})
