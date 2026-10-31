# The band's service, part 1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private web page at the band's own address where the band
listens to its takes track by track, stars them and comments at a moment,
with РЭХА sending the takes there and a bot telling the band's Telegram chat.

**Architecture:** One Cloudflare Worker in `service/` serves the pages
(React, built with the design system from `ui/src`) and two JSON APIs: one
for РЭХА (key in a header) and one for the band (session cookie). D1,
Cloudflare's database, holds everything that is not audio: members, songs,
takes' names and details, stars, marks, comments, who has seen what, links
and keys (the tables are in “The service's D1 tables” below). R2,
Cloudflare's file storage, holds each take's files: every track's MP3, FLAC,
waveform and `.mid`. In РЭХА, a new `sending/` package holds two modules
behind one interface, the cloud folder (moved, unchanged) and the band
service (new); Settings › Folders draws a switch and the chosen module's
own panel.

**Tech Stack:** Python 3.10+ (urllib with certifi, SQLAlchemy + Alembic,
libsndfile through `soundfile`), React 19 + Vite 8 + Tailwind 4,
Cloudflare Workers + D1 + R2 + a Cron Trigger, Hono for the Worker's
routes, `@cloudflare/vite-plugin`, wrangler 4,
`@cloudflare/vitest-plugin` with vitest 5, Playwright, the Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-10-30-band-service-part-1-design.md`
(approved 31 October, 16:33). Mockups of the pages:
https://claude.ai/artifact/SZKv2ssjChEjWWsrnKWkqK (option Б), sources in
`/mnt/project-files/band-service/part-1/mockup-src/`. The playback test of
24 October: `/mnt/project-files/band-service/playback-test/index.html`.

## Global Constraints

- English, British spelling. One word per thing: take (never “go” in what
  a person reads), rehearsal, song, track, mark, label.
- The app's wording follows `docs/design-system.md` F7, P2, C3 and B8:
  curly quotes around a name in a title (“Viasna 12” in the band service).
- Test titles and Python `ok()` labels: cp1252 characters only, so no
  `ł`, `ў` or Cyrillic in a title, even where the data has them.
- While developing, run only the tests a change touches, once each. The
  full suites run once, on CI.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  and nothing else of the kind: no `Claude-Session:` line, no session link.
  The pull request body ends with plain “Generated with Claude Code”.
- `service/` carries its own `LICENSE`, FSL-1.1-MIT, with Alex as the
  licensor. РЭХА stays MIT.
- Nothing in the code names band.reha.stream, reha.stream as the service's
  address, or Alex's band. The address, the bot and the chat come from each
  copy's own settings.
- Each feature is its own module with its own settings panel; a switch
  picks the module; no rows hidden by conditions.
- Values the spec fixes: a link lasts 24 hours and works once; a link made
  with **Sign in on another device** lasts 15 minutes; a session lasts 365
  days from the last visit; a take stays in the trash 30 days; a chat
  message takes additions for 3 hours; a part is 10 MiB (10,485,760 bytes),
  the last part of a file may be smaller; the cookie is HttpOnly, Secure,
  SameSite=Lax; links' tokens, sessions and РЭХА's keys are kept only as
  SHA-256 hashes.
- For the service РЭХА sends each track as MP3 and FLAC, its `.mid` where it
  recorded notes, and a waveform file. No mix file. Every MP3 of a take
  goes before any FLAC.
- Versions are pinned exactly in `service/package.json`: wrangler 4.156.0,
  `@cloudflare/vite-plugin` 1.66.0, `@cloudflare/vitest-plugin` 1.4.11,
  `@cloudflare/workers-types` 5.20261031.1, vitest 5.0.5,
  `hono` 4.13.13, `qrcode-generator` 2.0.4; React, Vite, Tailwind and Playwright at the
  versions `ui/package.json` uses.

## Review Focus

1. РЭХА is closed or the laptop sleeps between a part arriving and РЭХА
   writing its etag down. Expected: that part is sent again under the same
   number, R2 keeps the later one, and the file completes. (Task 6,
   `test_sending.py`: “part sent twice”.)
2. РЭХА is opened again after a cut-short upload. Expected: the bytes sent
   are the very bytes sent before, because the MP3 and FLAC files made for
   the upload are kept on disk until their upload completes and are never
   made again for the same generation. (Task 6: “staged file reused”.)
3. Telegram draws a preview of a sign-in link the moment Alex pastes it.
   Expected: the link still works for the member, since a GET never uses a
   link up. (Task 2: “GET keeps the link”.)
4. A take is renamed, starred or cropped while its files are going up.
   Expected: the upload goes on; the rename and ★ follow in the next PUT; a
   crop starts a new generation, and the service plays the old files until
   the new MP3s are all up, then shifts the comments. (Tasks 3 and 6.)
5. A take is deleted in РЭХА and brought back with **Undo** before its
   notice ends. Expected: nothing happens in the service; only a deletion
   whose Undo time passed moves the take to the service's trash. (Task 6:
   “undo keeps it”.)

---

## The shared contract

Every task that touches both sides reads this section. Names here are
binding.

### РЭХА's settings (config.json)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `service_key` | string or absent | absent | the key as pasted: `<address>:<secret>` |
| `send_to` | `"cloud"` or `"service"` | `"cloud"` | which module the switch picks; read as `"cloud"` while there is no key |
| `service_auto_publish` | bool | false | the service panel's **Send saved takes automatically** |

The cloud folder's keys (`cloud_dir`, `cloud_format`, `auto_publish`,
`auto_publish_what`) stay as they are and mean what they mean today.

A key is split at its last `:`. The address part is a host name, with an
optional `:port`; the secret is 43 characters of base64url (32 random bytes).
The service is reached at `https://<address>`, or `http://<address>` when
the host is `localhost` or `127.0.0.1` (tests and `wrangler dev`).

`get_settings()` adds:
`"send_to": "cloud" | "service"`,
`"service": {"address": str, "auto_publish": bool} | None`.

### РЭХА's API calls (Python `Api`, called from the interface)

| Call | Answer |
|---|---|
| `set_service_key(key)` | `{"ok": True, "address": str}`; a key in the wrong shape `{"ok": False, "error": "This is not a band service key"}`; a key the service turns down `{"ok": False, "error": <the service's words>}`; a service that cannot be reached keeps the key: `{"ok": True, "address": str, "unchecked": True}`. Pasting a key sets `send_to` to `"service"`. |
| `disconnect_service()` | `{"ok": True}`: removes `service_key`, sets `send_to` to `"cloud"`, stops the service's queue and forgets what it still had to send. |
| `set_send_to(which)` | `{"ok": True, "send_to": which}`; `"service"` without a key: `{"ok": False, "error": "No band service key"}` |
| `set_service_auto_publish(on)` | `{"ok": True, "auto_publish": bool}` |
| `share_take(folder, n, what="mix")` | as today, on the chosen module; the service ignores `what` |
| `unshare_take(folder, n)` | as today, on the chosen module; for the service, **Remove from the band service** |
| `send_starred(folder)` | as today, on the chosen module |
| `retry_cloud(entry_id)` | as today for `kind == "cloud"`; also takes `kind == "service"` |
| `service_take(folder, n)` | `{"ok": True, "files": [{"name": "Bass", "mp3": bool, "flac": bool, "mid": bool or None}]}`, what of the take is up, for its dialog |
| `sending_left()` | `{"takes": int, "bytes": int}` the service still has to send |
| `close_anyway()` | closes the window without asking again |

A take's dict, as `Library` returns it, gains
`"service": {"up": bool, "flac": bool, "error": str | None} | None`: None
when the take was never sent to the service; `up` once its MP3s are all
up; `flac` once its FLAC files are too.

The interface's activity entries gain `kind: "service"`.

### РЭХА → the service

Every call carries `Authorization: Bearer <secret>`. Bodies are JSON
except a part. An error is a 4xx with `{"error": "<words a musician
reads>"}`; an upload R2 no longer has is a 404 with `"gone": true`.

| Call | Body | Answer |
|---|---|---|
| `GET /api/reha/hello` | | `{"ok": true}` |
| `PUT /api/reha/takes/:uid` | TakeMeta | `{"ok": true}` |
| `POST /api/reha/takes/:uid/files` | `{"gen", "name", "size"}` | `{"upload_id"}` |
| `PUT /api/reha/takes/:uid/files/:upload_id/:part?gen=&name=` | the part's bytes | `{"etag"}` |
| `POST /api/reha/takes/:uid/files/:upload_id/done` | `{"gen", "name", "parts": [[number, etag], …]}` | `{"ok": true}` |
| `POST /api/reha/takes/:uid/ready` | `{"gen", "what": "mp3" \| "flac"}` | `{"ok": true}` |
| `DELETE /api/reha/takes/:uid` | | `{"ok": true}`: the take goes to the trash |

TakeMeta:

```json
{
  "rehearsal": {"uid": "…", "name": "Thursday", "date": "2026-10-30"},
  "number": 12,
  "name": "Viasna 12",
  "song": "Viasna",
  "duration_sec": 312.48,
  "gen": 1,
  "cut_start": 0,
  "starred": true,
  "balance": {"Bass": 0.8},
  "tracks": [{"position": 1, "name": "Bass", "icon": "bass",
              "files": ["1.mp3", "1.flac", "1.peaks"]}],
  "notes": [{"position": 2, "name": "Keys", "file": "2.mid"}],
  "marks": [{"at": 42.0, "label": "Fix", "colour": "#e5484d", "note": "Too fast"}]
}
```

- `uid`s are UUID4 strings made by РЭХА. A take's `uid` is made when it is
  first sent and kept for good. A rehearsal's is `uuid5(NAMESPACE_URL,
  f"reha-rehearsal:{created_at}:{id}")`, so it needs no table and survives
  an Undo.
- `song` is null for a take nobody named.
- `gen` starts at 1 and goes up by one each time the take's audio changes
  (a crop). `cut_start` is how many seconds the crops since the last
  generation the service has took off the start; 0 when none did.
- File names: `<position>.mp3`, `<position>.flac`, `<position>.peaks` for an
  audio track; `<position>.mid` for notes. A `.peaks` file is
  `{"peaks": [1200 numbers from 0 to 1, three decimals]}`, made with
  `audio/waveform.wav_peaks(path, buckets=1200)`.
- R2 key: `takes/<uid>/<gen>/<name>`.

What the service does with them:

- PUT creates or updates the take and its rehearsal and song (songs match
  by title, case-blind). A take in the trash comes out of it with its
  comments and stars. Marks from РЭХА replace the take's earlier marks,
  matched by `at` rounded to 0.01 s, so replies to a mark that is still
  there stay.
- A take shows to the band once `ready` with `what: "mp3"` came for some
  generation. A `ready` for a newer generation switches the take to it,
  applies its `cut_start` to the comments (each moves back by that much; one
  that would fall before 0:00 stays at 0:00 with `cut_off` set) and deletes
  the older generations' objects.
- DELETE puts the take in the trash: `trashed_at` is now.

### The band's API (session cookie), for the pages

| Call | Answer |
|---|---|
| `POST /api/signin` `{"token"}` | sets the session cookie; `{"ok": true, "needs_name": bool}`; a used, unknown or old link: 410 `{"error": "This link has been used or has run out. Ask for a new one."}` |
| `POST /api/setup` `{"secret"}` | the owner signed in; wrong secret 403 |
| `GET /api/me` | `{"id", "name", "owner": bool}`; no session 401 |
| `PUT /api/me` `{"name"}` | `{"ok": true}` |
| `POST /api/me/device-link` | `{"url", "expires_at"}` |
| `GET /api/feed` | `{"new": {"takes": [TakeRow], "comments": [CommentRow]}, "new_count": int, "songs": [SongRow], "not_named": SongRow \| null, "start": {"kind": "new" \| "song", "id"}}` |
| `GET /api/songs/:id` (`not-named` for takes with no song) | `{"song", "best": TakeRow \| null, "takes": [TakeRow]}` |
| `GET /api/takes/:uid` | the take with tracks, peaks keys, members' stars, `starred_at_rehearsal`, comments with replies, files with what is still coming |
| `POST` / `DELETE /api/takes/:uid/star` | `{"ok": true}` |
| `POST /api/takes/:uid/seen` | `{"ok": true}` |
| `POST /api/takes/:uid/comments` `{"at", "text", "parent_id"?}` | the comment |
| `PATCH /api/comments/:id` `{"closed": bool}` | `{"ok": true}` |
| `GET /api/trash`, `POST /api/trash/:uid/restore` | the trashed takes; `{"ok": true}` |
| `GET /files/<uid>/<gen>/<name>` | the file from R2, with `Range`; `?download=1` names it “Viasna 12 - Bass.flac” |
| Owner only: `GET /api/members`, `POST /api/members`, `POST /api/members/:id/link`, `POST /api/members/:id/signout`, `GET /api/keys`, `POST /api/keys` `{"name"}`, `DELETE /api/keys/:id` | lists; a new link `{"url", "expires_at"}`; a new key `{"key"}` shown once |

### The service's D1 tables (`service/migrations/0001_init.sql`)

```sql
member(id INTEGER PRIMARY KEY, name TEXT, owner INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)
link(hash TEXT PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
     expires_at TEXT NOT NULL, created_at TEXT NOT NULL)
