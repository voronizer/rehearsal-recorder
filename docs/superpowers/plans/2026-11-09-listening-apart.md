# Listening apart from recording: the plan

Spec: `docs/superpowers/specs/2026-11-09-listening-apart-design.md`.
Branch `claude/project-thread-s5m8ip`, from main 13796b8. Alex asked to
build and merge without waiting on this plan (9 Nov 00:16).

Three tasks. Tasks 1 and 2 run side by side, each in a worktree of its own,
and meet on the interface below. Task 3 follows them. While a task is
built, run only the tests it touches, once each; the full suites run once,
on CI.

## The interface between Python and the screen

- `Api.release_take()` → `{"ok": True}`: ends the hold now, whatever is
  held, and wakes the sending modules. Safe to call with nothing held.
- `session_state()` gains `"held_take": <take_number> | None`: the take of
  the session in progress saved by the last Stop, while it is held.
- The transport's `stop_keep` (and `record_stop` while recording, and
  `stop_review`, now the same as `stop_keep`) answers as now: `{"ok": True,
  "take": <the saved take, as session_state lists takes>, ...,
  "transport": ...}`; on failure `{"ok": False, "error", "transport":
  {"state": "error", "pending_take": ...}}` as now.
- `delete_take` of the held take answers as now, and the take's number is
  given back (Numbers in the spec).

## Task 1: Python

Files: `src/rehearsal_recorder/api.py`, `transport.py`,
`sending/band_service.py`, `sending/cloud_folder.py`,
`store/library.py`, tests under `tests/`.

1. The hold, in `Api`: `_hold` = `(rehearsal folder, take_number, deadline)`
   with `deadline = time.monotonic() + HOLD_SEC` (`HOLD_SEC = 600`), set by
   `Transport._stop_keep` after a save that worked; `_held()` answers
   `(folder, take_number)` while the deadline is ahead, else clears it and
   answers None. Paths compared as `Path(...)` the way the modules already
   compare folders. `release_take()` clears it and wakes both modules.
   `session_state()` adds `held_take` (only for the session in progress).
2. Ends of the hold in Python: `Transport._start` (before it reads the next
   take, so a number given back is the one the next take gets),
   `_stop_rehearsal` and `finish_rehearsal`, `delete_take`/`delete_takes`
   of the held take, a rehearsal deleted or renamed under it.
