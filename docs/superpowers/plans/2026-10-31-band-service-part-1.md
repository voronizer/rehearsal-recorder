# The band's service, part 1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private web page at the band's own address where the band
listens to its takes track by track, stars them and comments at a moment,
with РЭХА sending the takes there and a bot telling the band's Telegram chat.

**Architecture:** One Cloudflare Worker in `service/`, in TypeScript,
serves the pages and the API. Its code is a folder per feature (sign-in,
members, takes, comments, uploads, files, chat). The routes are Hono with
zod schemas (`@hono/zod-openapi`): the same schemas check what comes in,
give the pages their types through Hono RPC, and make the OpenAPI
description that РЭХА's tests check every request against. better-auth
signs members in with a 6-digit code by email, keeps their sessions, makes
the owner an admin and makes РЭХА's keys. D1, Cloudflare's database, holds
everything that is not audio, through Drizzle; R2, Cloudflare's file
storage, holds each take's files: every track's MP3, FLAC, waveform and
`.mid`. Letters go through Cloudflare's Email Service to addresses on
Cloudflare's confirmed list, which the service keeps itself through
Cloudflare's API. The bot's messages go through a Cloudflare Queue, so a
Telegram failure is tried again. The pages are React with the design
system from `ui/src`, TanStack Router and TanStack Query. In РЭХА, a new
`sending/` package holds two modules behind one interface, the cloud
folder (moved, unchanged) and the band service (new); Settings › Folders
draws a switch and the chosen module's own panel.

**Tech Stack:** Python 3.10+ (urllib with certifi, SQLAlchemy + Alembic,
libsndfile through `soundfile`; `openapi-core` in the tests only), React 19
+ Vite 8 + Tailwind 4, TanStack Router and TanStack Query, Cloudflare
Workers + D1 + R2 + Queues + Email Service + a Cron Trigger, Hono with
`@hono/zod-openapi` and zod 4, better-auth with its emailOTP, admin and API
Key plugins, Drizzle ORM (drizzle-kit makes the migrations),
`@cloudflare/vite-plugin`, wrangler 4, `@cloudflare/vitest-plugin` with
vitest 5, Playwright, the Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-10-30-band-service-part-1-design.md`
(approved 31 October at 16:33, and again with sign-in by email at 18:43).
The architecture rounds, each question with Alex's answer:
`/mnt/project-files/band-service/part-1/architecture.md`. Mockups of the
pages: https://claude.ai/artifact/SZKv2ssjChEjWWsrnKWkqK (option Б),
sources in `/mnt/project-files/band-service/part-1/mockup-src/`. The
playback test of 24 October:
`/mnt/project-files/band-service/playback-test/index.html`.

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
- Nothing in the code names band.reha.stream, reha.stream, Alex's address
  or Alex's band. The address, the letters' sender, the owner, the bot and
  the chat come from each copy's own settings.
- Each feature is its own module with its own settings panel; a switch
  picks the module; no rows hidden by conditions. In `service/`, each
  feature is its own folder with its routes, logic and queries; only the
  Drizzle schema is shared, in one file.
- Use the library's own way before writing one's own: better-auth for
  sign-in, sessions, the owner's rights and keys; Drizzle for every query;
  zod for every check of what comes in.
- Values the spec fixes: a code is 6 digits, lasts 10 minutes and dies
  after 5 wrong tries; a session lasts 365 days from the last visit, moved
  on at most once a day; a take stays in the trash 30 days; a chat message
  takes additions for 3 hours; the same failure is told to Alex at most
  once an hour; a part is 10 MiB (10,485,760 bytes), the last part of a
  file may be smaller; the cookie is HttpOnly, Secure, SameSite=Lax;
  РЭХА's keys are kept only as hashes.
- For the service РЭХА sends each track as MP3 and FLAC, its `.mid` where it
  recorded notes, and a waveform file. No mix file. Every MP3 of a take
  goes before any FLAC.
- Versions are pinned exactly in `service/package.json`: wrangler 4.156.0,
  `@cloudflare/vite-plugin` 1.66.0, `@cloudflare/vitest-plugin` 1.4.11,
  `@cloudflare/workers-types` 5.20261031.1, vitest 5.0.5, `hono` 4.13.14,
  `@hono/zod-openapi` 1.6.3, `zod` 4.6.7, `drizzle-orm` 0.45.4,
  `drizzle-kit` 0.31.11, `better-auth` 1.7.14, `@better-auth/api-key`
  1.7.14, `auth` (better-auth's CLI) 1.7.14, `@tanstack/react-router`
  1.170.46, `@tanstack/react-query` 5.105.0; React, Vite, Tailwind and
  Playwright at the versions `ui/package.json` uses. In РЭХА's tests,
  `openapi-core` 0.23.1, never in РЭХА itself.

## Review Focus

1. РЭХА's key meets the API Key plugin's own default limit of 10 requests
   a day, and the upload of a rehearsal (about 450 requests) stops after
   ten. Expected: keys are made with the plugin's rate limit off, and 30
   requests in a row with one key all pass. (Task 2: “a key is not
   limited”.)
2. РЭХА is closed or the laptop sleeps between a part arriving and РЭХА
   writing its etag down, then РЭХА opens again. Expected: that part is
   sent again under the same number, R2 keeps the later one, the bytes are
   the very bytes sent before (the MP3 and FLAC made for the upload stay on
   disk until it completes and are never made again for the same
   generation), and the file completes. (Task 6: “part sent twice”,
   “staged file reused”.)
3. A take is deleted in РЭХА and brought back with **Undo** before its
   notice ends. Expected: nothing happens in the service; only a deletion
   whose Undo time passed moves the take to the service's trash. (Task 6:
   “undo keeps it”.)
4. A member types “ Ira@Gmail.com ” while Alex added “ira@gmail.com”.
   Expected: the same member, everywhere: the code, the members' table,
   Cloudflare's list. Addresses are trimmed and lower-cased on the way in.
   (Task 2: “an address is the same whatever its case”.)
5. A member is removed while their tab is open, or presses **Send code**
   twice. Expected: the removed member's next request answers 401 and the
   page goes to sign-in, while their stars and comments stay under their
   name; of two codes only the newer one works. (Task 2: “remove ends the
   sessions and keeps the comments”, “a newer code replaces the older”;
   Task 5: “a removed member is sent to sign-in”.)

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
optional `:port`; the secret is the key better-auth's API Key plugin made,
which has no `:` in it. The service is reached at `https://<address>`, or
`http://<address>` when the host is `localhost` or `127.0.0.1` (tests and
`wrangler dev`).

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

