# Notices: what happened goes in the corner, how things are stays in place

A message that appears in the middle of a form moves the form. Settings
shows "Folder saved" and "Found “X18/XR18”" above the section they are
about, so the whole panel drops a line and, when the message times out a few
seconds later, jumps back up.

## What the app has

Five kinds of message, each placed by the screen that raises it:

| Kind | Where it is shown |
|---|---|
| A call into Python raised | `ErrorBar`, fixed across the top, until dismissed |
| An action failed | a red line: above the main button in the footer on Setup, Rehearsal, Recording and Review; at the top of the panel in Settings (`Settings.tsx:315-321`); in the content on History (`HistoryScreen.tsx:279, 373`) and Drafts (`DraftsScreen.tsx:82`) |
| An action succeeded | Settings only, `status`, cleared after 2.5–4 s (`Settings.tsx:148-246`); Setup says "Template saved" on the button itself |
| It worked, differently | the player's amber box when playback fell back to the system output (`TakePlayer.tsx:111`); after a rescan, shown red as an error (`Settings.tsx:150`); the partial crop ("cropped, but the original could not be moved out of the way"), shown red in the error slot on Rehearsal, Review and History; after changing the output while a take is open, not shown at all — `set_output_device` and `set_output_channels` return a `warning` and the screen reads only `ok` |
| A condition that holds | amber boxes in place while it holds: a track waiting for an input, an interface not connected, a card that would not name its rates, a long path on Windows |

The footer errors do not move the form: the footer grows upwards and the
content is anchored to the top. The error at the top of Settings, the ones in
History's and Drafts' content, and every success message do.

## The rule

**Something that happened is a notice. Something that is true stays where
it is.**

A notice appears in the bottom right-hand corner, over the screen, and moves
nothing. Footers centre their buttons, so on a screen with a footer the
corner is empty; Settings has none, and its panel stops short of the right
edge.

- **done** — an action succeeded. Goes after 4 s; the time stops while the
  pointer is over it.
- **warning** — it worked, but not as asked. Stays until closed.
- **error** — it did not work. Stays until closed.

Staying until closed is what the ErrorBar learned: the two failures it was
made for were silent because nothing stayed on screen long enough to be read.

A notice has a `key`. A new notice with the same key takes the place of the
old one, and a screen clears its own before starting an action, which is
what `setError(null)` does today. Each screen uses one key, so it has one
slot, as it has now: a retry that works replaces the failure it retried, and
a success replaces the previous failure. Notices outlive the screen that
raised them; a warning about playback is still true after leaving Settings.

At most three are shown. A fourth pushes out the oldest.

## What moves and what stays

Moves to notices:

- Settings: every `status` and `error` — the recordings and cloud folders,
  the recording format, the playback output and its channels, the cloud
  format and automatic sending, looking for interfaces. The rescan's warning
  is a warning, not an error.
- Settings: the `warning` from changing the output or its channels while a
  take is open, which is shown for the first time.
- History and Drafts: every `error`.
- Rehearsal, Review and History: the partial crop, as a warning. The crop
  went through; red in the error slot says otherwise.

Stays where it is:

- Errors above the main button in a footer — Setup, Rehearsal, Recording,
  Review. The eye is on the button that was pressed, and the form does not
  move.
- Errors inside a dialog (`ShareDialog`). A modal dialog makes the rest of
  the window inert, the corner included.
- "Template saved" on Setup's button. It confirms on the control itself and
  moves nothing.
- Every condition that holds, the player's playback-fallback box among them:
  it is true for as long as the take is open.
- The ErrorBar. It is the channel for a bug — the exception, and where the
  log is — and it says so in a way a notice should not.

## The parts

`lib/notices.ts` holds the notices, in the shape of `bridgeErrors.ts`:
`notify({key, kind, text})`, `dismiss(key)` and `useNotices()`.

`components/Notices.tsx` shows them, mounted once in `main.tsx` beside the
ErrorBar. It is plain markup, not Radix Toast. Each Radix toast is a
`DismissableLayer`, and the topmost layer listens for Escape on the whole
document (`react-dismissable-layer`, `index.mjs:100-107`); a toast closes on
an Escape pressed anywhere, not only on itself, and does not stop the key
(`react-toast`, `index.mjs:385-392`). In this app Escape leaves the screen —
`useEscape` decides on the capture phase and acts on the bubble — so one press
would close the notice and leave Settings with it. A toast raised while a
dialog is open would also become the topmost layer, and the dialog would
stop answering Escape. The Escape ladder in `useSpacebar.ts` has needed
three fixes for exactly this kind of interplay between Radix layers and the
screen's own Escape (`d4fcf54`, `16312f3`, `d816ec2`), and a notice has no
reason to take part in it.

So a notice is closed by its button, and by nothing else. Escape keeps its
meaning on every screen whether a notice is showing or not.

The list sits inside an `aria-live="polite"` region that is always in the
page, so a notice added to it is read out; an error carries `role="alert"`.

## Tests

`test_interface.py`:

- The recording interface's picker is at the same height before "Look
  again", while its notice shows, and after it has gone. The recordings
  folder's field likewise around "Folder saved".
- A done notice goes by itself; an error one is still there after it.
- A failed action that is retried and works leaves only its success.
- The warning from changing the output while a take is open reaches the
  screen.
- With a notice showing, Escape still leaves Settings, in one press, and the
  notice stays.
- History: a failed action shows its error as a notice, `role="alert"`.
- The partial crop reads as a warning, not an error.

The texts of the messages do not change, so the checks that look for them
keep working wherever the text now appears.
