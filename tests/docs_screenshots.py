"""
The pictures in the README and docs/using-it.md.

They are taken of the built interface against the faked Python side the
interface's tests use (ui/e2e/fake-bridge.js), with a band of four on an
XR18 and a song for them to play. The fake's own waveform is one sine curve,
the same on every track: enough to check that a waveform is drawn, and
nothing like what a band sounds like. Needs Playwright for Python.

    python tests/docs_screenshots.py

writes docs/screenshots/*.png. It checks nothing and is not part of
run_all.py. Run it after changing anything the pictures show, and look at
them before committing.
"""

import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT / "src"))

from rehearsal_recorder.mediaserver import AppServer  # noqa: E402

UI_DIST = PROJECT / "ui" / "dist"
# The faked Python side the interface's tests run against, which the band
# below is laid over.
MOCK = (PROJECT / "ui" / "e2e" / "fake-bridge.js").read_text(encoding="utf-8")
# The pictures show Windows, paths and all, whatever machine takes them: on a
# Mac the interface would write ⌘ for Ctrl, and zoom only with ⌘ held.
MOCK = "Object.defineProperty(Navigator.prototype, 'platform', {get: () => 'Win32'});\n" + MOCK


def drag_region(page, from_ratio, to_ratio):
    """Draw a region across the timeline, the way a person does."""
    box = page.get_by_role("group", name="Take timeline").bounding_box()
    y = box["y"] + box["height"] / 2
    page.mouse.move(box["x"] + box["width"] * from_ratio, y)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * to_ratio, y, steps=10)
    page.mouse.up()
    page.wait_for_timeout(250)

OUT = PROJECT / "docs" / "screenshots"
VIEWPORT = {"width": 1180, "height": 820}

# Runs after MOCK, in the same page: MOCK's top-level `let`s — session,
# recording, cloudDir and the rest — are shared by every script on the page,
# so they are set here directly, and the calls that decide what is on screen
# are replaced on the bridge MOCK made.
BAND = (PROJECT / "ui" / "e2e" / "band.js").read_text(encoding="utf-8")

# Settings › Marks counts every mark in the library; the fake counts the
# marks of its own history, which the band's replaces. So the counts are the
# band's: the marks on its rehearsals.
COUNTED = """
const labelsOf = api.list_labels;
api.list_labels = async () => {
  const marks = Object.keys(PAST).flatMap(f => pastTakes(f)).flatMap(t => t.markers);
  return (await labelsOf()).map(l => ({...l, marks: marks.filter(m => m.label_id === l.id).length}));
};
"""

# An unsaved take waiting at startup: set before MOCK, which reads it once.
DRAFTS = """window.__DRAFTS__ = [{dir:'/rec/tue/_drafts/take 5', name:'take 5',
  tracks:['Drums','Bass','Guitar','Vocals'], duration_sec:214,
  rehearsal_folder:'/rec/tue', rehearsal_name:'Tuesday jam',
  created_at:'2026-09-22T19:00:00'}];"""


# How tall the window is for each picture: tall enough for all four tracks
# where there is a player, and no taller than the screen needs elsewhere,
# so a picture is not half empty.
HEIGHT = {"unsaved-takes": 420, "setup": 910, "settings": 760, "marks": 420, "rehearsal": 770,
          "recording": 720, "review": 1040, "player": 1040, "zoom": 1040,
          "history": 820}


def shoot(page, name):
    OUT.mkdir(parents=True, exist_ok=True)
    page.set_viewport_size({"width": VIEWPORT["width"], "height": HEIGHT[name]})
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / f"{name}.png"))
    print(f"  {name}.png")