3. Sending: `BandService.run_next` passes over the row of the held take
   (`row["folder"]`, `row["take_number"]`) and goes on to the next due
   row; `CloudFolder.run_next` (the queue's `run_next`) takes the first job
   that is not the held take and leaves the held one queued. A deadline
   passing needs nothing more than the next pass (each loop wakes every
   0.5-1 s).
4. Unticking the box on a held take: band service `remove` already stops a
   waiting take (`band_service.py:301`). The cloud folder's `remove`
   refuses a take still queued (`cloud_folder.py:638`); for the held take,
   which has not started, it drops the job instead and answers ok.
5. `stop_review` in `Transport.execute` does what `stop_keep` does. Remove
   the pending-take-for-Review path it had; `retry_save` stays for a
   failed save.
6. Numbers: a library method that gives a take's go back when its song's
   `last_go` (or `Counter.last_unnamed_go` for no song) still equals it,
   called by `delete_take` for the held take after the take is held for
   Undo. Undo (`undo_trash`, kind "take"): before anything moves, refuse
   with the existing "its number is taken" kind of answer when another take
   of the song now has that go; when it comes back, the count moves on to
   at least its go (`_song_row` does `max`).
7. `window_closing`/`sending_left` count a held take as left (it is queued;
   check it is counted, add a test).
8. Tests (pytest, only these files): the hold set by stop_keep and
   stop_review; not sent while held (band service and cloud); sent after
   release, after `_start`, after the deadline (monkeypatch the clock), after
   finish; number given back on delete of the held take and not of another;
   Undo with the number free and taken; cloud remove of the held take;
   `test_control_api.py` for `stop_review`.

## Task 2: the screen

Files: `ui/src/App.tsx`, `ui/src/screens/Recording.tsx`,
`ui/src/screens/Rehearsal.tsx`, `ui/src/components/TakePlayer.tsx`,
`ui/src/hooks/useTakeStripPlayer.ts`, `ui/src/lib/api.ts`,
`ui/e2e/fake-bridge.js`, `ui/e2e/app.ts`, the e2e specs; delete
`ui/src/screens/Review.tsx` and what only it uses.

The look is the mockup's variant 3: `/mnt/project-files/release-0.25/keys-mock/ui.patch`
(read its `MK === "mode"` branches as the design; drop `MK`, the other
variants and the mockup's `__MK_OPEN__`/`__serviceUp` hacks).

1. `Recording`: Stop sends `stop_keep`; `onStopped(take: Take)` gets the
   saved take; `onSaveFailed(error)` on a failure.
2. `App`: no `"review"` screen. Recording's `onStopped` refreshes the
   session and shows `{ name: "rehearsal", open: take.take_number }`;
   `onSaveFailed` says the error and opens Unsaved takes (`list_drafts`),
   as the controller's failure does. The controller watcher stores the
   recording take's number (`state.take_number`) when it shows the
   recording screen and opens it on the way back to the rehearsal screen.
   A `pending_take` that used to open Review opens Unsaved takes. The
   discard offer goes.
3. `Rehearsal`: prop `openTake?: number | null`: once that take is in
   `session.takes`, select it (paused at 0:00), once.
   - Footer by the spec's table (D1, D4): a take open → **Close take** (X,
     Esc chip) and **Play**/**Pause** (Space chip), widths fixed so nothing
     jumps; a take playing in the overview, not open → **Stop** and
     **Pause**; otherwise **Finish** and **Record**, chips always shown
     when keys are on. Footer left: with a take open the send box (D5) in
     the metronome row's room (the row stays, invisible, so the height
     holds); otherwise the metronome row.
   - Esc closes and stops (D2): `select(null)` then `uncue()`.
   - Right panel (D3): with a take open, a **Marks** panel in the aside's
     place: one row per mark in time order (`MarkLine`), click seeks, pencil
     and cross on hover; `TakePlayer` gets a prop that leaves out its mark
     chips under the lanes.
   - The open take's queued state is left out of the strip's status (D6);
     errors stay.
   - The hold: when a take that was open as `session.held_take` stops being
     the open one (closed, another opened, the screen left), call
     `api().release_take()` once; also after the Record button's start
     (Python ends it anyway).
4. The send box: ticked = `isIn(take, sendTo)` or queued. Tick →
   `share_take(folder, n, "mix")` (band service) / the cloud folder's send
   as the cloud button does; untick → `unshare_take`. Refresh after.
5. Fake bridge: `stop_review` = `stop_keep`; `held_take` in session_state,
   set by stop/stop_keep, cleared by `release_take`, start, finish, delete;
   `release_take`; `delete_take` of the held take gives its go back;
   `unshare_take` clears the take from the service queue.
6. Tests: `ui/e2e/app.ts` `recordTake` ends with the take open (Close take
   visible) and `settled`; replace every **Save take** with nothing (Stop
   saved it) or **Close take**, every **Discard** with the open take's
   trash; `review.spec.ts` becomes `listening.spec.ts`: Stop opens the take
   paused; Space plays, Esc closes and stops; footer buttons and chips in
   each state; marks panel; send box ticks a false start and unticks a
   good take; trash gives the number back; controller Stop opens the take;
   a failed save opens Unsaved takes. Run only the specs you changed, once
   each (`npx playwright test <files>`), and `npm run typecheck`, `npm run
   lint`, the unit tests of changed files.

## Task 3: words, site, pictures

After tasks 1 and 2 are merged into the branch.

1. `docs/using-it.md`: the screen-after-a-take section becomes "Listening
   to a take"; Keys; Unsaved takes; sending (held until closed, 10
   minutes); numbers back on the trash. `docs/control-api.md`
   (`stop_review` = `stop_keep`), `docs/controller-contribution.md`,
   `docs/design-system.md` (footer buttons).
2. `CHANGELOG.md` Unreleased: one item, starting bold.
3. Site: `site/src/stage/Story.tsx` goes from Stop to the rehearsal screen
   with the take open (no `review` step); `site/content/stories/record-rehearsal.md:42`
   says it; `site/e2e/stories.spec.ts` follows. Run that spec only.
4. Pictures: `tests/docs_screenshots.py` retakes what the guide shows of
   the old screen (review.png → the open take).
5. Whole-branch review, fixes, PR, CI, merge (Alex's word 00:16).