session(hash TEXT PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL)
reha_key(id INTEGER PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)
rehearsal(uid TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL)
song(id INTEGER PRIMARY KEY, title TEXT NOT NULL UNIQUE COLLATE NOCASE)
take(uid TEXT PRIMARY KEY, rehearsal_uid TEXT NOT NULL REFERENCES rehearsal(uid), number INTEGER NOT NULL,
     song_id INTEGER REFERENCES song(id), name TEXT NOT NULL, duration_sec REAL NOT NULL,
     starred_at_rehearsal INTEGER NOT NULL DEFAULT 0, balance TEXT NOT NULL, tracks TEXT NOT NULL,
     notes TEXT NOT NULL, gen INTEGER NOT NULL, shown_gen INTEGER, flac_gen INTEGER,
     pending_cut REAL NOT NULL DEFAULT 0, shown_at TEXT, trashed_at TEXT, updated_at TEXT NOT NULL)
comment(id INTEGER PRIMARY KEY, take_uid TEXT NOT NULL REFERENCES take(uid) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES comment(id) ON DELETE CASCADE, member_id INTEGER REFERENCES member(id),
        at REAL NOT NULL, text TEXT NOT NULL, label TEXT, colour TEXT, from_reha INTEGER NOT NULL DEFAULT 0,
        closed INTEGER NOT NULL DEFAULT 0, cut_off INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)
star(take_uid TEXT NOT NULL REFERENCES take(uid) ON DELETE CASCADE,
     member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE, PRIMARY KEY (take_uid, member_id))
seen(member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
     take_uid TEXT NOT NULL REFERENCES take(uid) ON DELETE CASCADE, seen_at TEXT NOT NULL,
     PRIMARY KEY (member_id, take_uid))
