# Labels: the band's own names and colours for marks

A mark drops a moment in a take, with a word about it. What it can be called
is fixed in the code.

- **Four kinds, written in two places:**
  - `MARKER_KINDS` in `src/rehearsal_recorder/store/library.py`: `note`,
    `good`, `issue`, `redo`. `as_marker` turns anything else into `note`.
  - `MARKER_KINDS` in `ui/src/lib/markers.ts`: their names (*Note*, *Keep
    this*, *Went wrong*, *Do again*) and colours.
- **The names are ours, not the band's.** A band that marks solos, tempo or
  lyrics has nowhere to put "Solo", "Tempo" or "Lyrics".
- **The code gives some kinds jobs.** A *Keep this* mark draws its whole
  take green; [stars](2026-10-02-stars-design.md) end that. A *Note* with
  nothing written is left out of the notes under a take (`listable` in
  `ui/src/components/RehearsalOverview.tsx`, and the same filter in
  `LastTime.tsx`).

This makes them the band's own: **labels**, made, named, coloured, ordered
and deleted in Settings. It stands on stars, which take the whole-take
verdict off *Keep this*.

## Words

- **A label** is a name and a colour.
- **A mark** is a moment in a take, with a label and an optional comment.
  In the code it stays `marker`, and its comment `note`.

## Decisions

- **D1. A label is a name and a colour, and does nothing else.** No code
  knows a label by its name or its place in the list. Nothing is drawn
  green, counted apart, sent, kept or left out because of which label a
  mark has. A label changes how its marks look and what they are called.
- **D2. Every mark is listed.** With no label special, the notes under a
  take give every mark its line: its label's name, then its comment if it
  has one. Today a *Note* with nothing written is left out; it is listed
  like any other.
- **D3. Labels belong to the library,** in its database beside the marks,
  not in `config.json`. A mark and its label cannot fall out of step, and
  the labels go wherever the library goes.
- **D4. A mark always has a label.** So the last label cannot be deleted,
  and deleting one that is in use asks which label its marks get instead.
- **D5. A mark points at its label; it does not copy it.** Renaming or
  recolouring a label changes every mark it is on, everywhere, at once.

## Colours

- **C1. A palette of eight:** grey, red, amber, green, teal, blue, violet,
  pink.
  - Each has a value for the light theme and one for the dark, chosen to
    read as a tick on the waveform, as a dot on a bar and as a chip.
  - They are CSS variables (`--label-grey` … `--label-pink`) in
    `ui/src/index.css`, in both themes. The waveform reads them as it reads
    `--signal` and `--destructive` today.
  - A label stores its colour by name (`"red"`), so a theme can change a
    value without touching the library.
- **C2. Two labels may share a colour.** With eight colours, a band with
  more labels than that needs them to.

## Schema (migration 0004)

| Table | Change |
|---|---|
| `label` | new: `id` PK, `name` TEXT, `colour` TEXT, `position` INT. |
| `marker` | `label_id` → `label`, in place of `kind`. |

- **The starting labels are today's four,** in today's order, with today's
  colours:
  1. *Note*, grey;
  2. *Keep this*, green;
  3. *Went wrong*, red;
  4. *Do again*, amber.

  The migration makes them with ids 1 to 4 and points every mark at its
  kind's label, so every mark looks as it did. A new library starts with
  the same four.
- **`marker` is changed in place:** `ALTER TABLE marker ADD COLUMN
  label_id`, filled from `kind`, then `ALTER TABLE marker DROP COLUMN
  kind`. This is how 0002 changed `take` (`docs/development.md`).
  - A column added in place cannot be NOT NULL, so `label_id` is nullable
    in the schema. The code never writes a mark without one.
- **Names are unique case-blind,** compared by `casefold` as song titles
  are. SQLite's `lower()` folds only ASCII.
- **Marks from before the database.** A mark read from an old
  `session.json` by the importer carries a kind, or nothing. It gets the
  starting label that kind became, through a frozen map used for nothing
  else (`note` 1, `good` 2, `issue` 3, `redo` 4), or the first label when
  that one is gone.

## Settings: *Marks*

- **S1. A *Marks* tab, between *Folders* and *Appearance*:** "What a moment
  in a take can be marked with".
