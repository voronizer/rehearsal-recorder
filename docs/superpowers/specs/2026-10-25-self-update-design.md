# Updating with Update and Restart now

Today **Download** in Settings › Under the hood puts the new version's zip in
Downloads and opens the folder. The musician then unpacks it, closes the app
and opens the new copy by hand (`src/rehearsal_recorder/updates.py:17-20`).

This makes the app put the new version in place itself. **Update** downloads
the new version, unpacks it beside this copy and checks that it starts.
**Restart now** closes the app, swaps the new copy in and opens it. The old
copy waits beside it until the new one has opened, then goes to the Trash.

Issue #6 left this step until the builds are signed, because a downloaded
copy would arrive with the "from the internet" mark that #4 is about. That
mark is put on by the program that downloads the file, such as a browser,
and the app's own download does not carry it: on Windows Alex checked this on
0.8.0 (#6, second comment), and on macOS only apps with
`LSFileQuarantineEnabled` in their Info.plist quarantine what they write,
which ours does not have (`packaging/rehearsal-recorder.spec:158-177`;
[Eclectic Light](https://eclecticlight.co/2025/12/08/who-decides-to-quarantine-files/),
[Eric Lawrence on the mark of the web](https://textslashplain.com/2016/04/04/downloads-and-the-mark-of-the-web)).
So signing is not needed for this. The first download of the app still
arrives marked, and #4 stays open.

Every piece on screen is drawn with the design system's components and tokens
(`/mnt/project-files/design-system/rulings.md`).

## Decisions

Alex decided these on 25 Oct 2026, one question at a time, on mockups built
from the app. The sources are in `/mnt/project-files/self-update/q1` to `q5`,
and every answer is in `/mnt/project-files/self-update/rulings.md`.

- **U1. By the button** (09:24Z, «По кнопке»): nothing is downloaded or
  installed without a press. The rules of #6 stay: nothing at launch, nothing
  during a take, no dialog.
- **U2. Two buttons** (Q1, «A», mockup
  https://claude.ai/artifact/BffBSxb4Qz84YHJyx7DLzz): **Update** downloads
  and gets the new copy ready, then **Restart now** puts it in place. Until
  Restart now is pressed the old copy runs, and closing and opening the app
  opens the old copy again, with the ready one still waiting.
- **U3. A notice after the restart** (Q2, «B», mockup
  https://claude.ai/artifact/LXVLUZX9h6vQLiyzYeV89z): the new copy opens on
  the start screen, as on any launch, with "Updated to 0.15.0" in the corner.
- **U4. When the copy cannot replace itself, say how to fix it** (Q3, «B»,
  mockup https://claude.ai/artifact/9xcGdLBDnBB85kUqGha7Hj): instead of
  Update, a line says where to move the app so that Update appears, and
  **Download** stays as the fallback.
- **U5. The old copy goes to the Trash later** (Q4, «A»): it stays beside
  the new one until the new one has opened, then it goes to the Trash (the
  Recycle Bin on Windows).
- **U6. On a Mac, macOS asks for the microphone at once** (Q5, «C», mockup
  https://claude.ai/artifact/VDBEyC35gN9tpqmhKXFRik): right after the
  restart, the new copy opens the audio input for a moment, so macOS asks
  then and not at the first take with the band waiting.
- **U7. On reha.stream, only an edit** (Q6, «C»): no new block. The FAQ's
  answer about the internet says that a new version is downloaded only on
  Update.

Calls Claude made on its own are marked *(new)* where they appear, and listed
together in [Claude's calls](#claudes-calls).

## Words

- **This copy**: the app that is running. **The new copy**: the new version,
  unpacked beside it. **The old copy**: this copy after the swap, until it
  goes to the Trash.
- **Getting it ready**: downloading, checking the zip, unpacking it and
  running the new copy's self-test.
- **Putting it in place**: the swap after Restart now.
- **The app's place**: on a Mac the `.app` bundle the app runs from
  (`sys.executable` is `<place>/Contents/MacOS/Reha`); on Windows the folder
  `Reha.exe` is in. Its name is kept as it is, whatever the person called it.

## Part 1. Can this copy replace itself?

The app asks this each time it checks for a new version, and once more when
Update is pressed. It is asked only of the built app on macOS and Windows: run
from source the app does not check at all (`api.py:1363`), and on Linux there
is no build.

The answer is a test: create a small file in the folder that holds the app's
place, then delete it *(new)*. If that fails, the copy cannot replace itself.
This covers both cases Alex was shown:

- on a Mac, an app opened straight from where it was unpacked can run from a
  hidden read-only copy (App Translocation); moving it in Finder ends that
  ([Apple DTS, App Translocation Notes](https://developer.apple.com/forums/thread/724969));
- a folder the person may not write to, such as Program Files.

Apple says there is no supported way to tell that an app is translocated or
to find where it really is ([Apple DTS](https://developer.apple.com/forums/thread/728725)),
so the app asks no private API and only tries to write.

## Part 2. Update: getting the new copy ready

1. **Where**: a hidden folder beside the app's place, `.reha-update` on a
   Mac and `Reha-update` with the hidden attribute on Windows *(new)*. The
   zip is downloaded there, not to Downloads, and deleted once unpacked.
2. **Download and check** as today: a `.part` file, renamed only when its
   size and SHA-256 match the release and every file in it passes its CRC
   (`updates.py` `verify`). The address is still built from the tag and the
   zip's exact name (`ASSETS`); the names never change.
3. **Unpack**: on a Mac with `ditto -x -k`, which keeps the bundle's
   symlinks and the executable bit that Python's `zipfile` loses; on Windows
   with `zipfile` *(new)*. The Mac zip holds `Reha.app`, the Windows zip the
   folder `Reha` (`release.yml:82-87`, `126-130`).
4. **Marks**: the unpacked files are expected to carry no "from the internet"
   mark. If they do, the app clears it from what it unpacked, as Unblock
   would on Windows (`Zone.Identifier`) and `xattr -d com.apple.quarantine`
   on a Mac. It does this only after the SHA-256 has matched *(new)*.
5. **Self-test**: the new copy is run with `--selftest`, the check the build
   runs on each system (`app.py:94`), with a 2 minute limit *(new)*. It opens
   no window, no input, and no database but a temporary one. Only exit code
   0 counts as passed.
6. **Ready**: the folder keeps a note of the version that is ready.

While it downloads, the line shows the progress as today. While it unpacks
and runs the self-test, a spinner and "Getting 0.15.0 ready…".

If any step fails, everything in the hidden folder is removed, this copy is
not touched, and the line says what went wrong, with **Try again** (Part 6).

Update is refused while a take records, as Download is now. A take started
while it downloads is not interrupted, and the self-test waits until the
take stops *(new)*: it runs a second copy of the app's Python and libraries,
which a take does not need beside it.

## Part 3. Restart now: putting it in place

Restart now is the same as closing the window *(new)*: the app shuts down as
it does now (`api.shutdown`). Settings cannot be opened while a take records,
so no take is running then.

Just before it closes, the app starts a small script that outlives it
*(new)*. Windows does not let a running program's files be moved, so the swap
has to happen after the app has quit. The script:

1. waits for the app to exit, at most 60 seconds;
2. renames the app's place to "Reha 0.14.0" (Windows: the folder; Mac:
   `Reha 0.14.0.app`), in the same folder;
3. moves the new copy from the hidden folder to the app's place, under its
   old name;
4. opens it (Mac: `open`; Windows: `start`).

If step 2 or 3 fails, it retries for 10 seconds (on Windows an antivirus or
the search indexer can hold a file for a moment). If it still fails, it puts
the old copy back where it was and opens it, and writes down why *(new)*.

The script is a shell script on a Mac and a `.cmd` on Windows, kept in ASCII.
The paths reach it through environment variables, so a user name in Cyrillic
works *(new)*: the self-test once stopped at its first line on such a path
because of the Windows code page (`app.py:112-119`).

What happened is written to `~/.rehearsal-recorder/update.json`: from and to
which version, where the old copy is, and whether the swap worked.

## Part 4. The new copy's first start

Once the window has loaded (where `start_update_checks` runs), the new copy
reads `update.json`:

- **It worked**: the notice "Updated to 0.15.0" in the corner (U3), the kind
  that says something is done and goes after 4 seconds. The old copy goes to
  the Trash with `move_to_trash` (U5). If that fails, it stays and the next
  start tries again *(new)*.
- **On a Mac**, the app then opens the input for half a second and closes it
  (U6): the interface chosen in Settings › Audio, or the system's default
  input if none is chosen *(new)*. A build without Apple's paid signature is
  a new app to macOS every version, so macOS asks again
  ([Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)).
- **It failed** and the old copy was opened again: a warning notice "Could
  not put 0.15.0 in place", which stays until closed, and the Updates line
  says why with **Try again**, which does what Restart now does. The ready
  copy is kept.

Then `update.json` is removed.

## Part 5. A ready copy left waiting

- Closing the app without Restart now keeps the ready copy. At the next
  start the line says "0.15.0 is ready" again (U2).
- When a newer release comes out, the ready copy is removed, and the line
  offers the newer one.
- When this copy is as new as the ready one or newer (someone updated by
  hand), the ready copy is removed.

## Part 6. Under the hood

The Updates group as in the mockups, top to bottom by state:

| State | Line | Buttons |
|-------|------|---------|
| A new version is out | **Version 0.15.0 is out** · You have 0.14.0 | **Update** (accent), **What's new** |
| Cannot replace itself (U4) | the same, and under it: "This copy can't replace itself where it is. Move the app to Applications in Finder, open it from there, and the Update button appears." On Windows: "…Move the app's folder to Documents in Explorer…" | **Download** (outline), **What's new** |
| Downloading | **Downloading 0.15.0…**, the bar, the per cent | none |
| Getting it ready | spinner, **Getting 0.15.0 ready…** · Unpacking it beside this copy and checking that it starts | none |
| Ready | **0.15.0 is ready** · The app closes and opens again as 0.15.0, in a few seconds. | **Restart now** (accent), **What's new** |
| Getting it ready failed | **Could not get 0.15.0 ready** · what went wrong | **Try again**, **What's new** |
| Putting it in place failed | **Could not put 0.15.0 in place** · what went wrong | **Try again**, **What's new** |
| Nothing newer | This is the latest version. | none |

Download in the second row does exactly what it does today: the zip in
Downloads, the folder opened, the person unpacks it.

The words under **Check for new versions** change from "…downloads a new
version only when you press Download." to "…downloads a new version only when
you ask." *(new)*, since the button is now Update or Download.

The dots on the gear and on Under the hood stay as they are: until the new
version runs.

## Part 7. What does not change

- How and when the app asks GitHub: at start and once a day, nothing during a
  take, nothing when switched off.
- The zips' names, which every copy out there looks for (`ASSETS`).
- Run from source, nothing is checked or offered. Alex keeps using git pull.
- The recordings, the history and the settings are not in the app's place
  (`~/RehearsalRecordings`, `~/.rehearsal-recorder`), so the swap never
  touches them.

## Testing

While developing, only the tests a change touches run, once each. The full
suites run once, on CI.

- **Python** (`tests/run_all.py`, which CI runs on macOS and Windows too):
  the write test on a writable and a read-only folder; getting a copy ready
  from a small zip made in the test, with a symlink and an executable bit on
  a Mac; the self-test runner against a stand-in that exits 0, exits 1 or
  hangs; the script on a stand-in app folder, run for real on each system:
  a clean swap, a swap with a file held open on Windows (it puts the old
  copy back), and a Cyrillic folder name; reading `update.json` at the first
  start, with the notice, the Trash and the microphone stubbed.
- **Interface** (Playwright on the fake bridge): every row of the table in
  Part 6, the Mac and Windows words of U4, Restart now calling Python, and the
  notice after an update. The fake bridge learns the new states.
- **By hand, on a real Mac and Windows machine**, before the release: see
  [Not yet confirmed](#not-yet-confirmed).

To make that hand check possible before two real releases exist, the built
app reads `REHA_UPDATE_TAG` *(new)*: set to a tag of this repository, the app
treats that release, even a pre-release, as the newest one. Alex publishes
two pre-releases, opens the first with the variable set to the second, and
updates. Without the variable nothing changes.

## Docs

- `README.md`, "Get it": the paragraph on new versions says Update and
  Restart now.
- `docs/using-it.md`, "A new version": rewritten for Update, Restart now, the
  notice, the microphone on a Mac, and what to do when the line says the copy
  cannot replace itself.
- `docs/design-notes.md`, "Asking whether a newer version is out": the bullet
  "It fetches, and hands over; it does not replace" becomes how it replaces.
- `updates.py`'s docstring, the same.
- `CHANGELOG.md`, Unreleased: an item starting in bold, which the site's news
  line reads.
- Issue #6: a comment that step 3 is in, and why signing turned out not to be
  needed for it.

## On reha.stream

Only the FAQ's "Does it need the internet?" changes (U7):

> No. It records, plays and keeps its history with no internet in the room.
> It asks GitHub which version is the latest when it starts and once a day,
> and sends nothing else. It downloads a new version only when you press
> Update. Settings › Under the hood switches the asking off.

Alex sees it on the site before the merge.

## Claude's calls

Made without asking, to be confirmed with this spec:

1. The write test decides whether the copy can replace itself; no private
   Apple API (Part 1).
2. The new copy is downloaded and unpacked in a hidden folder beside the
   app, not in Downloads (Part 2.1).
3. `ditto` on a Mac, `zipfile` on Windows (Part 2.3).
4. A "from the internet" mark on the unpacked files, if one is ever there,
   is cleared after the SHA-256 matches (Part 2.4).
5. The new copy's `--selftest` must pass, within 2 minutes, before Restart
   now appears (Part 2.5).
6. The self-test waits for a take to stop (Part 2).
7. Restart now is the same as closing the window (Part 3).
8. The swap is a script that runs after the app has quit, in ASCII with the
   paths in environment variables; it puts the old copy back if the swap
   fails (Part 3).
9. The old copy is named "Reha 0.14.0" while it waits; if the Trash refuses
   it, the next start tries again (Parts 3, 4).
10. The microphone is opened for half a second: the interface from Settings,
    or the default input (Part 4).
11. A warning notice and Try again when the swap failed (Part 4).
12. A ready copy is removed when a newer release comes out or this copy is
    as new (Part 5).
13. The words under Check for new versions: "only when you ask" (Part 6).
14. `REHA_UPDATE_TAG` for testing with pre-releases (Testing).

## Not part of this

- Signing the builds (#4). The first download still needs Unblock on Windows
  and Open Anyway on a Mac.
- Downloading on its own in the background, or installing at quit (U1, U2).
- A button to go back to the old version. Once a new version has changed the
  history's format, the old one refuses to open it (`store/db.py:28-31`), so
  going back would need the history's backup as well.
- Smaller downloads with only the changed files.
- Linux.

## Not yet confirmed

- That the zip the app downloads on a Mac arrives without quarantine. The
  rules say so; nobody has looked with `xattr` yet. If it does arrive
  quarantined, Part 2.4 clears it.
- That macOS asks for the microphone again after the swap (TN3127 says it
  will), and that opening the input for half a second is enough to bring the
  question up.
- macOS may also ask again about Bluetooth the first time the controller
  connects. This spec does nothing about it.
- How long Windows Defender holds a freshly unpacked `Reha.exe` on a slow
  machine: the 2 minute limit and the 10 second retry are guesses until the
  hand check.