chat(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, about TEXT NOT NULL, message_id INTEGER NOT NULL,
     text TEXT NOT NULL, started_at TEXT NOT NULL)
```

A mark from РЭХА is a `comment` row with `from_reha = 1`, its label and
colour, `member_id` null and its note as `text`: one thing with a comment,
as the concept has it, so it can be answered and closed too.

### The service's settings (Worker secrets, set in Cloudflare)

`SETUP_SECRET` (required), `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
(both optional; without them nothing is posted). Bindings: `DB` (D1),
`FILES` (R2), `ASSETS`.

---

### Task 1: РЭХА's `sending/` package, with the cloud folder moved into it

The cloud folder's code moves, and nothing it does changes. Every existing
Python suite stays green with only its imports and attribute paths updated.

**Files:**
- Create: `src/rehearsal_recorder/sending/__init__.py`, `src/rehearsal_recorder/sending/cloud_folder.py`
- Delete: `src/rehearsal_recorder/cloud.py` (its contents go to `cloud_folder.py`)
- Modify: `src/rehearsal_recorder/api.py` (lines 6628-7200, the “sharing to the cloud” section, and every caller of `_enqueue_publish`, `_cloud_queue`, `_cloud_entries`)
- Modify: `tests/test_engine.py`, `tests/test_backing.py` (paths only)
- Modify: `pyproject.toml` only if `setuptools.packages.find` needs nothing more (it should not)

**Interfaces:**
- Produces, in `sending/__init__.py`:

```python
class Module(Protocol):
    id: str                                   # "cloud" or "service"
    def send(self, folder, take_number, what=None) -> dict: ...      # share_take
    def send_starred(self, folder) -> dict: ...
    def saved(self, folder, take_number, take=None) -> None: ...     # was _enqueue_publish
    def edited(self, folder, take_number, cut_start=0.0) -> None: ... # name, song, ★, marks, crop
    def remove(self, folder, take_number) -> dict: ...               # unshare_take
    def deleted(self, records: list[dict]) -> None: ...              # takes whose Undo time passed
    def states(self, folder) -> dict[int, str]: ...                  # {take_number: "queued" | "working"}
    def left(self) -> dict: ...                                      # {"takes": int, "bytes": int}
    def retry(self, entry_id) -> dict: ...
    def start(self) -> None: ...
    def stop(self, timeout=2.0) -> None: ...

class Sending:
    def __init__(self, modules: dict[str, Module], config: dict): ...
    def chosen(self) -> Module: ...           # by config "send_to"; "cloud" without "service_key"
    def all(self) -> list[Module]: ...
    def get(self, id: str) -> Module: ...
    # What happens to a take goes to every module: each keeps up to date
    # what it already holds, and only the chosen one sends anything new.
    def saved(self, folder, take_number, take=None) -> None: ...
    def edited(self, folder, take_number, cut_start=0.0) -> None: ...
    def deleted(self, records: list[dict]) -> None: ...
```

- Produces, in `cloud_folder.py`: `class CloudFolder(Module)` with
  `id = "cloud"`, built as `CloudFolder(api)`. It holds `PublishQueue`
  (moved from `cloud.py`, unchanged) as `self.queue`, the entries dict as
  `self.entries`, and the methods moved from `Api`: `_cloud_dir`,
  `_cloud_target`, `_copy_current`, `_copy_due`, `_queue_copy`,
  `_enqueue_session_takes`, `_retry_failed_publishes`, `_publish_step`,
  `_publish`, `_record_cloud_error`, `_copy_to_cloud`, the bodies of
  `share_take` (→ `send`), `send_starred`, `unshare_take` (→ `remove`),
  `retry_cloud` (→ `retry`), and `source_of`, `copies_exist`, `is_current`
  as module functions. `edited` and `deleted` do nothing for the cloud
  folder (its copies carry no names, stars or marks; a rename, a crop and a
  deletion already handle its copies where they did), and `left` is
  `{"takes": 0, "bytes": 0}`.
- `Api` keeps its public calls (`share_take`, `unshare_take`,
  `send_starred`, `retry_cloud`, `set_cloud_dir`, `set_cloud_format`,
  `set_auto_publish`, `clear_cloud_dir`, `choose_cloud_dir`) as one-line
  calls into `self._sending`, and `self._sending = Sending({"cloud":
  CloudFolder(self)}, self._config)`. Every `self._enqueue_publish(...)`
  becomes `self._sending.saved(...)`. `_copy_due` also answers False when
  `self._sending.chosen().id != "cloud"`, so the cloud folder sends nothing
  new on its own while the switch picks the band service, and still keeps
  its existing copies up to date; with no key this is always the cloud
  folder, so nothing changes today.
- The helpers the crop, delete and Undo code use for cloud copies
  (`_remove_shared`, `_unused`, `_cloud_in_use`, `_shared_of`, `_shape_of`,
  `_cloud_subfolder`, `_free_copy_name`, the empty-folder sweep) stay where
  they are in `api.py`: they look after copies already in the cloud folder,
  whichever module is chosen.

- [ ] **Step 1: Run the suites that cover the cloud folder, before moving anything**

Run: `python tests/test_engine.py > /tmp/engine-before.txt 2>&1; tail -3 /tmp/engine-before.txt` and `python tests/test_backing.py | tail -3`
Expected: both pass. Keep the count of passed checks to compare.

- [ ] **Step 2: Move the code**

Create the package, move as listed above, make `Api` call through
`self._sending`. Update `tests/test_engine.py` and `tests/test_backing.py`:
`cloudmod` imports from `rehearsal_recorder.sending.cloud_folder`;
`a._cloud_queue` becomes `a._sending.get("cloud").queue`;
`a._cloud_entries` becomes `a._sending.get("cloud").entries`; calls of the
moved private methods go through `a._sending.get("cloud")`. No check's
assertion changes.

- [ ] **Step 3: Add one check for the switch, to `tests/test_engine.py`**

```python
# With send_to "service" but no key, the cloud folder is still the one chosen.
a.config["send_to"] = "service"
ok("no key: the cloud folder is chosen", a._sending.chosen().id == "cloud")
```

- [ ] **Step 4: Run the same suites again**

Run: `python tests/test_engine.py > /tmp/engine-after.txt 2>&1; tail -3 /tmp/engine-after.txt` and `python tests/test_backing.py | tail -3`
Expected: both pass, with one check more than in Step 1.

- [ ] **Step 5: Run the interface's cloud tests, which drive the same calls through the fake**

