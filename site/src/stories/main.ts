// The script of a story's page and of the page of stories. The pages are
// written whole at build time (render.tsx); here only the visit is
// counted, as on the main page, and the visitor's system comes first in the
// downloads.
import "../page/page.css"
import { countVisits } from "../page/analytics"
import { isWindows } from "../page/os"

countVisits()

if (isWindows(navigator.platform, navigator.userAgent)) {
  document.querySelectorAll<HTMLElement>("[data-os]").forEach((el) => {
    el.hidden = el.dataset.os !== "windows"
  })
}