Every call carries `x-api-key: <secret>` (the API Key plugin's header) and
`X-Reha-Version: <РЭХА's version>`, such as `0.17.0`. Bodies are JSON
except a part, which is `application/octet-stream`. An error is a 4xx with
`{"error": "<words a musician reads>"}`; an upload R2 no longer has is a
404 with `"gone": true`. A РЭХА older than the service's
`MIN_REHA_VERSION` (a constant in `service/worker/shared/version.ts`), or
a request with no version, gets 426 with `{"error": "Update РЭХА to send
takes here"}`. `MIN_REHA_VERSION` is `"0.0.0"` to begin with: the service
only ever adds fields, so it goes up only when a change cannot work with
an older РЭХА. Versions compare by their leading `X.Y.Z`, so
`0.17.1.dev4+gabc` (a clone between releases) counts as 0.17.1, and
`unknown` (a clone never installed, running the code as it is now) is
never too old.

Every route below is described in `/api/openapi.json`, made from the same
zod schemas that check it; `service/openapi.json` is that file, kept in
the repository for РЭХА's tests.

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

Signing in goes through better-auth's own routes under `/api/auth/*`,
called from the pages through better-auth's React client with
`emailOTPClient()`: `emailOtp.sendVerificationOtp({email, type:
"sign-in"})`, `signIn.emailOtp({email, otp})`, `signOut()`. Everything
else goes through Hono RPC (`hc<AppType>`), wrapped in TanStack Query.

| Call | Answer |
|---|---|
| `emailOtp.sendVerificationOtp` | `{"success": true}` for any address; for an address in the band that Cloudflare has not had confirmed, 400 with code `CONFIRM_FIRST` and the message “First confirm your address: look for a letter from Cloudflare, then press Send code again” |
| `signIn.emailOtp` | sets the session cookie; a wrong or old code as better-auth answers it, shown as “That code does not work. Press Send code for a new one.” |
| `GET /api/me` | `{"id", "name", "owner": bool}`; `name` is `""` until the member gives one; no session 401 |
| `PUT /api/me` `{"name"}` | `{"ok": true}` |
| `GET /api/feed` | `{"new": {"takes": [TakeRow], "comments": [CommentRow]}, "new_count": int, "songs": [SongRow], "not_named": SongRow \| null, "start": {"kind": "new" \| "song", "id"}}` |
| `GET /api/songs/:id` (`not-named` for takes with no song) | `{"song", "best": TakeRow \| null, "takes": [TakeRow]}` |
| `GET /api/takes/:uid` | the take with tracks, peaks keys, members' stars, `starred_at_rehearsal`, comments with replies, files with what is still coming |
| `POST` / `DELETE /api/takes/:uid/star` | `{"ok": true}` |
| `POST /api/takes/:uid/seen` | `{"ok": true}` |
| `POST /api/takes/:uid/comments` `{"at", "text", "parent_id"?}` | the comment |
| `PATCH /api/comments/:id` `{"closed": bool}` | `{"ok": true}` |
| `GET /api/trash`, `POST /api/trash/:uid/restore` | the trashed takes; `{"ok": true}` |
| `GET /files/<uid>/<gen>/<name>` | the file from R2, with `Range`; `?download=1` names it “Viasna 12 - Bass.flac” |
| Owner only: `GET /api/members` | `[{"id", "email", "name", "confirmed": bool, "signed_in": bool}]` |
| Owner only: `POST /api/members` `{"email"}` | the member; the address goes on Cloudflare's list |
| Owner only: `POST /api/members/:id/signout` | `{"ok": true}`, every session of theirs ended |
| Owner only: `DELETE /api/members/:id` | `{"ok": true}`: **Remove** |
| Owner only: `GET /api/keys`, `POST /api/keys` `{"name"}`, `DELETE /api/keys/:id` | the keys by name; a new key `{"key": "<host>:<secret>"}` shown once; `{"ok": true}` |

### The service's D1 tables

The tables are written as a Drizzle schema in
`service/worker/shared/schema.ts`, the one place they are described, as
РЭХА's are in `store/models.py`. `npx drizzle-kit generate` makes the SQL
migration from it into `service/migrations/`. Every query goes through
Drizzle; a change of several rows that must happen together goes through
`db.batch([...])`, which D1 runs as one transaction.

better-auth's tables come first, written exactly as `npx auth@1.7.14
generate` prints them for Drizzle and SQLite with the plugins in use:
`user` (with the admin plugin's `role`, `banned`, `banReason`,
`banExpires`), `session` (with `impersonatedBy`), `account`,
`verification`, `apikey` and `rateLimit`. A member is a `user` row; their
`name` is `""` until they type it. Then the service's own:

```sql
rehearsal(uid TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL)
song(id INTEGER PRIMARY KEY, title TEXT NOT NULL UNIQUE COLLATE NOCASE)
take(uid TEXT PRIMARY KEY, rehearsal_uid TEXT NOT NULL REFERENCES rehearsal(uid), number INTEGER NOT NULL,
     song_id INTEGER REFERENCES song(id), name TEXT NOT NULL, duration_sec REAL NOT NULL,
     starred_at_rehearsal INTEGER NOT NULL DEFAULT 0, balance TEXT NOT NULL, tracks TEXT NOT NULL,
     notes TEXT NOT NULL, gen INTEGER NOT NULL, shown_gen INTEGER, flac_gen INTEGER,
     pending_cut REAL NOT NULL DEFAULT 0, shown_at TEXT, trashed_at TEXT, updated_at TEXT NOT NULL)
comment(id INTEGER PRIMARY KEY, take_uid TEXT NOT NULL REFERENCES take(uid) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES comment(id) ON DELETE CASCADE, member_id TEXT REFERENCES user(id),
        at REAL NOT NULL, text TEXT NOT NULL, label TEXT, colour TEXT, from_reha INTEGER NOT NULL DEFAULT 0,
        closed INTEGER NOT NULL DEFAULT 0, cut_off INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)
star(take_uid TEXT NOT NULL REFERENCES take(uid) ON DELETE CASCADE,
     member_id TEXT NOT NULL REFERENCES user(id), PRIMARY KEY (take_uid, member_id))
seen(member_id TEXT NOT NULL REFERENCES user(id),
     take_uid TEXT NOT NULL REFERENCES take(uid) ON DELETE CASCADE, seen_at TEXT NOT NULL,
     PRIMARY KEY (member_id, take_uid))
chat(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, about TEXT NOT NULL, message_id INTEGER NOT NULL,
     text TEXT NOT NULL, started_at TEXT NOT NULL)
failure_notice(what TEXT PRIMARY KEY, told_at TEXT NOT NULL)
```

A mark from РЭХА is a `comment` row with `from_reha = 1`, its label and
colour, `member_id` null and its note as `text`: one thing with a comment,
as the concept has it, so it can be answered and closed too. A member is
never deleted, only banned by **Remove**, so their stars and comments keep
their name.

### The service's settings

Set on the Worker in Cloudflare. `wrangler.jsonc` has `keep_vars: true`,
so a deploy leaves them as they are.

| Name | Kind | Meaning |
|---|---|---|
| `BETTER_AUTH_SECRET` | secret, required | better-auth signs its cookies with it |
| `OWNER_EMAIL` | variable, required | the owner's address; the first code asked for it makes the owner |
| `LETTERS_FROM` | variable, required | the letters' sender, on a domain with Cloudflare's mail on |
| `CF_ACCOUNT_ID`, `CF_ADDRESSES_TOKEN` | variable, secret | for Cloudflare's list of confirmed addresses; the token may only edit that list. Without them **Add member** answers “Add the Cloudflare token for addresses first” |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `OWNER_TELEGRAM_ID` | secret, variables | the bot, the band's chat and Alex for failures; without the token nothing is posted |

Bindings: `DB` (D1), `FILES` (R2), `ASSETS`, `LETTERS` (`send_email`, no
fixed destination), `CHAT` (a queue, `reha-band-chat`, that the same
Worker consumes with `max_batch_size: 10`, `max_concurrency: 1`,
`max_retries: 5`). `observability.enabled: true` keeps Workers Logs.

`wrangler.jsonc` also has an environment `test`, used only by `wrangler
dev --env test` for the page tests: `STAND_INS: "on"`, `OWNER_EMAIL:
"alex@example.com"`, `LETTERS_FROM: "band@example.com"`, a made-up
`BETTER_AUTH_SECRET`. With `STAND_INS` on, letters, Cloudflare's list and
Telegram go to stand-ins that keep what they get in memory, and the routes
`/api/stand-ins/*` read them; with it off those routes answer 404.

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
- Create: `service/package.json`, `service/LICENSE` (FSL-1.1-MIT), `service/README.md`, `service/wrangler.jsonc`, `service/vite.config.ts`, `service/vitest.config.ts`, `service/tsconfig.json`, `service/index.html`, `service/drizzle.config.ts` (`dialect: "sqlite"`, `schema: "./worker/shared/schema.ts"`, `out: "./migrations"`), `service/worker-configuration.d.ts` (made by `npx wrangler types`)
- Create: `service/worker/index.ts` (the `OpenAPIHono` app, exported as `{fetch: app.fetch, scheduled, queue}`, and `export type AppType`)
- Create: `service/worker/shared/` `schema.ts`, `db.ts` (`database(env)`: `drizzle(env.DB, { schema })`), `time.ts`, `version.ts`, `errors.ts`, `openapi.ts` (serves `/api/openapi.json`)
- Create: `service/worker/signin/` `auth.ts`, `letters.ts`, `addresses.ts`, `guards.ts`, `routes.ts` (`/api/me`), `stand-ins.ts`
- Create: `service/worker/members/routes.ts` (members and keys)
- Create: `service/migrations/0000_…sql`, made by `npx drizzle-kit generate`, with its `meta/` snapshot
- Create: `service/scripts/openapi.mjs` (writes `service/openapi.json`), `service/openapi.json`
- Create: `service/test/apply-migrations.ts`, `service/test/signin.test.ts`, `service/test/members.test.ts`, `service/test/openapi.test.ts`

**Interfaces:**
- Produces, in `signin/auth.ts`: `makeAuth(env: Env, origin: string,
  parts: {letters: Letters, addresses: AddressList})`, built per request
  (bindings exist only inside a request), with `baseURL: origin`,
  `secret: env.BETTER_AUTH_SECRET`, `database: drizzleAdapter(db,
  {provider: "sqlite", schema})`, `session: {expiresIn: 365 days,
  updateAge: 1 day}`, `rateLimit: {enabled: true, storage: "database"}`,
  and the plugins `emailOTP({otpLength: 6, expiresIn: 600,
  allowedAttempts: 5, disableSignUp: true, sendVerificationOTP})`,
  `admin()` and `apiKey({rateLimit: {enabled: false}})`. Codes are kept
  hashed if the plugin's reference offers it (`storeOTP`); check it there.
- Produces, in `signin/letters.ts`: `interface Letters { send(to: string,
  subject: string, text: string): Promise<void> }`, `cloudflareLetters(env)`
  through `env.LETTERS.send({to, from: env.LETTERS_FROM, subject, text})`,
  and `keptLetters` (the stand-in).
- Produces, in `signin/addresses.ts`: `interface AddressList { add(email):
  Promise<void>; remove(email): Promise<void>; confirmed(emails: string[]):
  Promise<Set<string>> }`, `cloudflareAddresses(env)` through
  `https://api.cloudflare.com/client/v4/accounts/<CF_ACCOUNT_ID>/email/routing/addresses`
  (POST `{email}`; GET, page by page, where an address is confirmed when
  its `verified` is set; DELETE `/<id>`), and `keptAddresses` (the
  stand-in, which confirms an address when
  `POST /api/stand-ins/confirm {email}` says so, or at once when added with
  `?confirmed=1`). Check the field names against Cloudflare's API
  reference before writing.
- Produces, in `signin/guards.ts`: `normaliseEmail(s: string): string`
  (trimmed, lower-cased), and the Hono middleware `needMember` (sets
  `c.var.member` from `auth.api.getSession`, or 401), `needOwner` (role
  `admin`, or 403) and `needKey` (checks `x-api-key` with
  `auth.api.verifyApiKey`, or 401; checks `X-Reha-Version` with
  `tooOld(version: string | undefined, min: string): boolean` from
  `shared/version.ts`, or 426).
- Produces: `now(): Date` in `shared/time.ts` (one place tests replace),
  and `app`, the `OpenAPIHono<{ Bindings: Env }>` that Tasks 3 and 4 add
  their routes to. Each feature folder exports a sub-app built by chained
  `.openapi(createRoute(…), handler)` calls, and `index.ts` mounts them
  with `app.route()`, so `AppType` carries every route for `hc`.
  better-auth's handler is mounted at `/api/auth/*`.
- `wrangler.jsonc`: `name: "reha-band"`, `main: "worker/index.ts"`,
  `compatibility_date: "2026-10-15"`, assets with
  `not_found_handling: "single-page-application"`, `binding: "ASSETS"`,
  `run_worker_first: ["/api/*", "/files/*"]`; D1 binding `DB`
  (`database_name: "reha-band"`, `database_id: "local"`,
  `migrations_dir: "migrations"`); R2 binding `FILES`
  (`bucket_name: "reha-band"`); `send_email: [{"name": "LETTERS"}]`; the
  queue `reha-band-chat` as producer `CHAT` and as consumer, with the
  values in the shared contract; `triggers: {"crons": ["17 4 * * *"]}`
  (once a day, for emptying the trash); `observability: {"enabled":
  true}`; `keep_vars: true`; `workers_dev: true`; no `routes`; the
  environment `test` from the shared contract.

Before better-auth sees a request to
`/api/auth/email-otp/send-verification-otp`, a middleware makes the
owner's user (`role: "admin"`, `name: ""`) when the address is
`OWNER_EMAIL` and no user has it yet: with `disableSignUp`, better-auth may
not call `sendVerificationOTP` for an address it does not know. The page
trims and lower-cases the address before sending it, and the service
normalises it again wherever it takes one. Then `sendVerificationOTP({email,
otp, type})` decides:

- Not a user, or a banned user: send nothing and return, so the answer is
  the same as for a member.
- A user whose address `addresses.confirmed` does not hold: `remove` and
  `add` it again (Cloudflare then sends its letter again; the spec's Call
  4 has this checked on the first real setup) and throw `APIError` 400
  with code `CONFIRM_FIRST` and the words in the shared contract.
- Otherwise `letters.send(email, "<otp> is your code for <host>", "Your
  code is <otp>. It works for 10 minutes.\n\nIf you did not ask for it,
  you can ignore this letter.")`.

Rules the tests pin:

- **Add member** makes a `user` with `role: "user"` and `name: ""`, and
  `add`s the address. A second **Add member** with the same address, in
  any case, answers 409 “This address is already in the band”.
- **Sign out everywhere** is `auth.api.revokeUserSessions`. **Remove** is
  `auth.api.banUser` with no end, which also ends every session, then
  `addresses.remove`. Neither works on the owner.
- `GET /api/members` lists every member but the banned ones, with
  `confirmed` from `addresses.confirmed` (one call for the whole list) and
  `signed_in` from the user's `emailVerified`.
- A key is made with `auth.api.createApiKey({body: {name, userId: <the
  owner's id>}})`, no end, no limit, and shown once as
  `<host>:<key>`, where `<host>` is the request's own host.
- A member's first sign-in leaves `name` `""` until `PUT /api/me` gives
  one; the name is 1 to 40 characters after trimming.
- `/api/stand-ins/*` answers 404 unless `STAND_INS` is `"on"`.

- [ ] **Step 1: Write the failing tests**

`service/test/signin.test.ts`, each against `exports.default.fetch` with
migrations applied and the stand-ins passed in:

```ts
test("the owner's first code makes the owner", …)        // owner gets role admin, name ""
test("a member gets a code and signs in", …)              // the stand-in's letter holds 6 digits
test("an address not in the band gets the same answer and no letter", …)
test("an address is the same whatever its case", …)      // " Ira@Gmail.com " finds ira@gmail.com
test("an unconfirmed address is told to confirm first", …) // 400 CONFIRM_FIRST; remove then add on the list
test("a code runs out after 10 minutes", …)              // now() + 10 min + 1 s
test("five wrong codes kill it", …)
test("a newer code replaces the older", …)
test("the session moves on with a visit a day later", …) // expiry = visit + 365 days
test("a banned member gets no code", …)
```

`service/test/members.test.ts`:

```ts
test("only the owner sees members", …)                   // a member gets 403
test("add member puts the address on the list", …)
test("the same address twice is refused", …)             // 409, any case
test("members show who has confirmed and signed in", …)
test("sign out everywhere ends every session", …)
test("remove ends the sessions and keeps the comments", …)
test("the owner cannot be removed", …)
test("a key is shown once and works for /api/reha/hello", …)
test("a key is not limited", …)                          // 30 requests in a row, all 200
test("a removed key no longer works", …)                 // 401
test("a request with no version is told to update", …)  // 426 with the words
test("versions compare by their release", …)            // tooOld("0.16.1","0.17.0") true; "0.17.1.dev4+gabc" and "unknown" false
test("stand-in routes are not there without STAND_INS", …)
```

`service/test/openapi.test.ts`:

```ts
test("openapi.json in the repository is what the Worker serves", …)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npm ci && npx vitest run test/signin.test.ts test/members.test.ts test/openapi.test.ts`
Expected: FAIL, the routes do not exist yet.

- [ ] **Step 3: Write the frame, the tables, better-auth's set-up and the routes**

better-auth's tables go into `schema.ts` as `npx auth@1.7.14 generate
--config worker/signin/auth.ts` prints them; the service's own follow. Then
`npx drizzle-kit generate`, `npm run openapi`.

- [ ] **Step 4: Run the tests again**

Run: `cd service && npx vitest run test/signin.test.ts test/members.test.ts test/openapi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add service
git commit -m "Band service: its frame, tables, sign-in by email, members and keys"
```

---

### Task 3: The service's side for РЭХА, and the band's chat

**Files:**
- Create: `service/worker/takes/` `reha-routes.ts` (`PUT` and `DELETE /api/reha/takes/:uid`, `ready`, `hello`), `store.ts` (upserting a take, switching generations, the comment shift), `purge.ts`
- Create: `service/worker/uploads/routes.ts` (the three file routes)
- Create: `service/worker/chat/` `tell.ts` (puts events on the queue), `consume.ts` (the queue's consumer), `telegram.ts` (the Bot API, and the stand-in), `failures.ts`
- Create: `service/test/reha.test.ts`, `service/test/chat.test.ts`

**Interfaces:**
- Consumes: Task 2's `needKey`, `now`, `database`, `app`.
- Produces: `putTake(env, uid, meta: TakeMeta)`, `ready(env, uid, gen,
  what)`, `trash(env, uid)`, `shiftComments(env, uid, cutStart)`;
  `tellChat(env, event: ChatEvent)` where `ChatEvent = {kind: "take",
  take_uid} | {kind: "comment", comment_id} | {kind: "failure", what:
  string, detail: string}`, which only puts the event on `env.CHAT`;
  `consumeChat(batch, env, telegram)` with `telegram = {send(chatId, text):
  Promise<number>, edit(chatId, messageId, text): Promise<void>}`;
  `reportFailure(env, what, error)`, called from `app.onError`, the
  `scheduled` handler and the queue's own errors, which logs the error and
  calls `tellChat` with `{kind: "failure"}`; `purgeTrash(env)` deleting
  takes trashed more than 30 days ago with their R2 objects (by listing
  `takes/<uid>/`).

Rules the tests pin:

- Upload routes check the key, the take and the name against the take's
  TakeMeta for that `gen`; a part bigger than 10,485,760 bytes is refused.
  A `done` for an upload R2 no longer has answers 404 with `"gone": true`.
- `ready` with `"mp3"` makes the take shown (`shown_gen`, `shown_at` the
  first time), applies `pending_cut` for a newer generation, deletes older
  generations' objects, and calls `tellChat` with `{kind: "take"}` once per
  take, the first time it is shown.
- The consumer handles one batch at a time (`max_concurrency: 1`), so the
  edits of one message stay in order. The first shown take of a rehearsal
  sends “New takes from Thursday, 30 October: Viasna 11” to
  `TELEGRAM_CHAT_ID` and keeps the message id in `chat` (`kind = "takes"`,
  `about` = the rehearsal's uid); each next one within 3 hours of
  `started_at` edits it to add “, Viasna 12”. A member's first comment on
  a take sends “Alex on Viasna 12: 1:42 “The bridge drags here””; their
  next ones on it within 3 hours are added as “, 2:58 “Fill too long?””.
  Each take and each comment is a link (`<a href>`, `parse_mode: "HTML"`,
  previews off) to its place: `<origin>/takes/<uid>` and
  `<origin>/takes/<uid>?at=<seconds>`. Marks from РЭХА are never posted.
- A Telegram error retries the message (`message.retry()`), up to the
  queue's 5 tries; a send that worked is never sent again, because the
  `chat` row is written before the message is acknowledged.
- A failure goes to `OWNER_TELEGRAM_ID` alone: “The band service failed:
  <what> at <time>. <detail>”, where `what` is the route or the job. The
  same `what` is told once an hour at most, by `failure_notice`.
- Without `TELEGRAM_BOT_TOKEN` nothing is sent, and without
  `OWNER_TELEGRAM_ID` no failure is told.
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

`service/test/chat.test.ts`, calling `consumeChat` with a fake `telegram`
that records calls, and checking that `tellChat` puts events on the queue:

```ts
test("a shown take goes on the queue", …)
test("the first take of a rehearsal starts a message", …)
expect(fake.sent[0].text).toContain("New takes from Thursday, 30 October: ")
test("the next take within 3 hours is added to it", …)
test("after 3 hours a new message starts", …)
test("comments go per person and take", …)
test("marks from REHA are not posted", …)
test("a telegram error is tried again, a sent message is not sent twice", …)
test("a failure is told to the owner alone, once an hour", …)
test("without a bot token nothing is sent", …)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx vitest run test/reha.test.ts test/chat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the takes, uploads and chat folders, and `npm run openapi`**

- [ ] **Step 4: Run the tests again**

Run: `cd service && npx vitest run test/reha.test.ts test/chat.test.ts test/openapi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add service
git commit -m "Band service: takes from REHA, uploads, trash and the band's chat"
```

---

### Task 4: The service's side for the band

**Files:**
- Create: `service/worker/takes/band-routes.ts` (feed, songs, a take's page, stars, seen, trash, restore), `service/worker/comments/routes.ts`, `service/worker/files/routes.ts` (`/files/*`)
- Create: `service/test/band.test.ts`, `service/test/files.test.ts`

**Interfaces:**
- Consumes: Task 2's `needMember`, `app`; Task 3's `tellChat`, `purgeTrash`.
- Produces the band's API in the shared contract, every route with
  `createRoute` and zod schemas, and these row shapes, which Task 5
  renders through the types Hono RPC gives it:

```ts
type TakeRow = { uid: string; name: string; song_id: number | null; date: string;
  duration_sec: number; marks: number; stars: { member_id: string; initial: string }[];
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
- A removed member's stars and comments still show with their name and
  initial.
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
test("a removed member's comments keep their name", …)
test("files need a session and answer a range", …)
test("a download is named after the take and the track", …)
test("restore puts a take back in its song", …)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx vitest run test/band.test.ts test/files.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the routes, then `npm run openapi`**

- [ ] **Step 4: Run the tests again**

Run: `cd service && npx vitest run test/band.test.ts test/files.test.ts test/openapi.test.ts`
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
- Create: `service/src/main.tsx`, `service/src/routes.tsx` (TanStack Router, routes written in code, no router plugin), `service/src/api.ts` (`hc<AppType>("/")` and a TanStack Query hook per call), `service/src/auth.ts` (better-auth's React client with `emailOTPClient()`), `service/src/service.css` (Tailwind with `@source` for `../ui/src`)
- Create, a folder per feature: `service/src/shell/Shell.tsx` (left column on a computer, one page at a time on a phone, under 768 px), `service/src/signin/SignIn.tsx`, `service/src/signin/Name.tsx`, `service/src/members/Members.tsx`, `service/src/feed/First.tsx` (New since you were here, Songs), `service/src/songs/Song.tsx`, `service/src/takes/Take.tsx`, `service/src/takes/Comments.tsx`, `service/src/takes/Downloads.tsx`, `service/src/takes/player/mp3.ts` (frames of an MP3), `service/src/takes/player/player.ts`, `service/src/trash/Trash.tsx`
- Create: `service/e2e/seed.ts`, `service/e2e/*.spec.ts`, `service/playwright.config.ts`, `service/test/fixtures/` (six short MP3 tracks made by `make_tracks.py` from the playback test)
- Create: `service/src/takes/player/mp3.test.ts`

**Interfaces:**
- Consumes: `AppType` from `worker/index.ts` (a type-only import, so no
  Worker code reaches the pages); the band's API; better-auth's client.
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

Data: a star, a seen, a comment and a closed comment are TanStack Query
mutations that invalidate the take and the feed. A 401 from any call sends
the page to `/signin` with the path it was on, and back there after
signing in.

Paths: `/` (the first screen; on a computer it opens on **New**, or with
nothing new on the song played last), `/songs/$id`, `/takes/$uid`
(`?at=` puts the playhead there), `/trash`, `/members`, `/signin`,
`/name`.

Sign-in, on `/signin`: the address field and **Send code**; then “If this
address is in the band, a code is on its way”, the code field and **Sign
in**. A `CONFIRM_FIRST` answer shows its words in place of the code field.
A first sign-in goes to `/name` with “What should the band call you?”.

Words, exactly as the spec has them: **New since you were here**,
**Songs**, **Not named**, **All takes**, **★ at rehearsal**, **Marks and
comments**, **Comment at 1:42**, **Download tracks**, **Send code**,
**Sign in**, “What should the band call you?”, **Sign out everywhere**,
**Members**, **Add member**, “Has not confirmed the address yet”, “Has not
signed in yet”, **Make a key for РЭХА**, **Remove**, **Trash**,
**Restore**, “In the part cut off”.

The page tests run against the real Worker: `playwright.config.ts` starts
`npm run build`, then `wrangler d1 migrations apply reha-band --local --env
test --persist-to .wrangler/e2e` on a fresh folder, then `wrangler dev
--env test --persist-to .wrangler/e2e --port 8799`. `e2e/seed.ts`, run once
in Playwright's global set-up, makes a made-up band through the service's
own routes only: the owner (alex@example.com) asks for a code and reads it
from `/api/stand-ins/letters`; adds Dzima, Ira and Paŭlik, confirmed in the
stand-in; makes a key; sends takes of the songs Viasna, Pałyn and Kupalle
through the РЭХА routes with the fixture MP3s; and signs the members in to
star and comment.

- [ ] **Step 1: Write the failing tests**

`service/src/takes/player/mp3.test.ts`:

```ts
test("an MP3's frames are found and counted", …) // a fixture MP3 in test/fixtures/
expect(parseFrames(bytes).samplesPerFrame).toBe(1152)
```

`service/e2e/` (titles in cp1252):

```ts
test("sign in with a code, then the band asks for a name", …)
test("an address not in the band gets the same answer", …)
test("an unconfirmed address is told to confirm first", …)
test("a removed member is sent to sign-in", …)
test("the first screen shows what is new, then the songs", …)
test("with nothing new the new card is not there", …)
test("a take shows the path back to its song", …)          // Viasna > Viasna 12
test("a computer keeps the songs on the left", …)       // 1180x820 and 960x680
test("a phone shows one page at a time with a back arrow", …) // 390x844
test("a song page puts the best take on top", …)
test("a take page has a lane per track with M and S", …)
test("a star shows at once and stays after a reload", …)
test("a comment is written at the playhead", …)
test("a closed comment is greyed and stays", …)
test("the star at rehearsal shows apart", …)
test("download tracks says which originals are still coming", …)
test("members show who has not confirmed or signed in yet", …)
test("members and keys are only for the owner", …)
test("trash lists takes and restores them", …)
test("light and dark themes both draw", …)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && npx vitest run src/takes/player/mp3.test.ts && npx playwright test`
Expected: FAIL.

- [ ] **Step 3: Write the pages and the player**

- [ ] **Step 4: Run the tests again**

Run: `cd service && npx vitest run src/takes/player/mp3.test.ts && npx playwright test`
Expected: PASS.

- [ ] **Step 5: Play a real take by hand in the container's Chromium**

With the page tests' `wrangler dev` still up, open a seeded take, press ▶,
and check that the time moves and the tracks stay together while seeking.
Expected: they do. Say in the ledger that real devices (Mac, iPhone,
Windows) are still to be checked by Alex.

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
  `ready(uid, gen, what)`, `delete_take(uid)`. Every request carries
  `x-api-key: <secret>` and `X-Reha-Version: <rehearsal_recorder.__version__>`.
  It raises `Offline` for a network error or a timeout (60 s), `Gone` for
  a 404 with `gone`, and `Refused(words)` for any other 4xx, the 426
  “Update РЭХА to send takes here” among them.

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
to drop the connection for the next N calls, to forget an upload, to
refuse with words, or to answer 426. It checks every request against
`service/openapi.json` with `openapi-core` 0.23.1
(`OpenAPI.from_file_path`, then `validate_request` through a small adapter
for `http.server`'s request), answers a request that does not match with
400 and what did not match, and keeps each such line in `fake.mismatches`.
Without `openapi-core` installed, `test_sending.py` stops at once with
“pip install openapi-core==0.23.1”, never skips.

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
ok("an old REHA is told to update", entry["state"] == "failed" and entry["error"] == "Update РЭХА to send takes here")
ok("every request matches the service's description", fake.mismatches == [])   # last, after all the above
```

- [ ] **Step 2: Run them to see them fail**

Run: `python tests/test_sending.py`
Expected: FAIL (no module, no calls).

- [ ] **Step 3: Write the migration, the models, the module, the client and the calls**

- [ ] **Step 4: Run the tests again, and the suites the changed code touches**

Run: `pip install openapi-core==0.23.1` once, then `python tests/test_sending.py && python tests/test_store.py && python tests/test_engine.py > /tmp/engine.txt 2>&1; tail -3 /tmp/engine.txt`
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
- Modify: `.github/workflows/checks.yml` (an output `service`: true for `service/*`, `ui/*` and `checks.yml`; a job `service` that runs `npm ci`, `npm run typecheck`, `npx vitest run`, `npm run build`, the browser install and `npx playwright test` in `service/`; the app jobs pass `also: openapi-core==0.23.1` to `./.github/actions/app`, and the `app` output is also true for `service/openapi.json`)
- Modify: `.github/workflows/release.yml` (a job `service · deploy` after both builds, not on a pre-release, and a choice “Put the service up again” for running it by hand)
- Create: `service/scripts/deploy.mjs`, `service/scripts/deploy.test.mjs`
- Modify: `service/README.md` (what the job needs), `tests/README.md` (`pip install openapi-core==0.23.1` before `run_all.py`)

**Interfaces:**
- `deploy.mjs` reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and the
  optional `SERVICE_DOMAIN`. It finds the D1 database `reha-band` with
  `wrangler d1 list --json`, creating it with `wrangler d1 create
  reha-band` when there is none; the R2 bucket `reha-band` and the queue
  `reha-band-chat` the same way; writes the database's id into
  `wrangler.jsonc` and, when `SERVICE_DOMAIN` is set, `routes:
  [{"pattern": <domain>, "custom_domain": true}]`; then runs `npm run
  build`, `wrangler d1 migrations apply reha-band --remote` and `wrangler
  deploy`. The edited `wrangler.jsonc` is never committed: it lives only
  in the job's checkout. The Worker's settings are not touched: Alex sets
  them in Cloudflare, and `keep_vars: true` keeps them through a deploy.
- A later change to the tables is made in `worker/shared/schema.ts`; `npx
  drizzle-kit generate` writes the next migration from the difference, as
  Alembic's autogenerate does for РЭХА, and both go in one commit. The job
  applies the migrations not applied yet before it deploys, and D1 records
  them in its `d1_migrations` table. D1 has no way back: undoing a change
  is another migration, and D1's Time Travel can put the whole database
  back to a minute of the last 7 days. A migration only adds tables and
  columns, so the Worker still running from the previous release keeps
  working in the moments before the new one is up. The tests build every
  database from all the migrations in order.
- The deploy job, with no `CLOUDFLARE_API_TOKEN` secret, writes a notice
  and succeeds without deploying, so a release made before the service is
  set up is not red.
- GitHub: secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; the
  repository variable `SERVICE_DOMAIN`.

- [ ] **Step 1: Check the deploy script without Cloudflare**

`service/scripts/deploy.test.mjs` runs `deploy.mjs` with a fake `wrangler`
on `PATH` that records its arguments and prints made-up lists.

```js
test("the database id and the domain go into the config", …)
test("no domain keeps workers.dev only", …)
test("a missing database, bucket or queue is made first", …)
test("no token: a notice and no deploy", …)
```

Run: `cd service && node --test scripts/deploy.test.mjs`
Expected: FAIL, then PASS once `deploy.mjs` is written.

- [ ] **Step 2: Write the jobs**

- [ ] **Step 3: Push the branch and let CI run once**

Expected: every check green, the new `service` job among them.

- [ ] **Step 4: Commit**

```bash
git add .github service/scripts service/README.md tests/README.md
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
3. **Run your own**: what it needs (a Cloudflare account; a domain of the
   band's own on Cloudflare, since the sign-in letters can only come from
   one, while the service itself can stay on its workers.dev address; a
   Telegram bot, only for the chat's messages), what it costs (files up
   to 10 GB free, then $0.015 per GB a month; the domain is paid to whoever
   sells it), and the steps one by one, for a musician: make a GitHub
   account and fork РЭХА's repository; make a Cloudflare account, add the
   domain to it and turn on its mail (Email Routing); make two API tokens,
   one for deploying and one for the list of addresses (the permissions
   named one by one); put the first token and the account id in the fork's
   secrets; run **Put the service up again** in the fork's Actions; set the
   Worker's settings in Cloudflare (each named, with what it is for); open
   the service's address, press **Send code**, confirm Cloudflare's letter,
   and sign in with the code; add the members; make a key and paste it into
   РЭХА.
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
2. Cloudflare's mail (Email Routing) turned on for reha.stream.
3. A Telegram bot from BotFather, added to the band's group; the chat's
   id; Alex sends the bot /start, and his own Telegram id.
4. Two API tokens in Cloudflare: one for deploying, one that may only edit
   Email Routing addresses. GitHub secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`, the variable `SERVICE_DOMAIN` set to
   band.reha.stream; **Put the service up again** run in Actions.
5. The Worker's settings in Cloudflare, as the shared contract lists them,
   with `OWNER_EMAIL` his address and `LETTERS_FROM` band@reha.stream.
6. Alex opens band.reha.stream, presses **Send code**, confirms
   Cloudflare's letter, presses **Send code** again and signs in; adds the
   members; makes a key and pastes it into РЭХА at the rehearsal room.
7. Two things only a real account shows, checked then: that a sign-in and
   an upload part each stay under the free plan's 10 ms of CPU (Workers
   Logs show the CPU time of each request), and that taking an unconfirmed
   address off Cloudflare's list and adding it back sends Cloudflare's
   letter again (the spec's Call 4). If either fails, Claude says so and
   proposes the fix before anything else.

Whatever in the site's **Run your own** steps turns out wrong while Alex
follows them is fixed on the page before it goes live.

---

## How the tasks depend on each other

- Task 1 comes before Tasks 6 and 7.
- Tasks 2, 3, 4 and 5 come in that order and need nothing from РЭХА's side
  but the shared contract, so they can run beside Tasks 1, 6 and 7 in their
  own worktree. Task 6's fake service reads `service/openapi.json`, so
  Task 6 starts once Task 4 has committed it.
- Task 9 needs nothing else and can run beside either line.
- Task 8 comes after Task 5; Task 10 after Task 7; Task 11 after the
  release.
- Everything goes in one pull request, which waits for Alex's word before
  it is merged.

## Calls made in this plan

Decisions neither the spec nor the architecture rounds made, made here and
listed for Alex to check:

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
   FLAC files are made; “That code does not work. Press Send code for a new
   one.”; “This address is already in the band”; “Add the Cloudflare token
   for addresses first”; the letter's subject “<code> is your code for
   <host>” and its two lines; the failure message to Alex.
9. A take being sent goes on being sent if the switch moves back to the
   cloud folder. **Disconnect** stops it and forgets it.
10. A browser that cannot decode MP3 through WebCodecs gets a message,
    not a slower way of playing.
11. РЭХА's sending is tested in the repository's own style of Python suite
    (`tests/test_sending.py`, run by `run_all.py`), against a fake service
    that checks every request against `service/openapi.json` with
    `openapi-core`; the repository has no pytest.
12. The release job finds or makes the D1 database, the R2 bucket and the
    queue, called `reha-band` and `reha-band-chat`, and takes the address
    from the GitHub variable `SERVICE_DOMAIN`. A release made before the
    service is set up skips the deploy instead of failing.
13. **Run your own** on the site goes through a fork of the repository on
    GitHub and its Actions, the same way Alex's copy is put up, so the
    steps are tried for real.
14. The closing question counts files not made yet as 0.7 of their WAVs'
    size.
15. A member's name is 1 to 40 characters, a comment 1 to 2000.
16. All of it goes in one pull request.
17. better-auth is built anew for each request, since a Worker's bindings
    exist only inside one; its address is the request's own.
18. Signing in uses better-auth's own routes and React client, so its
    limits on tries apply; everything else goes through Hono RPC.
19. The owner's row is made the first time a code is asked for
    `OWNER_EMAIL`, with better-auth's admin role. **Remove** is the admin
    plugin's ban with no end, so the member's row, stars and comments stay;
    neither **Remove** nor **Sign out everywhere** works on the owner.
20. РЭХА's keys belong to the owner's user, have no end and no limit on
    requests; РЭХА sends one in `x-api-key`, the plugin's own header.
21. РЭХА sends its version in `X-Reha-Version`; the lowest the service
    takes is a constant in its code, `MIN_REHA_VERSION`, starting at
    0.0.0, so no РЭХА is turned away today. A clone run from source counts
    by its release number, and one never installed (“unknown”) always
    passes, since Alex runs main from source.
22. The chat's queue is read one batch at a time, so the edits of one
    message stay in order; a failure is told to Alex once an hour at most
    for the same route or job, kept in a small table.
23. The page tests use stand-ins for letters, Cloudflare's list and
    Telegram, switched on only in `wrangler.jsonc`'s `test` environment;
    their reading routes answer 404 everywhere else. The made-up band is
    made through the service's own routes, so the seed tests them too.
24. `service/openapi.json` is kept in the repository, and a service test
    fails when it is not what the Worker serves.
25. The pages' routes are written in code, not made by TanStack's router
    plugin from file names; there are seven of them.
26. The settings are kept through a deploy by `keep_vars: true`, so Alex
    sets them once, in Cloudflare.
27. An unconfirmed address in the band is told to confirm first, which
    tells a stranger who types it that it is in the band. The spec asks
    for that line; it holds only until the member presses Cloudflare's
    button.