Run: `cd ui && npx playwright test e2e/cloud.spec.ts e2e/evening.spec.ts` (with the throwaway config that points at `/opt/pw-browsers/chromium`, not committed)
Expected: PASS, unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/rehearsal_recorder/sending src/rehearsal_recorder/api.py tests/test_engine.py tests/test_backing.py
git rm src/rehearsal_recorder/cloud.py
git commit -m "Move the cloud folder into a sending package, unchanged"
```

---

### Task 2: The service's frame, its tables, signing in, members and keys

**Files:**
- Create: `service/package.json`, `service/LICENSE` (FSL-1.1-MIT), `service/README.md`, `service/wrangler.jsonc`, `service/vite.config.ts`, `service/vitest.config.ts`, `service/tsconfig.json`, `service/index.html`
- Create: `service/migrations/0001_init.sql` (the tables in the shared contract)
- Create: `service/worker/index.ts` (the Hono app, exported as `{fetch: app.fetch, scheduled}`), `service/worker/auth.ts`, `service/worker/members.ts`, `service/worker/time.ts`, `service/worker/hash.ts`
- Create: `service/test/apply-migrations.ts`, `service/test/auth.test.ts`, `service/test/members.test.ts`

**Interfaces:**
- Produces: `sha256Hex(text): Promise<string>`, `newToken(): string` (32
  random bytes as base64url, 43 characters), `now(): Date` (one place
  tests replace), `signedIn(request, env): Promise<Member | null>` which
  also moves the session's expiry to 365 days from now,
  `rehaKey(request, env): Promise<boolean>` (both also as Hono middleware,
  `needMember`, `needOwner` and `needKey`), and `app`, a
  `Hono<{ Bindings: Env }>` that Tasks 3 and 4 add their routes to.
- `wrangler.jsonc`: `name: "reha-band"`, `main: "worker/index.ts"`,
  `compatibility_date: "2026-10-15"`, assets with
  `not_found_handling: "single-page-application"`, `binding: "ASSETS"`,
  `run_worker_first: ["/api/*", "/files/*"]`; D1 binding `DB`
  (`database_name: "reha-band"`, `database_id: "local"`,
  `migrations_dir: "migrations"`); R2 binding `FILES`
  (`bucket_name: "reha-band"`); `triggers: {"crons": ["17 4 * * *"]}`
  (once a day, for emptying the trash); `workers_dev: true`; no `routes`.

Rules the tests pin:

- A link's GET is the page's (the SPA answers it); only `POST /api/signin`
  uses a link up. It deletes the link row with `DELETE … RETURNING`, so two
  presses at once sign in one browser, not two.
- A link older than 24 hours is refused with the 410 words, and the
  Members page shows “Ran out” for it; one not used yet shows “Not opened
  yet”.
- `POST /api/setup` compares the secret in constant time. The first time,
  it makes the owner (`owner = 1`, no name); after that it signs the owner
  in again.
- A member's first sign-in answers `needs_name: true` until `PUT /api/me`
  gives a name; the name is 1 to 40 characters after trimming.
- **Sign out everywhere** deletes all the member's sessions and links.
- A device link lasts 15 minutes and belongs to the member who made it.
- РЭХА's key is shown once, as `<host>:<secret>`, where `<host>` is the
  request's own host; only its hash is kept.

- [ ] **Step 1: Write the failing tests**

`service/test/auth.test.ts`, each against `exports.default.fetch` with
migrations applied:

```ts
test("GET keeps the link", …)            // GET /signin/<t> then POST /api/signin {token: t} → 200
test("a link works once", …)             // second POST → 410, body.error as in the contract
test("a link runs out after a day", …)   // now() + 24 h + 1 s → 410
test("two presses at once sign in one", …) // Promise.all of two POSTs → one 200, one 410
test("the session moves on with each visit", …) // expiry after GET /api/me is now() + 365 days
test("setup makes the owner, then signs in again", …)
test("a wrong setup secret is refused", …) // 403
test("sign out everywhere ends every session", …)
test("a device link lasts 15 minutes", …)
```

`service/test/members.test.ts`:

```ts
test("only the owner sees members", …)   // a member → 403
test("a new member's link shows Not opened yet, then Ran out", …)
test("a key is shown once and works for /api/reha/hello", …)
test("a removed key no longer works", …) // 401
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npm ci && npx vitest run test/auth.test.ts test/members.test.ts`
Expected: FAIL, the routes do not exist yet.

- [ ] **Step 3: Write the frame, the tables and the routes**

- [ ] **Step 4: Run the tests again**

Run: `cd service && npx vitest run test/auth.test.ts test/members.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add service
git commit -m "Band service: its frame, tables, sign-in, members and keys"
```

---

### Task 3: The service's side for РЭХА, and the band's chat

**Files:**
- Create: `service/worker/reha.ts` (the `/api/reha/*` routes), `service/worker/takes.ts` (upserting a take, switching generations, the comment shift), `service/worker/chat.ts`, `service/worker/purge.ts`
- Create: `service/test/reha.test.ts`, `service/test/chat.test.ts`

**Interfaces:**
- Consumes: Task 2's `rehaKey`, `json`, `now`.
- Produces: `putTake(env, uid, meta: TakeMeta)`,
  `ready(env, uid, gen, what)`, `trash(env, uid)`,
  `shiftComments(env, uid, cutStart)`,
  `tellChat(env, event: ChatEvent, origin: string, api = telegram)` where
  `ChatEvent = {kind: "take", take_uid} | {kind: "comment", comment_id}`
  and `telegram = {send(text): Promise<number>, edit(messageId, text): Promise<void>}`,
  `purgeTrash(env)` deleting takes trashed more than 30 days ago with
  their R2 objects (by listing `takes/<uid>/`).

Rules the tests pin:

- Upload routes check the key, the take and the name against the take's
  TakeMeta for that `gen`; a part bigger than 10,485,760 bytes is refused.
  A `done` for an upload R2 no longer has answers 404 with `"gone": true`.
- `ready` with `"mp3"` makes the take shown (`shown_gen`, `shown_at` the
  first time), applies `pending_cut` for a newer generation, deletes older
  generations' objects, and calls `tellChat` with `{kind: "take"}` once per
  take, the first time it is shown.
- The chat, through `ctx.waitUntil`: the first shown take of a rehearsal
  sends “New takes from Thursday, 30 October: Viasna 11” and keeps the
  message id in `chat` (`kind = "takes"`, `about` = the rehearsal's uid);
  each next one within 3 hours of `started_at` edits it to add “, Viasna
  12”. A member's first comment on a take sends “Alex on Viasna 12: 1:42
  “The bridge drags here””; their next ones on it within 3 hours are added
  as “, 2:58 “Fill too long?””. Each take and each comment is a link
  (`<a href>`, `parse_mode: "HTML"`, previews off) to its place:
  `<origin>/takes/<uid>` and `<origin>/takes/<uid>?at=<seconds>`. Marks
  from РЭХА are never posted. Without `TELEGRAM_BOT_TOKEN` and
  `TELEGRAM_CHAT_ID` nothing is sent. A Telegram error is logged and does
  not fail the request.
- The weekday and date come from the rehearsal's `date` as a calendar day,
  with no time zone.
- `purgeTrash` runs from the Worker's `scheduled` handler, once a day.
  Workers Free allows 5 Cron Triggers per account and 10 ms of CPU per
  run; deleting files costs little CPU, since time spent waiting on R2
  does not count, and R2 deletes up to 1000 keys in one call.

- [ ] **Step 1: Write the failing tests**

`service/test/reha.test.ts`:

```ts
test("a take is hidden until its MP3s are ready", …)
test("a file goes up in parts and completes", …)     // two 10 MiB parts and a short last one
test("a part over 10 MiB is refused", …)            // 413
test("a gone upload says so", …)                   // abort it, then done → 404, gone: true
test("a take sent again leaves the trash with its comments", …)
test("a crop shifts comments when its MP3s are ready", …) // comment at 30 s, cut_start 10 → 20 s
test("a comment in the cut part stays at 0:00, marked", …) // comment at 5 s, cut_start 10 → at 0, cut_off 1
test("marks from REHA replace the earlier ones, replies stay", …)
test("songs match by title, case-blind", …)
test("the trash is emptied after 30 days, files and all", …)
```

`service/test/chat.test.ts`, with a fake `telegram` that records calls:

```ts
test("the first take of a rehearsal starts a message", …)
expect(fake.sent[0]).toContain("New takes from Thursday, 30 October: ")
test("the next take within 3 hours is added to it", …)
test("after 3 hours a new message starts", …)
test("comments go per person and take", …)
test("marks from REHA are not posted", …)
test("without a bot token nothing is sent", …)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx vitest run test/reha.test.ts test/chat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `reha.ts`, `takes.ts`, `chat.ts`, `purge.ts`**

- [ ] **Step 4: Run the tests again**

Run: `cd service && npx vitest run test/reha.test.ts test/chat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add service
git commit -m "Band service: takes from REHA, uploads, trash and the band's chat"
```

---

### Task 4: The service's side for the band

**Files:**
- Create: `service/worker/band.ts` (feed, songs, takes, stars, seen, comments, trash, restore), `service/worker/files.ts` (`/files/*`)
- Create: `service/test/band.test.ts`, `service/test/files.test.ts`

**Interfaces:**
- Consumes: Task 2's `signedIn`; Task 3's `tellChat`, `purgeTrash`.
- Produces the band's API in the shared contract, and these row shapes,
  which Task 5 renders:

```ts
type TakeRow = { uid: string; name: string; song_id: number | null; date: string;
  duration_sec: number; marks: number; stars: { member_id: number; initial: string }[];
  starred_at_rehearsal: boolean; is_new: boolean }
type SongRow = { id: number | "not-named"; title: string; takes: number; last_date: string;
  best: TakeRow | null; has_new: boolean }
type CommentRow = { id: number; take_uid: string; take_name: string; at: number; text: string;
  author: string | null; label: string | null; colour: string | null; created_at: string }
```

Rules the tests pin:

- Only shown takes (`shown_gen` not null) and not trashed ones are in the
  feed, songs and song pages.
- New for you: a shown take with no `seen` row for you; a comment by
  someone else made after your `seen_at` for its take. `POST
  /api/takes/:uid/seen` sets `seen_at` to now. `new_count` is new takes
  plus new comments.
- Songs: those with shown takes, by their last take (rehearsal date, then
  number), newest first; **Not named** last.
- Best take: the most members' stars, the newest on a tie; with none, the
  newest take. `starred_at_rehearsal` never counts.
- `start` is `{"kind": "new"}` when anything is new, else the song played
  last.
- A comment: `at` from 0 to the take's length, text 1 to 2000 characters;
  a reply's `at` is its parent's. `tellChat({kind: "comment"})` on each.
- A take's page lists the files as `{name, mp3, flac, mid}` and says which
  FLAC are still coming (`flac_gen` below `shown_gen`).
- `/files/*` needs a session, answers `Range` with 206, and with
  `?download=1` sends `Content-Disposition` with “<take name> - <track
  name>.<ext>”.
- **Restore** clears `trashed_at`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a new take is new until opened", …)
test("a comment is new until its take is opened again", …)
test("your own comment is never new", …)
test("songs come by their last take, not named last", …)
test("the best take is the most starred, newest on a tie", …)
test("the star at rehearsal does not count for the best take", …)
test("a reply takes its parent's moment", …)
test("files need a session and answer a range", …)
test("a download is named after the take and the track", …)
test("restore puts a take back in its song", …)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx vitest run test/band.test.ts test/files.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `band.ts` and `files.ts`**

- [ ] **Step 4: Run the tests again**

Run: `cd service && npx vitest run test/band.test.ts test/files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add service
git commit -m "Band service: the band's feed, songs, takes, comments and files"
```

---

### Task 5: The service's pages and player

Start from the mockups in `/mnt/project-files/band-service/part-1/mockup-src/`
(`desk.tsx`, option Б; `song.tsx`; `take.tsx`), which already use the
design system's components the way the pages should.

**Files:**
- Create: `service/src/main.tsx`, `service/src/router.ts` (paths, no library), `service/src/api.ts` (the band's API, typed), `service/src/service.css` (Tailwind with `@source` for `../ui/src`)
- Create: `service/src/pages/` `Shell.tsx` (left column on a computer, one page at a time on a phone, under 768 px), `First.tsx` (New since you were here, Songs), `Song.tsx`, `Take.tsx`, `Comments.tsx`, `Downloads.tsx`, `Trash.tsx`, `Members.tsx`, `SignIn.tsx`, `Setup.tsx`, `Name.tsx`, `DeviceLink.tsx` (with a QR code from `qrcode-generator`)
- Create: `service/src/player/mp3.ts` (frames of an MP3), `service/src/player/player.ts`
- Create: `service/e2e/fixtures.ts` (a made-up band: songs Viasna, Pałyn, Kupalle; members Alex, Dzima, Ira, Paŭlik; `page.route` answers for every call), `service/e2e/*.spec.ts`, `service/playwright.config.ts`
- Create: `service/src/player/mp3.test.ts`

**Interfaces:**
- Consumes: Task 4's API and row shapes; Task 2's `/api/me`, members and
  keys.
- Produces: `parseFrames(bytes: Uint8Array): {frames: Uint8Array[],
  samplesPerFrame: number, sampleRate: number}`;
  `class Player { constructor(tracks: {url, channels, gain}[]); play(at);
  pause(); seek(at); setMute(i, on); setSolo(i, on); time(): number;
  onEnd }`.

The player, as tested on 24 October: each track's MP3 is fetched as a
stream, split into frames, decoded a few seconds ahead with `AudioDecoder`,
and every track's buffers are started on one `AudioContext` clock. Gains
come from the take's balance; M and S multiply them. A seek stops every
source and starts again from the frame at that time. A browser whose
`AudioDecoder` cannot decode MP3 shows, in place of ▶: “This browser cannot
play the takes. Try Chrome, Edge or Safari, updated.”

Paths: `/` (the first screen; on a computer it opens on **New**, or with
nothing new on the song played last), `/songs/:id`, `/takes/:uid`
(`?at=` puts the playhead there), `/trash`, `/members`, `/signin/:token`,
`/setup`, `/name`.

Words, exactly as the spec has them: **New since you were here**,
**Songs**, **Not named**, **All takes**, **★ at rehearsal**, **Marks and
comments**, **Comment at 1:42**, **Download tracks**, **Sign in**,
**Sign in on another device**, “What should the band call you?”,
**Sign out everywhere**, **Members**, **New link**, **Add member**,
“Not opened yet”, “Ran out”, **Make a key for РЭХА**, **Remove**,
**Trash**, **Restore**, “In the part cut off”.

- [ ] **Step 1: Write the failing tests**

`service/src/player/mp3.test.ts`:

```ts
test("an MP3's frames are found and counted", …) // a short MP3 made with lame-free fixture bytes in test/fixtures/
expect(parseFrames(bytes).samplesPerFrame).toBe(1152)
```

`service/e2e/` (titles in cp1252):

```ts
test("the first screen shows what is new, then the songs", …)
test("with nothing new the new card is not there", …)
test("a take shows the path back to its song", …)          // Viasna > Viasna 12
test("a computer keeps the songs on the left", …)       // 1180x820 and 960x680
test("a phone shows one page at a time with a back arrow", …) // 390x844
test("a song page puts the best take on top", …)
test("a take page has a lane per track with M and S", …)
test("a comment is written at the playhead", …)
test("a closed comment is greyed and stays", …)
test("the star at rehearsal shows apart", …)
test("download tracks says which originals are still coming", …)
test("sign in needs a press, then asks for a name", …)
test("a used link says to ask for a new one", …)
test("members, links and keys are only for the owner", …)
test("trash lists takes and restores them", …)
test("light and dark themes both draw", …)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx vitest run src/player/mp3.test.ts && npx playwright test`
Expected: FAIL.

- [ ] **Step 3: Write the pages and the player**

- [ ] **Step 4: Run the tests again**

Run: `cd service && npx vitest run src/player/mp3.test.ts && npm run build && npx playwright test`
Expected: PASS.

- [ ] **Step 5: Play a real take by hand in the container's Chromium**

Run `npx wrangler dev` with a take uploaded by `test/fixtures/upload.mjs`
(six MP3 tracks made by `make_tracks.py` from the playback test), open it,
press ▶, and check that the time moves and the tracks stay together while
seeking. Expected: they do. Say in the ledger that real devices (Mac,
iPhone, Windows) are still to be checked by Alex.

- [ ] **Step 6: Commit**

```bash
git add service
git commit -m "Band service: the pages and the player"
```

---

### Task 6: РЭХА's band service module

**Files:**
- Create: `src/rehearsal_recorder/sending/band_service.py` (the module), `src/rehearsal_recorder/sending/service_client.py` (HTTP, through `urllib.request` with certifi as `updates.py` does), `src/rehearsal_recorder/sending/service_files.py` (making a take's files and its TakeMeta)
- Create: `src/rehearsal_recorder/store/migrations/versions/0011_band_service.py`
- Modify: `src/rehearsal_recorder/store/models.py` (`ServiceCopy`, `ServiceFile`, `ServiceDelete`), `src/rehearsal_recorder/store/library.py` (the take dict's `"service"`, `_take_record` and `restore_takes` keep `service_copy` as they keep `cloud_copy`)
- Modify: `src/rehearsal_recorder/api.py` (the calls in the shared contract; `self._sending.edited(…)` after `rename_take`, `rename_song`, `merge_songs`, `rename_rehearsal`, naming a take's song, `set_take_star`, `_update_markers`; `self._sending.edited(…, cut_start=start_sec)` after `crop_take`; `self._sending.deleted(records)` where `end_trash` ends a take's or rehearsal's removal; `window_closing()` and `close_anyway()`)
- Modify: `src/rehearsal_recorder/app.py` (`window.events.closing += api.window_closing` after `attach_window`)
- Create: `tests/test_sending.py`, `tests/fake_band_service.py`; Modify: `tests/run_all.py`, `tests/README.md`

**Interfaces:**
- Consumes: Task 1's `Module`, `Sending`; the shared contract's calls.
- Produces: `class BandService(Module)` with `id = "service"`, built as
  `BandService(api, client_factory=ServiceClient)`;
  `parse_key(key) -> (base_url, secret) | None`;
  `class ServiceClient(base_url, secret)` with `hello()`,
  `put_take(uid, meta)`, `start_file(uid, gen, name, size) -> upload_id`,
  `put_part(uid, upload_id, number, gen, name, data) -> etag`,
  `finish_file(uid, upload_id, gen, name, parts)`,
  `ready(uid, gen, what)`, `delete_take(uid)`; it raises `Offline` for a
  network error or a timeout (60 s), `Gone` for a 404 with `gone`, and
  `Refused(words)` for any other 4xx.

РЭХА's tables (migration 0011, revises 0010):

```text
service_copy(take_id PK → take.id ON DELETE CASCADE, uid, gen, pending_cut REAL, due BOOL,
             sent JSON, mp3_gen INT NULL, flac_gen INT NULL, error TEXT NULL)
service_file(take_id → take.id ON DELETE CASCADE, gen, name, path, size, upload_id NULL,
             parts JSON, done BOOL, PRIMARY KEY (take_id, gen, name))
service_delete(uid PK)
```

How it works:

- One worker thread and one take at a time, paused while a take records
  (the same `paused` the cloud folder's queue has). A take is due when its
  row says `due`; `saved` makes the row (with a new uid) and sets `due` if
  the service is chosen and the take is to go: **Send saved takes
  automatically** on and not kept with “not this one”, or kept with “send
  this one” (the take's `cloud_skip` and `cloud_send`, as for the cloud
  folder). `send` sets `due` at once. `edited` sets `due` only for a take
  already in the service, and a crop also adds one to `gen` and `start_sec`
  to `pending_cut`.
- A due take: make its TakeMeta; make the files of its `gen` that are not
  made yet into `~/.rehearsal-recorder/band-service/<uid>/<gen>/` with
  `audio/encode.encode` (MP3, then FLAC), `wav_peaks(…, 1200)` and the
  `.mid` copied, and write a `service_file` row for each; PUT the TakeMeta;
  send every MP3, `.peaks` and `.mid`, then `ready mp3`; then every FLAC,
  then `ready flac`; then `due = False`, `pending_cut = 0`, `sent = meta`,
  and the folder of that generation deleted. A take whose files are all up
  for its `gen` only has its TakeMeta PUT again. Files made for an upload
  are never made again for the same generation (Review Focus 2).
- A file goes in parts of 10,485,760 bytes; after each part its etag is
  written to `service_file.parts` in the same step; a file starts at the
  first part not in `parts`. `Gone` clears `upload_id` and `parts` and
  starts that file again.
- `Offline`: the entry stays running with the step “No internet: carries
  on when it is back”, and the take is tried again after 30 seconds.
  `Refused(words)`: the entry fails with those words and the take's row
  keeps them in `error`; **Retry** sets `due` again.
- The activity entry: kind `"service"`, title `“<take name>” → band
  service`, steps “Making the files” while encoding, then “MP3s: 4 of 6”,
  then “FLAC: 2 of 6”; its fraction is bytes sent over the bytes of the
  generation's files. On start, every due row and every `service_delete`
  row gets a waiting entry at once.
- `remove`: the take's `uid` goes into `service_delete`, its
  `service_copy` row and its folder are deleted; the worker sends the
  DELETE. `deleted(records)`: the same for each record that has a
  `service_copy`. A take deleted in РЭХА reaches the service only through
  `deleted`, which runs when the removal's Undo time has passed (Review
  Focus 5).
- `left()`: the takes still due or to delete, and the bytes of their files
  not up yet. A take whose files are not made yet counts its WAVs' size
  times 0.7 (about what FLAC and MP3 come to together).
- `window_closing()`: True when nothing is left or `close_anyway` was
  pressed; otherwise it starts a thread that calls
  `window.evaluate_js("window.__rehaClosing && window.__rehaClosing()")`
  and returns False, so the window stays and the interface asks.
  `close_anyway()` sets the flag and calls `window.destroy()` from a
  thread. Neither waits on the window from inside the handler.
- `disconnect_service()` stops the worker and deletes every
  `service_copy`, `service_file` and `service_delete` row and the staging
  folder.
- The switch decides where new takes go. A take already being sent to the
  service goes on being sent if the switch moves to the cloud folder.

`tests/fake_band_service.py`: an `http.server` in a thread that keeps
takes, uploads and parts in memory, answers the contract, and can be told
to drop the connection for the next N calls, to forget an upload, or to
refuse with words.

- [ ] **Step 1: Write the failing tests**

`tests/test_sending.py`, in the repository's own style (`ok(label,
cond)`, run by `run_all.py`), on a fresh `Api` with the fake service:

```python
ok("a key in the wrong shape is refused", api.set_service_key("nonsense")["ok"] is False)
ok("a key is kept and picks the service", api.set_service_key(KEY)["ok"] and api.get_settings()["send_to"] == "service")
ok("a saved take goes when automatic sending is on", …)            # fake has 6 .mp3, 6 .flac, 6 .peaks
ok("MP3s go before any FLAC", fake.order.index("ready mp3") < first_flac_index)
ok("part sent twice", …)               # drop after a part is up, before its etag is written; file completes
ok("staged file reused", …)            # stop the worker mid-file, start a new Api on the same folder: same bytes, encode not called again
ok("no internet waits instead of failing", entry["state"] == "running" and entry["step"] == "No internet: carries on when it is back")
ok("a gone upload starts the file again", …)
ok("refused words fail the take in red", entry["state"] == "failed" and entry["error"] == "The band service does not know this key any more")
ok("a rename sends the take's details again, no files", …)
ok("a rename while files go up: the upload goes on, the name follows", …)
ok("a crop sends a new generation with cut_start", fake.takes[uid]["gen"] == 2 and fake.takes[uid]["cut_start"] == 10.0)
ok("undo keeps it", …)                 # delete_take, then undo: no DELETE reaches the fake
ok("a deletion whose undo time passed reaches the trash", …)
ok("remove from the band service sends a delete", …)
ok("waiting takes are back in the list when the app opens", …)
ok("closing with takes left asks first", api.window_closing() is False)
ok("close anyway closes", …)
ok("disconnect forgets the queue", …)
ok("the cloud folder sends nothing new while the service is chosen", …)
```

- [ ] **Step 2: Run them to see them fail**

Run: `python tests/test_sending.py`
Expected: FAIL (no module, no calls).

- [ ] **Step 3: Write the migration, the models, the module, the client and the calls**

- [ ] **Step 4: Run the tests again, and the suites the changed code touches**

Run: `python tests/test_sending.py && python tests/test_store.py && python tests/test_engine.py > /tmp/engine.txt 2>&1; tail -3 /tmp/engine.txt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "Send takes to a band service, part by part, surviving a close"
```

---

### Task 7: РЭХА's interface for the band service

**Files:**
- Create: `ui/src/components/sending/CloudFolderPanel.tsx` (today's Cloud folder rows, moved unchanged from `FoldersSettings.tsx` lines 247-363), `ui/src/components/sending/BandServicePanel.tsx`, `ui/src/components/sending/ServiceKeyLine.tsx`, `ui/src/components/sending/SendingGroup.tsx`, `ui/src/components/ServiceDialog.tsx`, `ui/src/components/ClosingDialog.tsx`
- Modify: `ui/src/components/FoldersSettings.tsx` (draws `SendingGroup` where the Cloud folder group was), `ui/src/lib/api.ts` (the calls and fields in the shared contract), `ui/src/components/TakeStrip.tsx` and `ui/src/components/RehearsalOverview.tsx` (`takeCloudStatus` and the button's words per module), `ui/src/screens/Rehearsal.tsx` and `ui/src/screens/HistoryScreen.tsx` (the cloud button: the share dialog for the cloud folder; for the service, send at once or open `ServiceDialog`), `ui/src/screens/Review.tsx` (the keep line), `ui/src/components/EveningActions.tsx` (Send starred's title), `ui/src/components/ActivityButton.tsx` (Retry for `kind == "service"`), `ui/src/App.tsx` or the shell (mounts `ClosingDialog`)
- Modify: `ui/e2e/fake-bridge.js` (the service's calls and state: `window.__SERVICE_KEY__`, `window.__SERVICE_OFFLINE__`), `ui/e2e/app.ts` if a helper is needed
- Create: `ui/e2e/band-service.spec.ts`

**Interfaces:**
- Consumes: the shared contract's calls and fields.

What it shows, word for word:

- No key: the group **Cloud folder** as today, and at its bottom a quiet
  line **I have a band service key**. Pressed, it opens above a field:
  “A band service is a private web page where your band listens to its
  takes track by track, stars the good ones and talks about them. Whoever
  runs it gives you a key to paste here. You can run one for your own band
  too: **How it works**.” **How it works** opens
  https://reha.stream/band-service in the browser, the way the app opens
  its other web links. The field's button is **Connect**; a refused key
  shows the answer's words under the field.
- With a key: the group **Sending takes**, its first row the switch
  **Send takes to** with **Cloud folder** and **Band service**, and under it
  only the chosen module's panel. **Band service** panel: the address and
  **Disconnect**; “Every track goes up as MP3 to listen to and FLAC as
  recorded, with its notes as .mid and the take's marks.”; and its own
  **Send saved takes automatically**. A key kept unchecked adds “Not
  checked yet: the band service could not be reached.”
- A take's cloud button, service chosen: sends at once; on a take in the
  service it opens “<take name>” in the band service (curly quotes), which
  lists each track with what of it is up (“MP3 and FLAC”, “MP3, FLAC on
  its way”) and has **Remove from the band service**.
- The take's status: “Sending to the band service”, “Waiting for the band
  service”, and “Not in the band service” when it failed.
- The keep line in Review, service chosen: “Send to the band service”
  with its box, which starts ticked when the service's **Send saved takes
  automatically** is on.
- Send starred's title, service chosen: “Send every ★ take to the band
  service”.
- The background work list: the service's entries as the cloud folder's,
  with **Retry** on a failed one.
- Closing with takes left: a dialog “Still sending 3 takes to the band
  service, 1.2 GB left. The rest goes the next time РЭХА is open.” with
  **Close anyway** and **Keep sending** (the size through `formatBytes`).

- [ ] **Step 1: Write the failing tests**

`ui/e2e/band-service.spec.ts`:

```ts
test("without a key the cloud folder group is as before", …)
test("the key line explains the key and links to how it works", …)
test("a wrong key says why", …)
test("a key turns the group into Sending takes with a switch", …)
test("the switch shows only the chosen module's panel", …)
test("each panel keeps its own settings", …)
test("disconnect puts the group back as it was", …)
test("the cloud button sends to the service at once", …)
test("a take in the service opens its dialog with Remove", …)
test("the take says it is waiting for the band service", …)
test("the background list shows MP3s and FLAC counts", …)
test("no internet is said, not failed", …)
test("a failed send has Retry", …)
test("closing with takes left asks first", …)
test("close anyway closes, keep sending stays", …)
test("1180x820 and 960x680, light and dark", …)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ui && npm run build && npx playwright test e2e/band-service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Write the components and the fake's side**

- [ ] **Step 4: Run them again, with the specs the moved rows and buttons touch**

Run: `cd ui && npm run build && npx playwright test e2e/band-service.spec.ts e2e/cloud.spec.ts e2e/settings.spec.ts e2e/evening.spec.ts e2e/review.spec.ts && npm test && npm run design-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui
git commit -m "Settings: a switch between the cloud folder and a band service"
```

---

### Task 8: CI and going live

**Files:**
- Modify: `.github/workflows/checks.yml` (an output `service`: true for `service/*`, `ui/*` and `checks.yml`; a job `service` that runs `npm ci`, `npm run typecheck`, `npx vitest run`, `npm run build`, the browser install and `npx playwright test` in `service/`)
- Modify: `.github/workflows/release.yml` (a job `service · deploy` after both builds, not on a pre-release, and a choice “Put the service up again” for running it by hand)
- Create: `service/scripts/deploy.mjs`
- Modify: `service/README.md` (what the job needs)

**Interfaces:**
- `deploy.mjs` reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and the
  optional `SERVICE_DOMAIN`. It finds the D1 database `reha-band` with
  `wrangler d1 list --json`, creating it with `wrangler d1 create
  reha-band` when there is none, and the R2 bucket `reha-band` the same
  way; writes the database's id into `wrangler.jsonc` and, when
  `SERVICE_DOMAIN` is set, `routes: [{"pattern": <domain>,
  "custom_domain": true}]`; then runs `npm run build`, `wrangler d1
  migrations apply reha-band --remote` and `wrangler deploy`. The edited
  `wrangler.jsonc` is never committed: it lives only in the job's
  checkout.
- The deploy job, with no `CLOUDFLARE_API_TOKEN` secret, writes a notice
  and succeeds without deploying, so a release made before the service is
  set up is not red.
- GitHub: secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; the
  repository variable `SERVICE_DOMAIN`. The Worker's own secrets are set in
  Cloudflare (the shared contract).

- [ ] **Step 1: Check the deploy script without Cloudflare**

`service/scripts/deploy.test.mjs` runs `deploy.mjs` with a fake `wrangler`
on `PATH` that records its arguments and prints a made-up `d1 list`.

```js
test("the database id and the domain go into the config", …)
test("no domain keeps workers.dev only", …)
test("a missing database is created first", …)
```

Run: `cd service && node --test scripts/deploy.test.mjs`
Expected: FAIL, then PASS once `deploy.mjs` is written.

- [ ] **Step 2: Write the jobs**

- [ ] **Step 3: Push the branch and let CI run once**

Expected: every check green, the new `service` job among them.

- [ ] **Step 4: Commit**

```bash
git add .github service/scripts service/README.md
git commit -m "CI: check the band service, and put it up with a release"
```

---

### Task 9: The page reha.stream/band-service

**Files:**
- Create: `site/content/band-service.md`
- Modify: `site/vite.config.ts` and `site/src/stories/render.tsx` (or a small renderer beside it) so the page is written whole at build time, the way a story page is, at `band-service.html`
- Modify: `site/src/page/Footer.tsx` (a link **Band service**), `site/src/content/seo.ts` (sitemap), `site/vercel-config.json` (`^/band-service/?$` to `/band-service.html`, case-sensitive), `site/src/page/vercel-config.test.ts`
- Create: `site/e2e/band-service.spec.ts`

What the page holds, in this order (spec, “On reha.stream”):

1. What a band service is, in a few lines.
2. A story from Alex's band of how they use it, first person, in the
   manner of the site's stories. Every made-up detail is listed in the
   pull request for Alex to check before it goes live.
3. **Run your own**: what it needs (a Cloudflare account; a Telegram bot,
   only for the chat's messages), what it costs (files up to 10 GB free,
   then $0.015 per GB a month), and the steps one by one, for a musician:
   make a GitHub account and fork РЭХА's repository; make a Cloudflare
   account and an API token (the permissions named one by one); put the
   token and the account id in the fork's secrets; run **Put the service
   up again** in the fork's Actions; set `SETUP_SECRET` (and the bot's two,
   if wanted) in Cloudflare; open `/setup` at the address Cloudflare gave
   (on workers.dev); add the members and send them their links; make a key
   and paste it into РЭХА. A band's own domain is not needed.
4. That the code is open, under FSL, with a link to `service/` on GitHub.

The words are checked with the humanizer skill before the commit.

- [ ] **Step 1: Write the failing test**

```ts
test("the band service page is there and linked from the footer", …)
test("the page is in the sitemap", …)
test("the steps are numbered and name the cost", …)
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd site && npm run build && npx playwright test e2e/band-service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Write the page**

- [ ] **Step 4: Run it again, with the site's unit tests**

Run: `cd site && npm run build && npx playwright test e2e/band-service.spec.ts e2e/page.spec.ts && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site
git commit -m "Site: a page on the band service and how to run your own"
```

---

### Task 10: The guide and the changelog

**Files:**
- Modify: `docs/using-it.md` (a section “Sending takes to a band service” after “Sending takes to the cloud”; one line each where the guide says what a rename, a crop or a delete does to the cloud copy)
- Modify: `CHANGELOG.md` (an item under “Unreleased” that starts in bold)

The section says what a key is and where it goes, the **Send takes to**
switch, what goes up, the take's cloud button and its dialog, following
the sending in the background list, closing РЭХА while it sends, and
**Disconnect**; it links to reha.stream/band-service for what the service
is and how to run your own. Button names in bold; curly double quotes,
straight apostrophes. Checked with the humanizer skill.

- [ ] **Step 1: Write the section and the item**
- [ ] **Step 2: Check the site's news line still reads the first item**

Run: `cd site && npx vitest run src/content/changelog.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/using-it.md CHANGELOG.md
git commit -m "Guide: sending takes to a band service"
```

---

### Task 11: Setting it up, with Alex

Not code. Once the pull request is merged and released, Claude gives Alex
the steps one at a time and waits for each:

1. reha.stream added to Cloudflare; every DNS record copied as it is,
   unproxied (the site's records for Vercel and the TXT record for Google
   Search Console); the nameservers changed at the registrar; the site
   checked on reha.stream.
2. A Telegram bot from BotFather, added to the band's group; the chat's id.
3. An API token in Cloudflare; GitHub secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`, the variable `SERVICE_DOMAIN` set to
   band.reha.stream; **Put the service up again** run in Actions.
4. `SETUP_SECRET`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` set on the
   Worker in Cloudflare.
5. band.reha.stream/setup; the members added and their links sent; a key
   made and pasted into РЭХА at the rehearsal room.

Whatever in the site's **Run your own** steps turns out wrong while Alex
follows them is fixed on the page before it goes live.

---

## How the tasks depend on each other

- Task 1 comes before Tasks 6 and 7.
- Tasks 2, 3, 4 and 5 come in that order and need nothing from РЭХА's side
  but the shared contract, so they can run beside Tasks 1, 6 and 7 in their
  own worktree.
- Task 9 needs nothing else and can run beside either line.
- Task 8 comes after Task 5; Task 10 after Task 7; Task 11 after the
  release.
- Everything goes in one pull request, which waits for Alex's word before
  it is merged.

## Calls made in this plan

Decisions the spec left open, made here and listed for Alex to check:

1. Files are named by the track's place in the take. A crop makes a new
   generation of them; the service plays the old files until the new MP3s
   are all up, then moves the comments.
2. A waveform file holds 1200 points per track.
3. A rehearsal's id in the service is made from its date and its row in
   РЭХА, so РЭХА needs no table for it.
4. The trash is emptied once a day by a Cron Trigger, Cloudflare's own
   way of running a job on a schedule (free: 5 per account). A take may
   stay up to a day longer than 30 days.
5. A mark from РЭХА is kept as a comment from РЭХА, so it can be answered
   and closed like any comment.
6. Pasting a key picks **Band service** at once. The service's **Send saved
   takes automatically** starts off, as the cloud folder's does.
7. The key's field has a **Connect** button. A key that cannot be checked
   for want of internet is kept, with “Not checked yet: the band service
   could not be reached.”
8. Words the spec did not give: “Not in the band service” on a take that
   failed; “Send every ★ take to the band service” on **Send starred**; the
   panel's sentence on what goes up; “Making the files” while the MP3 and
   FLAC files are made.
9. A take being sent goes on being sent if the switch moves back to the
   cloud folder. **Disconnect** stops it and forgets it.
10. A browser that cannot decode MP3 through WebCodecs gets a message,
    not a slower way of playing.
11. РЭХА's sending is tested in the repository's own style of Python suite
    (`tests/test_sending.py`, run by `run_all.py`), against a fake service;
    the repository has no pytest.
12. The release job finds or makes the D1 database and the R2 bucket,
    both called `reha-band`, and takes the address from the GitHub
    variable `SERVICE_DOMAIN`. A release made before the service is set up
    skips the deploy instead of failing.
13. **Run your own** on the site goes through a fork of the repository on
    GitHub and its Actions, the same way Alex's copy is put up, so the
    steps are tried for real.
14. The closing question counts files not made yet as 0.7 of their WAVs'
    size.
15. A member's name is 1 to 40 characters, a comment 1 to 2000.
16. All of it goes in one pull request.
17. The Worker's routes are written with Hono, the small router
    Cloudflare's own examples use on Workers; the pages' few paths need no
    library.
