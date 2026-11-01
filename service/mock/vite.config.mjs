import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// The band service's look as a clickable prototype, drawn with the
// interface's own components the way service/src draws its pages (same
// aliases as service/vite.config.ts), on made-up data instead of the API.
const ui = (path) => fileURLToPath(new URL(`../../ui/${path}`, import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": ui("src"),
      react: ui("node_modules/react"),
      "react-dom": ui("node_modules/react-dom"),
      "lucide-react": ui("node_modules/lucide-react"),
    },
  },
  server: { fs: { allow: ["../.."] } },
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false },
})
