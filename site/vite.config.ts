/// <reference types="vitest/config" />
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build, defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { changelogHead, displayVersion, latestVersion } from "./src/content/changelog.ts"
import { parseDoc } from "./src/content/markdown.ts"
import {
  fillPage,
  jsonLdText,
  notFoundNoscriptHtml,
  noscriptHtml,
  pageHeadHtml,
  robotsTxt,
  sitemapXml,
  softwareJsonLd,
  type PageMeta,
} from "./src/content/seo.ts"
import { blockOf, readStories } from "./src/content/stories.ts"

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
 * `virtual:stories-block`: what the block on the main page shows of Alex's
 * stories, its words and the first two chats of its story. The stories'
 * whole text would be most of the main page's words.
 */
function storiesBlock(): Plugin {
  const id = "\0virtual:stories-block"
  const dir = fileURLToPath(new URL("./content/stories/", import.meta.url))
  const index = fileURLToPath(new URL("./content/stories.md", import.meta.url))
  return {
    name: "site-stories-block",
    resolveId: (source) => (source === "virtual:stories-block" ? id : null),
    load(source) {
      if (source !== id) return null
      const names = readdirSync(dir).filter((name) => name.endsWith(".md"))
      for (const file of [index, ...names.map((name) => join(dir, name))]) this.addWatchFile(file)
      const files = Object.fromEntries(names.map((name) => [name, readFileSync(join(dir, name), "utf-8")]))
      return `export default ${JSON.stringify(blockOf(readStories(files, readFileSync(index, "utf-8"))))}`
    },
  }
}

/**
 * What the page says to readers that run no script, written into the HTML:
 * the app as JSON-LD and a <noscript> text with the downloads, in index.html;
 * the 404 page's words and a link back in 404.html; robots.txt beside them.
 * The version is the one the page shows (see changelog() above and
 * src/content/index.ts).
 */
function seo(): Plugin {
  const changes = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url))
  const heroFile = fileURLToPath(new URL("./content/hero.md", import.meta.url))
  const notFoundFile = fileURLToPath(new URL("./content/notfound.md", import.meta.url))
  let ssr = false
  return {
    name: "site-seo",
    configResolved(config) {
      ssr = !!config.build.ssr
    },
    transformIndexHtml(_html, ctx) {
      if (ctx.path === "/404.html") {
        const notFound = parseDoc(readFileSync(notFoundFile, "utf-8"))
        const words = { title: notFound.title ?? "", lede: notFound.intro }
        return [{ tag: "noscript", children: notFoundNoscriptHtml(words), injectTo: "body-prepend" }]
      }
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
      if (ssr) return
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt() })
    },
  }
}

/**
 * Alex's stories, each a page written whole at build time, words and all,
 * so a crawler that runs no script reads every one: stories.html, the page
 * of stories, and stories/<name>.html for each story, both from the
 * stories.html built here, with its head and words put in. sitemap.xml
 * lists them after the main page.
 *
 * The pages are drawn by the site's own components (src/stories/render.tsx).
 * Vite cannot run those in Node as they are, since the interface's React is
 * CommonJS and reached through an alias, so they are bundled for Node first,
 * React and all, and the bundle is run here.
 */
function stories(): Plugin {
  const render = fileURLToPath(new URL("./src/stories/render.tsx", import.meta.url))
  let pages: { meta: PageMeta; body: string }[] = []
  let ssr = false
  return {
    name: "site-stories",
    apply: "build",
    configResolved(config) {
      ssr = !!config.build.ssr
    },
    async buildStart() {
      // The bundle below is a build with this config too.
      if (ssr) return
      const out = mkdtempSync(join(tmpdir(), "reha-stories-"))
      try {
        await build({
          configFile: fileURLToPath(import.meta.url),
          logLevel: "warn",
          ssr: { noExternal: true },
          build: { ssr: render, outDir: out, emptyOutDir: true, copyPublicDir: false },
        })
        pages = (await import(pathToFileURL(join(out, "render.js")).href)).storyPages()
      } finally {
        rmSync(out, { recursive: true, force: true })
      }
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        if (ssr) return
        const template = bundle["stories.html"]
        if (template?.type !== "asset") throw new Error("stories.html is not in the build")
        const html = String(template.source)
        for (const { meta, body } of pages) {
          const page = fillPage(html, pageHeadHtml(meta), body)
          if (meta.path === "/stories") template.source = page
          else this.emitFile({ type: "asset", fileName: `${meta.path.slice(1)}.html`, source: page })
        }
        const paths = ["/", ...pages.map((p) => p.meta.path)]
        this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml(paths) })
      },
    },
  }
}

// The website: a page (index.html) and the app in a frame (stage.html), both
// drawn by the interface's own components. They are imported from ../ui/src
// with the interface's `@/`, and run on the interface's own React, so there
// is one copy of it, and draw its own icons; the site's package.json lists
// neither. og.html is the link picture's page, which scripts/og.mjs
// photographs into og.png, and 404.html what Vercel answers for an address
// that is no file (see vercel-config.json). stories.html is the page of
// Alex's stories and the frame of each story's page (see stories() above).
export default defineConfig({
  base: "/",
  // The app's icons: the favicon, and the logo its screens show.
  publicDir: ui("public"),
  plugins: [react(), tailwindcss(), changelog(), storiesBlock(), seo(), stories()],
  resolve: {
    alias: {
      "@": ui("src"),
      react: ui("node_modules/react"),
      "react-dom": ui("node_modules/react-dom"),
      "lucide-react": ui("node_modules/lucide-react"),
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
        notfound: fileURLToPath(new URL("./404.html", import.meta.url)),
        stories: fileURLToPath(new URL("./stories.html", import.meta.url)),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
})