- **S2. One row per label, in order:**
  - a handle to drag it up or down. The order is the order of the marker
    dialog's buttons;
  - a dot in its colour. A click opens the palette, and a click there
    recolours it;
  - its name. A click makes it a field: Enter renames, Escape leaves it as
    it was. A name another label has is refused, with why;
  - how many marks have it ("37 marks");
  - Delete, shown under the mouse as on a take's row. The last label has
    none.
- **S3. *New label*** under the list adds a row with its name field open
  and the first palette colour no label has, or grey when every one is
  taken. Escape, or an empty name, adds nothing.
- **S4. Deleting:**
  - a label no mark has goes at once, since it is quickly made again;
  - a label in use asks first: "Delete *Do again*? Its 12 marks get:
    [*Went wrong* ▾]". The choices are the other labels, the first of them
    chosen. Delete gives them that label and removes this one, in one
    transaction.

## The marker dialog

- **M1. A mark dropped with M or *Mark* gets the first label,** as it gets
  *Note* today. The dialog opens with that label chosen.
- **M2. The dialog's buttons are the library's labels,** in their order,
  each with its dot. The comment field and *Delete marker* stay as they are.

## Where labels show

- **W1. A mark's colour is its label's:**
  - the tick on the waveform (`Timeline.tsx`);
  - the dot on a take's bar (`RehearsalOverview.tsx`);
  - the colours on a take's pill in the player's strip (`TakeStrip.tsx`);
  - the notes under a take (`RehearsalOverview.tsx`, `LastTime.tsx`,
    `TakePlayer.tsx`).
- **W2. The overview's legend** counts marks by label, in the labels'
  order: "2 Keep this · 3 Went wrong".

## Python

- **A1.** `list_labels()`: `[{id, name, colour, marks}]` in order, `marks`
  being how many marks have the label.
- **A2.** `add_label(name, colour)`, `rename_label(label_id, name)`,
  `recolour_label(label_id, colour)`, `move_label(label_id, position)`,
  `delete_label(label_id, marks_to=None)`. Each answers `{"ok": False,
  "error": …}` for:
  - an empty name;
  - a name another label has;
  - a colour not in the palette;
  - deleting the last label;
  - deleting a label in use with no `marks_to`.
- **A3.** Marks carry `label_id` in place of `kind`.
  - `add_take_marker(…, label_id=None)` gives the first label when it is
    None.
  - `update_take_marker(…, label_id=None)` leaves the label as it is when
    it is None.
  - Takes reach the interface with `markers: [{at, label_id, note}]`. The
    interface reads the labels with A1 when it starts, and again after a
    change in Settings.
- **A4.** `MARKER_KINDS` goes from `store/library.py` and from
  `ui/src/lib/markers.ts`. `as_marker` checks that the label exists, and
  gives the first label when it does not.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - migration 0004 on a database at 0003:
    - the four labels;
    - every mark on the label of its kind;
    - every take's files and cloud copies still there;
  - A2: each operation, and each refusal;
  - deleting a label in use moving its marks, in one transaction;
  - a case-only clash refused ("solo" against "Solo"), Cyrillic included;
  - an old `session.json` mark, by kind and with none;
  - a mark added with no label getting the first one.
- **Playwright:**
  - *Marks* in Settings:
    - add, rename, recolour, drag;
    - delete unused;
    - delete in use with the question;
    - the last label with no Delete;
  - the marker dialog's buttons following the list's order, and the first
    chosen;
  - a recoloured label recolouring its marks in the overview and on the
    waveform;
  - a mark with no comment listed under its take by its label's name.
- **Updated:** the e2e tests and the fake bridge that use `kind`, and the
  tests of `listable`. They change with D1 and D2, and say so.

## Docs

- `docs/using-it.md`:
  - marks and labels, where it says "pick a kind";
  - Settings → *Marks*.
- `CHANGELOG.md`.
- The settings screenshot in `tests/docs_screenshots.py` gains the *Marks*
  tab.

## Not part of this

- A label that does something: a shortcut key, a hashtag in the chat, a
  shelf of its own. Finding every mark with a label is
  [marks across the library](2026-10-04-marks-across-the-library-design.md),
  and it works the same for any label.
- Making a label from the marker dialog. Labels are made in Settings; the
  dialog picks.
- Colours outside the palette.
