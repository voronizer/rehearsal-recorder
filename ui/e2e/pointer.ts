import type { Page } from "@playwright/test"

/**
 * What `pointers` finds wrong on every screenful of the page, top to bottom,
 * each once and after `label`; "nothing to check" when it found nothing that
 * presses at all.
 */
export async function wrongPointers(page: Page, label: string): Promise<string[]> {
  const found = new Set<string>()
  let checked = 0
  for (let i = 0; i < 8; i++) {
    const seen = await page.evaluate(pointers)
    checked += seen.checked
    for (const w of seen.wrong) found.add(`${label}: ${w}`)
    if (!(await page.evaluate(scrollOn))) break
  }
  if (!checked) found.add(`${label}: nothing to check`)
  return [...found]
}

/** Scrolls the page's tallest scrolling box down a screenful, less a little; false at its end. */
function scrollOn(): boolean {
  const root = document.scrollingElement ?? document.documentElement
  const boxes = [root, ...document.querySelectorAll("*")].filter(
    (e) => e.clientHeight > 300 && e.scrollHeight > e.clientHeight + 4 && (e === root || /auto|scroll/.test(getComputedStyle(e).overflowY))
  )
  const box = boxes.sort((a, b) => b.clientHeight - a.clientHeight)[0]
  if (!box) return false
  const before = box.scrollTop
  box.scrollTop += box.clientHeight - 80
  return box.scrollTop !== before
}

/**
 * The pointer over each thing on screen that presses, in РЭХА and in the
 * band service: the hand (docs/design-system.md, "The pointer"). Run inside
 * the page with `page.evaluate(pointers)`; nothing outside the function may
 * be used in it.
 *
 * Checked: links, buttons that are not disabled, menu items, radios, tabs,
 * switches and check boxes, a label that presses one of those, folds, and a
 * row that lights up under the pointer and opens something (a press and a
 * hover light on one element). The pointer is read where the person would
 * put it, the centre, from the element found there.
 *
 * Three keep their own and pass: a drag handle the open hand, a player's
 * wave the cross, a loop's ends the arrows left and right. A field to type
 * in and what cannot be pressed now (greyed out, the tab already open) are
 * not checked: the text cursor and the arrow are theirs.
 *
 * `wrong` names each that shows something else, with the cursor it shows;
 * `checked` is how many were looked at.
 */
export function pointers(): { checked: number; wrong: string[] } {
  const ROLES = ["button", "link", "menuitem", "menuitemradio", "menuitemcheckbox", "tab", "radio", "switch", "checkbox", "option"]
  const PRESSES = ["a[href]", "button", "summary", ...ROLES.map((r) => `[role=${r}]`)].join(",")
  const TOGGLES = "input[type=checkbox],input[type=radio],[role=checkbox],[role=radio],[role=switch]"
  const OWN = ["grab", "crosshair", "ew-resize"]

  const clicked = (el: Element) => {
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"))
    return !!key && typeof (el as unknown as Record<string, { onClick?: unknown }>)[key]?.onClick === "function"
  }
  const lights = (el: Element) => typeof el.className === "string" && /(^|\s)hover:bg-/.test(el.className)
  const off = (el: Element) => el.matches(":disabled, [aria-disabled=true], [data-disabled]")

  const all = new Set<Element>(document.querySelectorAll(PRESSES))
  for (const label of document.querySelectorAll("label")) {
    const control = (label as HTMLLabelElement).control
    if (control?.matches(TOGGLES) && !off(control)) all.add(label)
  }
  for (const el of document.querySelectorAll("div, li, tr, span")) if (lights(el) && clicked(el)) all.add(el)

  let checked = 0
  const wrong: string[] = []
  for (const el of all) {
    if (off(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue
    const s = getComputedStyle(el)
    if (s.visibility === "hidden" || s.pointerEvents === "none") continue
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1)
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1)
    const hit = document.elementFromPoint(x, y)
    // Something else lies over its centre (a menu, the panel): that one is checked in its place.
    if (!hit || !el.contains(hit)) continue
    checked++
    const cursor = getComputedStyle(hit).cursor
    if (cursor === "pointer" || OWN.includes(cursor)) continue
    const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)
    const place = el.closest("[role=dialog],[role=menu],[role=listbox],aside,header,nav,main,footer")
    const where = place ? place.getAttribute("aria-label") || place.tagName.toLowerCase() : ""
    wrong.push(`${el.getAttribute("role") || el.tagName.toLowerCase()} "${name}"${where ? ` in ${where}` : ""}: ${cursor}`)
  }
  return { checked, wrong }
}
