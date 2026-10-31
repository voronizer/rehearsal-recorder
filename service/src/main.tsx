import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import { queryClient } from "./api"
import { router } from "./routes"
import "./service.css"

// The theme follows the system's, as it changes: the interface's dark
// colours hang off a `dark` class on <html>.
const dark = window.matchMedia("(prefers-color-scheme: dark)")
const theme = () => document.documentElement.classList.toggle("dark", dark.matches)
theme()
dark.addEventListener("change", theme)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
)
