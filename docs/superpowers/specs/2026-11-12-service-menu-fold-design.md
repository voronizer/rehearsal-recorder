# Folding the band service's menu by hand

The column of sections down the left of the band service (the band, Home,
Rehearsals, Songs, Sets, Marks, Members, Trash, your name) is shadcn's
`Sidebar`, 224 px wide, and it can already fold to its icons, 48 px. Today it
does so only by itself: in a window 820 to 1099 px wide while the panel on
the right is open (Alex, 11 November 2026, 22:23:17). This change gives the
band member a handle to fold it and open it again, and the browser keeps the
choice.

Only the band service changes. РЭХА has no such menu, and its Settings'
sections keep folding by themselves in a small window.

The mockups Alex picked from: https://claude.ai/artifact/9rjeMd3BWMKQjkGkFBSstq
(how it folds) and https://claude.ai/artifact/YQzKHACWnW6oTQRWH4LvZn (Marks
folded), the real service on answers recorded from a local Worker over the
pictures' band. Sources: /mnt/project-files/band-service/menu-fold/.

## Alex's picks

All on 12 November 2026 (UTC).

- 10:04:34 «давай на сервисе сделаем левое главное меню сворачивающимся».
- 10:22:43 card «В. Ручка на краю»: a round handle on the column's right
  edge, level with the band's name; ‹ while open, › folded, at the same
  spot. Folded, the column shows the logo and the sections' icons, as when
  it folds by itself.
- 10:23:55 card «В этом браузере»: the browser keeps the fold; another
  browser or computer opens the menu open. Nothing in the database.
- 10:25:41 «не надо. нормально было.»: folded, the logo stays 36 px and the
  handle 24 px, the handle over the logo's right edge, as in the first
  mockup (Claude had shrunk the logo to 28 px to clear it).
- 10:26:28 card «А. Ничего»: folded, Marks shows no count of open marks, as
  when the column folds by itself.
- 10:27:37 card «Только картинки»: on reha.stream only the two pictures of
  a computer, `downloads` and `sets`, are taken again, now with the handle;
  the site's words stay.
- 10:28:10 card «Не трогать»: РЭХА unchanged.
- 11:15:23 «ok» to this spec and the plan.
- 11:17:52 «и давай логотип сделаем не таким круглым - слишком слизаны
  углы»; 11:19:27 card «А. Как кнопки» (mockup
  https://claude.ai/artifact/LgVPuTW9Yefz2MvduX5SQB): the band's logo has
  8 px corners at 36 px (the menu, sign-in), as a button has, and 4 px at
  28 px (a phone's header); 56 px on Members keeps 12 px. Before: 12 px
  and 8 px.
- 11:26:49 card «Все девять»: every band service picture on reha.stream,
  light and dark, is taken again, for the logo; `downloads` and `sets` show
  the handle too. The site's words stay.

## What the band sees

### The handle

On a computer, a round button 24 px across sits on the column's right edge,
its middle on the edge's line, level with the band's name (its top 22 px
below the column's top). It is our `Button`, `outline` at `icon-tiny`, made
round: the page's colour in both themes, as in the mockup, with a 1 px line
and a light shadow; under the pointer only its grey chevron, 14 px, goes
dark, and the hand shows over it (F12). A long band name is cut 8 px before
the handle, as it is cut now.

- Open, it shows ‹ and is named **Fold the menu**.
- Folded, it shows › and is named **Open the menu**.

Its name shows as a tip at its right on hover, and at once on keyboard
focus, as the strip's signs do. The tip only repeats the name, so it is for
the eyes alone (Tooltip in the design system). The handle comes first in the
column for Tab, before the sections, and keeps the focus when pressed, since
it is the same button, now on the column's new edge.

### Folded

The column is 48 px: the logo, 36 px, at the top, with the handle's middle on
the column's edge and its left 6 px over the logo's right edge; the sections' icons, each named in a tip; your letter at the
bottom. Marks has no count. This is the column as it folds by itself today,
so nothing in it is new. The sections' icons stand at the same height open
and folded, so nothing jumps.

The page takes the room the column gave up, 176 px, sliding over the
Sidebar's 200 ms; under Reduce motion at once.

### What the browser keeps

The fold is kept in the browser's storage under `reha.menu`, as Master's
level is under `reha.master`: open on a new browser, folded on the next
visit to the band service in a browser where it was folded. It is the
browser's, not the member's, so two members on one computer share it. A
browser that keeps nothing opens the menu each time, and the handle still
folds it for the visit.

### With the panel on the right

- 1100 px and wider: the panel opens beside the page and the column stays as
  the band member left it. The handle works.
- 820 to 1099 px: with the panel open the column folds by itself, as now,
  and the handle is not there, since it could not open the column. When the
  panel closes, the column goes back to the band member's choice and the
  handle comes back.
- 500 to 819 px: the panel lies over the page, as now; the column stays as
  the band member left it, and the handle works. Below 684 px an open panel
  covers the open column's edge and its handle, as it covers the column now;
  closing the panel brings them back.

### On a phone

Below 500 px nothing changes: the menu is behind ☰ and has no handle. The
kept fold waits for a computer's window.

## Not in this change

- No key folds the menu: the `Sidebar` has no Ctrl+B or ⌘B (design system
  C8).
- No count or dot on a folded Marks (Alex, 10:26:28).
- РЭХА, its guide and the service's README are unchanged.

### The logo's corners

`Logo` (`service/src/shell/parts.tsx`) is `rounded-md` (8 px) at 36 px, in
the column, folded or open, and on the sign-in card; `rounded-sm` (4 px) at
28 px in a phone's header; Members' 56 px keeps `rounded-xl` (12 px).

## Words and pictures

- CHANGELOG, under Unreleased: one item, starting in bold.
- `docs/design-system.md`: F4's paragraph on the band service says the left
  column folds by its handle and the browser keeps it; the `Sidebar` line in
  C8 says the band service keeps its left column's fold itself.
- reha.stream: all nine band service pictures, light and dark, taken again
  by `service/pictures/site.spec.ts` for the logo's corners (Alex, 11:26:49);
  `downloads` and `sets` show the handle. No words change. Alex sees them
  before the merge.

## Claude's calls

1. With the panel open at 820 to 1099 px, the handle is not there, rather
   than opening the column over the page or squeezing the page under 324 px.
2. The handle is our `Button` (`outline`, `icon-tiny`, round), not shadcn's
   `SidebarRail`, an invisible strip with a resize pointer where the hand
   goes over everything that presses (F12), nor `SidebarTrigger`, whose icon
   is fixed to PanelLeft where the handle needs ‹ and ›.
3. Its names: **Fold the menu** and **Open the menu**, after the panel's
   **Fold the panel** and **Open the panel**, and the phone's **Menu**.
4. Kept as `reha.menu` = `folded` in `localStorage`; absent means open.
5. The handle first for Tab; focus stays on it after a press.
6. No key for it.
7. The page keeps laying out by the window, as now: folding the column
   widens the page but does not switch it to the wide layout.
8. No handle on a phone: there the menu is the sheet behind ☰, and the kept
   fold waits for a computer's window.
9. Below 684 px an open panel lies over the handle, as it lies over the
   column today, rather than the handle standing over the panel.