def zoom_to(page, ratio, seconds):
    """Wheel in over `ratio` of the timeline until at most `seconds` show."""
    box = page.get_by_role("group", name="Take timeline").bounding_box()
    page.mouse.move(box["x"] + box["width"] * ratio, box["y"] + box["height"] / 2)
    clock = page.get_by_role("group", name="Timeline clock")
    for _ in range(30):
        times = []
        for text in clock.locator("span.tnum").all_inner_texts():
            minutes, secs = text.strip().split(":")
            times.append(int(minutes) * 60 + int(secs))
        if len(times) > 1 and (times[-1] - times[0]) * len(times) / (len(times) - 1) <= seconds:
            return
        # Ctrl and the wheel zoom: the wheel on its own scrolls the page.
        page.keyboard.down("Control")
        page.mouse.wheel(0, -120)
        page.keyboard.up("Control")
        page.wait_for_timeout(250)


def main():
    if not (UI_DIST / "index.html").exists():
        print("The interface is not built: cd ui && npm run build")
        return 1
    server = AppServer(UI_DIST, Path(tempfile.mkdtemp()) / "rec")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        page = browser.new_page(viewport=VIEWPORT)
        page.add_init_script(DRAFTS + MOCK + BAND + COUNTED)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Unsaved takes found")
        shoot(page, "unsaved-takes")
        page.close()

        page = browser.new_page(viewport=VIEWPORT)
        page.add_init_script(MOCK + BAND + COUNTED)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Start rehearsal")
        page.fill("#rehearsal-name", "Tuesday jam")
        page.click("text=Check signal")
        page.wait_for_timeout(1500)
        shoot(page, "setup")
        page.click("text=Stop checking")

        page.get_by_role("button", name="Settings").click()
        page.wait_for_selector("text=Playback output")
        page.wait_for_timeout(500)
        shoot(page, "settings")
        page.get_by_role("button", name="Marks", exact=True).first.click()
        page.wait_for_selector("text=What a moment in a take can be marked with")
        page.wait_for_timeout(400)
        shoot(page, "marks")
        page.keyboard.press("Escape")
        page.wait_for_selector("text=Start rehearsal")
        # The setup screen starts again from the date when it comes back.
        page.fill("#rehearsal-name", "Tuesday jam")

        page.click("text=Start rehearsal")
        page.wait_for_selector("text=Record take 4")
        page.wait_for_timeout(500)
        shoot(page, "rehearsal")

        page.click("text=Record take 4")
        page.wait_for_selector("text=Stop")
        page.wait_for_timeout(3200)
        shoot(page, "recording")

        page.click("text=Stop")
        page.wait_for_selector("#take-name")
        page.wait_for_timeout(1200)
        shoot(page, "review")
        page.get_by_role("button", name="Save take").click()
        page.wait_for_selector("text=Record take 5")

        page.click("button[aria-label^='Take 2 Pałyn 2']")
        page.wait_for_selector("[aria-label='Take timeline']")
        page.wait_for_timeout(800)
        song = page.evaluate(
            "() => ({length: window.__SONG__.length(2), bridge: window.__SONG__.bridge,"
            " bar: window.__SONG__.bar})")
        length, bridge = song["length"], song["bridge"]
        chorus = bridge + 8 * song["bar"]
        drag_region(page, bridge / length, chorus / length)
        page.get_by_role("button", name="Repeat").click()
        page.click("button[aria-label='Play']")
        page.wait_for_timeout(1500)
        shoot(page, "player")

        page.click("button[aria-label='Pause']")
        page.get_by_role("button", name="Clear").click()
        page.get_by_role("button", name="Repeat").click()
        zoom_to(page, chorus / length, 12)
        # A press that does not travel seeks: into the window, so what has
        # been played is drawn as played.
        box = page.get_by_role("group", name="Take timeline").bounding_box()
        page.mouse.click(box["x"] + box["width"] * 0.66, box["y"] + box["height"] / 2)
        page.wait_for_timeout(600)
        shoot(page, "zoom")
        page.close()

        page = browser.new_page(viewport=VIEWPORT)
        page.add_init_script(MOCK + BAND + COUNTED)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Start rehearsal")
        page.click("text=History")
        page.wait_for_selector("text=New songs")
        page.wait_for_timeout(400)
        shoot(page, "history")
        page.close()

        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
