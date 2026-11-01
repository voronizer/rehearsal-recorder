import { fileURLToPath } from "node:url"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

const ui = (path: string) => fileURLToPath(new URL(`../ui/${path}`, import.meta.url))

// The pages and the Worker, built together: `vite build` writes the pages to
// dist/client and the Worker beside them, and `vite` runs both locally.
//
// The pages are drawn with the interface's own components, as the site's
// are: they are imported from ../ui/src with the interface's `@/`, and run
// on the interface's own React, so there is one copy of it, and draw its own
// icons. Vite turns the JSX into React calls by itself, as tsconfig.json's
// `jsx` says.
export default defineConfig({
  plugins: [tailwindcss(), cloudflare()],
  resolve: {
    alias: {
      "@": ui("src"),
      react: ui("node_modules/react"),
      "react-dom": ui("node_modules/react-dom"),
      "lucide-react": ui("node_modules/lucide-react"),
    },
  },
  server: {
    // The interface's components are outside service/.
    fs: { allow: [".."] },
  },
})
