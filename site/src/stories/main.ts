// The script of a story's page and of the page of stories. The pages are
// written whole at build time (render.tsx); here only Vercel's counting
// runs, as on the main page, and the visitor's system comes first in the
// downloads.
import { inject } from "@vercel/analytics"
import { injectSpeedInsights } from "@vercel/speed-insights"
import "../page/page.css"
import { onlyOnSite } from "../page/analytics"
import { isWindows } from "../page/os"

inject({ beforeSend: onlyOnSite })
injectSpeedInsights({ beforeSend: onlyOnSite })

if (isWindows(navigator.platform, navigator.userAgent)) {
  document.querySelectorAll<HTMLElement>("[data-os]").forEach((el) => {
    el.hidden = el.dataset.os !== "windows"
  })
}
