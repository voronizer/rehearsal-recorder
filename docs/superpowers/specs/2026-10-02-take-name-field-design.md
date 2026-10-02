# Naming a take: one field over the main button, and every footer in one row

Naming the take is what is most easily forgotten at a rehearsal (#10): at the
start of a take, when the band has moved on to another song, and again when
saving it. This design gives the name one field, in the same place before
recording and after, and lays every screen's footer out the same way so the
main button is always in one spot.

## What the app has

- **Before recording**, over Record: "Next take:", the name the take would
  have anyway, up to six songs (`SHOWN` in `ui/src/components/NextTakeName.tsx`)
  and **Other…**, a popover holding a field and every song. A click on a song
  names the take at once, through `set_next_take_name`.
- **After Stop**, at the top of the review screen's content: a "Take name"
  field (`#take-name`) with the songs under it (`ui/src/screens/Review.tsx`).
  Save take and Discard are in the footer, at the bottom.
- **Renaming a take later**: `PromptDialog` (`ui/src/components/ConfirmDialog.tsx`)
  with the songs passed in through its `below` prop, on the rehearsal screen
  (`Rehearsal.tsx`) and in History (`HistoryScreen.tsx`).
- **The songs** are drawn by `SongChips` (`ui/src/components/SongChips.tsx`)
  in two titled groups, "This rehearsal" and "Other songs", the second capped
  at ten (`OTHERS_SHOWN`). `NextTakeName` draws its row from `SongChip`
  directly. `song_choices` in `api.py` supplies them as `here` (what this
  rehearsal played, in the order first played, each as the next go at it,
  "Polyn 3") and `other` (every other song in the library, the most recently
  played first).
- **Six screens have a footer**, each a centred column: Setup, Rehearsal,
  Recording, Review, Finished and Drafts (`ui/src/screens/*.tsx`, the
  `footer` prop of `Shell`). Finish, Discard and Decide later are `ghost`
  buttons, which have no edge until the pointer is over them; History on the
  Finished screen is `outline`.

## The footer

### Requirements

- **F1.** Every footer is one row: what the screen has to say on the left,
  its buttons on the right. The main button is the rightmost.
- **F2.** A secondary button in a footer is an `outline` button: Finish,
  Discard, History and Decide later.
- **F3.** A screen's error line stands in the right-hand part of its footer,
  over the buttons.
- **F4.** The footers hold:

  | Screen | Left | Right |
  |---|---|---|
  | Setup | nothing | Start rehearsal |
  | Rehearsal | the name field, labelled *Next take* | Finish, Record take N |
  | Recording | nothing | Stop; under it "autosaved every 30 s", or "Saving the take" while it saves |
  | Review | the name field, labelled *Take name* | Discard, Save take; under them the line saying whether the take goes to the cloud |
  | Finished | nothing | History, New rehearsal |
  | Drafts | "They stay on disk and will be offered again next time." | Decide later |

- **F5.** On Rehearsal and Review a vertical rule separates the name field
  from the buttons.
- **F6.** The main buttons keep their words: "Record take N", "Save take".
- **F7.** The row holds in a window of 960×680, the smallest the app allows
  (`min_size` in `src/rehearsal_recorder/app.py`): the buttons stay on one
  line and nothing scrolls sideways.
- **F8.** On Setup, in a window wide enough for two columns (1100 px and
  wider, the breakpoint `Setup.tsx` lays them out at), Last time is the left
  column and the new rehearsal's setup the right one, over Start rehearsal.
  In a narrower window the setup comes first and Last time under it.

### Rationale

On a mockup of the review screen at 1366×768, the name field, its two rows
of songs and the buttons stacked in a column make a footer about 270 px
tall; in one row they make one of 183 px.

A `ghost` button reads as a word, not a button, beside a filled one. The main
button in one place on every screen means it is found without looking,
though Space is what presses it most of the time.

Notices are drawn in the right-hand corner just above the footer
(`ui/src/components/Notices.tsx`), so with the buttons on the right a notice
still never covers one.

The take's name is not on the main button: the field over it already says
it, in larger type.

With Start rehearsal on the right, the column over it is the one it
starts: the new rehearsal's setup, not the last rehearsal.

## The name field

`TakeNameField`, a new component, replaces `NextTakeName` and the name field
and songs at the top of `Review`.

### Requirements

- **N1.** The field is in a box with an edge, its text left-aligned at about
  28 px and semibold, a small uppercase label over it (*Next take* or *Take
  name*), and ✕ inside its right-hand end.
- **N2.** ✕ puts back the field's **fallback**:
  - on Rehearsal, the name the next take would have with none picked
    (`next_take_default`, which `session_state` returns as
    `suggest_take_name(chosen=False)`);
  - on Review, the name this take would have with none picked before
    recording: `stop_take` returns it as `default_name` (see P1).
- **N3.** A field left empty puts back its fallback when it loses focus.
  The field is never empty once focus has left it.
- **N4.** With the field focused, Space types a space, Enter leaves the
  field, and Escape leaves the field. Escape there does not finish the
  rehearsal or discard the take.
- **N5.** On Rehearsal, what the field holds goes to Python
  (`set_next_take_name`) when a song is clicked, on Enter, when the field
  loses focus, and before Record starts. A name equal to the fallback,
  compared case-blind, is sent as `""`.
- **N6.** On Rehearsal, the field shows the session's `next_take_name`
  whenever it is not focused.
- **N7.** On Review, the field starts from `suggested_name`, which includes
  a name picked before recording, and Save take keeps what the field holds.

### Rationale

Space and Escape behave as N4 says in any text field already (`isTyping`
and `stepOutOfField` in `ui/src/hooks/useSpacebar.ts`); `TakeNameField`
adds Enter.

Sending on blur and before Record means a name typed and never confirmed is
still the one the recording screen shows over the clock. `""` is what tells
Python to follow the name the take would have anyway, which changes when a
take of the rehearsal is renamed or deleted; the fallback sent as a name
would stay as it was until a take is kept. Showing
`next_take_name` while the field is not focused is what brings a take kept,
or a name set elsewhere, into the field. Python keeps it
until a take is kept (`set_next_take_name` in `api.py`), so a take thrown
away leaves it for the go after.

## Songs under the field

### Requirements

- **S1.** Under the field, at most two rows of song pills, the last of them
  **All songs…**.
- **S2.** The pills come in `song_choices` order: `here`, then `other`.
- **S3.** When `here` alone needs more than two rows, the pills kept are the
  songs whose latest go is latest, shown in `here` order. `song_choices`
  gives each `here` entry the number of its latest take (see P2).
- **S4.** A click on a pill puts its name in the field. It does not name the
  take by itself: what the field holds is what counts.
- **S5.** The pill matching what the field holds is lit, where it stands.
  Lighting a pill does not move any pill.
- **S6.** Text typed in the field that is not a pill's name and not the
  field's starting name narrows the pills to the songs containing it,
  compared case-blind, over `here` and `other` together.
- **S7.** All songs… opens a panel over the field holding every song of
  `here` and `other` in alphabetical order, compared case-blind with
  `Intl.Collator(undefined, { sensitivity: "base" })`, in columns, scrolling
  when it is taller than the space over the field. A `here` song shows as its
  next go ("Polyn 3"), as its pill does. A click on a song puts its name in
  the field and closes the panel.
- **S8.** Other… and its popover are gone.

### Rationale

A pill does not move because a song put first when picked jumps out from
under the pointer that clicked it, and the rest shift along (the comment in
`NextTakeName.tsx`).

## Renaming a take

- **R1.** Rename take, on Rehearsal and in History, uses `TakeNameField` in a
  compact size: the input at the dialog's usual text size, no rule, no footer
  buttons. Its fallback is the name the take has now. Enter there renames, as
  Enter in `PromptDialog` does.
- **R2.** `SongChips` and `SongChip` are replaced by the pills of
  `TakeNameField`; the rehearsal's own Rename rehearsal dialog keeps
  `PromptDialog`.

## Python

- **P1.** `stop_take` returns `default_name`:
  `suggest_take_name(take_number, chosen=False)`, alongside `suggested_name`.
  When the library cannot answer, `default_name` is `f"Take {take_number}"`,
  as `suggested_name` is then.
- **P2.** Each `here` entry of `song_choices` carries `last_take`, the number
  of that song's latest take in the rehearsal.

## Testing

Tests come before the code, and each is seen failing first.

- **Playwright** (`ui/e2e/`):
  - the name, before and after Stop, is in one field over the main button,
    in the same place on both screens;
  - ✕ puts back the fallback on both screens and in the dialogs;
  - Space types, Enter and Escape leave the field;
  - a name typed and left by a click elsewhere reaches `set_next_take_name`,
    and is the one Record starts with;
  - a pill clicked moves no pill;
  - typing narrows over every song;
  - All songs… lists every song alphabetically and fills the field;
  - every footer keeps its buttons on one line at 960×680;
  - the fake bridge (`ui/e2e/fake-bridge.js`) returns `default_name` and
    `last_take`.
- **Python** (`tests/test_engine.py`): `stop_take` returns `default_name`
  with and without a name picked; `song_choices` returns `last_take`.
- Heights are measured in Arial, as `ui/e2e/recording.spec.ts` does for the
  tiles, because CI's Linux draws in Liberation Sans, which has Arial's
  metrics.

## Steps

Three commits, the app working after each:

1. Every footer in one row (F1–F7), Last time and the setup swapped (F8),
   `TakeNameField` on Rehearsal and Review
   with ✕, the keys and sending the name (N1–N7), Other… gone (S8), and P1.
   The pills under the field in this step are `SongChips` as `Review` uses
   it, so every song can still be reached by typing.
2. Two rows of pills and the All songs panel (S1–S7), and P2.
3. The rename dialogs (R1, R2).

The guide (`docs/using-it.md`), the CHANGELOG and the pictures in the docs
(`tests/docs_screenshots.py`) change with the step that changes what they
show.

## Not part of this

- The take's name on the recording screen (#11, done).
- A Songs view in History (#12). Its list of songs is alphabetical by the
  same rule as S7.
