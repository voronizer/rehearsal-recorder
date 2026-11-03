/// <reference types="vitest/config" />
import { defineConfig } from "vite"
import { configDefaults } from "vitest/config"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  // Relative asset paths, so the built dist can be served from any root
  // (mediaserver.py serves it from the local server).
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },

  // `npm test`: the files beside the code that need no browser, and the
  // design check's own (scripts/). The ones that need a browser are e2e/,
  // under Playwright. The seam check's own tests call Python, which the
  // interface's machines do not have: they run in .github/workflows/bridge.yml.
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    exclude: [...configDefaults.exclude, "scripts/bridge-check.test.mjs"],
  },

  // Development only (`npm run dev`, with `python3 -m rehearsal_recorder --dev`
  // alongside).
  //
  // The interface is served by Vite here, so it gets hot reload, but the
  // audio still lives in Python. These two paths are forwarded there:
  // /api for the calls the meters poll many times a second, /media for the
  // .wav files the player reads. Without the forwarding the window would
  // load but every level meter would sit at zero.
  //
  // The port is fixed to match DEV_SERVER_PORT in
  // src/rehearsal_recorder/app.py — a config file cannot be told a port
  // that is picked at random.
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:17817",
      "/media": "http://127.0.0.1:17817",
    },
  },
})
