import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"

// The pages and the Worker, built together: `vite build` writes the pages to
// dist/client and the Worker beside them, and `vite` runs both locally.
export default defineConfig({
  plugins: [cloudflare()],
})
