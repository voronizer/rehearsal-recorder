# The band's chat: takes sent to a Telegram group, findable by song

Takes reach the band through the cloud folder: a folder that Google Drive
or Dropbox syncs, with a subfolder per rehearsal (`share_take` in
`src/rehearsal_recorder/api.py`, `docs/using-it.md` "Sending takes to the
cloud"). The band listens on phones, the next day, in the car, and there
nothing can be found.

- **On a phone, a cloud folder is only names.** We checked what the Drive,
  Dropbox and iCloud apps can do with audio:
  - none of them shows an MP3's tags or artwork;
  - an `.m3u` playlist in a cloud folder does not play from them;
  - shortcuts and symlinks do not sync as links;
  - only Dropbox on iOS plays a folder through; Drive plays one file at a
    time.
- **So the only interface is the folder tree and the file names.** Every
  layout we drew is a compromise: per rehearsal, "the good Polyn" is a
  hunt; per song, "everything from Tuesday" is.
- **Nobody can answer a take there.** "The solo at 2:10" is said somewhere
  else, about a file in a folder.

This sends the same takes to a Telegram group the band is in. A bot posts
each take as audio. Its caption carries the song as a hashtag, which finds
every take of that song in one tap, plus the date, ★, and the take's notes
as timestamps that seek. The cloud folder stays, for the original tracks.
It stands on [songs in the store](2026-10-02-songs-in-the-store-design.md)
and [stars](2026-10-02-stars-design.md).

## What Telegram gives (checked against the Bot API, 2026-10-02)

- **`sendAudio`** puts an MP3 or M4A in Telegram's music player.
  - It shows a title and a performer, and plays one after another.
  - Bots can send files of up to **50 MB**.
  - A caption holds up to 1024 characters.
- **`editMessageCaption` and `editMessageMedia`** work on the bot's own
  messages with no time limit. That covers a rename, a crop and ★.
- **`deleteMessage`** says a message can only be deleted within 48 hours,
  except that a bot that is an administrator "can delete any message
  there". Older messages need checking on a real group (Step 1).
- **`pinChatMessage`** needs the bot to be an administrator with the right
  to pin.
- **Hashtags in a caption are links.** A tap searches the chat for that tag.
- **Timestamps ("1:23") in an audio caption are links** that play from that
  moment. This has been so since Telegram Desktop 1.9.3 and Android 5.13
  (December 2019), to be checked on today's iOS and Android (Step 1).
- **A bot learns a group's id** from the `my_chat_member` update it gets
  when it is added to the group.

## Decisions

- **D1. The same takes as the cloud folder.** A take goes to the chat when
  it would go to the cloud folder:
  - sent by hand;
  - or saved with *Send saved takes automatically* on, unless the review
    screen said no for this take (`cloud_skip`, `cloud_send`).

  There is one notion of "sent", and two places it goes.
- **D2. The chat gets the mix, as MP3, always.** It is what a phone plays,
  and the music player needs MP3 or M4A, whatever format the cloud folder
  is set to. The original tracks go only to the cloud folder.
- **D3. The chat mirrors the app.** A rename, a crop, ★ and a delete
  in the app change the message, as they change the cloud copy today.
- **D4. Setting up is the one place a key is pasted.** Everything after is
  mouse.
- **D5. Either place can be left out.** A band can use the chat without a
  cloud folder, the cloud folder without the chat, or both.

## The message

- **M1. The audio's title is the take's name** ("Polyn 3"). Its performer
  is the rehearsal and its date ("Tuesday jam · 30 Sep"). The player shows
  "Polyn 3 — Tuesday jam · 30 Sep".
- **M2. The caption:**
  ```
  #Polyn · go 3 · Tue 30 Sep ★
  1:23 Went wrong — solo fell apart
  2:47 Keep this — the ending
  ```
  - **First line:**
    - the song as a hashtag, spelled from its title (spaces become `_`;
      characters a hashtag cannot hold are dropped);
    - the go;
    - the rehearsal's day;
    - ★ when it has one.
  - **Under it, the take's marks, in order:** the time, the label's name
    and the comment.
  - A take with no song is tagged `#jam`.
  - A caption over 1024 characters keeps the first line and as many marks
    as fit, then "and 6 more in the app".
- **M3. Size.**
  - The MP3 is 192 kbps.
  - Over 50 MB (about 35 minutes), it is encoded again at 96 kbps, which
    is about 70 minutes.
  - Longer still, it is not sent to the chat, and the take says so: "Too
    long for Telegram".
- **M4. *Starred*, a pinned message** the bot keeps up to date: every song
  with a ★ go, alphabetically, each with its newest ★ go (the one its ▶
  plays in the app, stars D4) and that go's date. In a supergroup each line
  links to its message; in a basic group, which has no message links, it
  lists them without. ★ jams are not in it: `#jam` finds them.

## Keeping the chat in step (D3)

- **K1. Rename, or a song renamed or merged:** the caption (M2) and the
  audio's title (M1) are edited, through `editMessageMedia` with the same
  file and new `title`.
- **K2. Crop:** the audio is replaced (`editMessageMedia`, new file), and
  the caption kept.
- **K3. ★ put on or taken off:** that take's caption is edited, and
  *Starred* is updated.
- **K4. Delete, or *Remove from the cloud*:** the message is deleted. If
  Telegram refuses, the caption is edited to start "Deleted in the app", so
  nobody takes it for a current take.
- **K5. Marks added, changed or removed:** the caption is edited, at most
  once a minute per take, so marking a take while listening does not edit
  it on every click.

## Sending, and when it cannot

- **Q1. One queue per destination.** The chat has its own queue, beside
  the cloud folder's (`CloudQueue` in `src/rehearsal_recorder/cloud.py`),
  in the same shape: one take once however often it is asked for, nothing
  while a take records.
- **Q2. No network, or Telegram says to wait:**
  - the job stays queued and is tried again with growing waits, as copies
    to a missing cloud folder are now;
  - Telegram's `retry_after` is obeyed;
  - posts to one group are spaced to stay under Telegram's per-group rate.
- **Q3. Each take shows where it is,** as it does for the cloud: waiting,
  sending, in the chat (a Telegram mark beside the cloud one), or the
  reason it is not.
- **Q4. The background-work list** shows each post with its progress (the
  MP3 encode, then the upload), as a cloud copy is shown.

## Setting up

- **S1. Settings gets a *Sending* group** for the two places takes go,
  between *Folders* and *Marks*. Today the cloud folder is the lower
  half of *Folders*, under the recordings folder
  (`ui/src/screens/Settings.tsx`). With a second place beside it, that
  corner is too small, and sending has nothing to do with where takes are
  recorded.
  - *Folders* keeps the recordings folder alone: "Where rehearsals are
    kept".
  - *Sending*, "Where takes go to the band", has three parts, in order:
    1. ***Send saved takes automatically***, above both places, since it
       sends to each one that is set up (D1). Its line names them: "Every
       take you keep goes to the cloud folder and the band's chat on its
       own, between takes". While neither is set up it is absent, as the
       cloud folder's questions are absent today with no folder.
    2. ***Cloud folder***, moved as it is: the folder, *Forget the cloud
       folder*, what the copies are written as, and what gets published.
       What gets published stays under the cloud folder, as only the cloud
       folder has a choice; the chat always gets the mix (D2).
    3. ***Band chat***, S2–S4.
- **S2. *Band chat* with nothing set up** has the steps written out:
  1. In Telegram, open @BotFather and send `/newbot`.
  2. Give it a name and a username ending in `bot`.
  3. Paste the token it sends here.
  4. Add the bot to the band's group and make it an administrator.
- **S3. After the token is pasted,** the section waits for the bot to be
  added to a group, reading updates until a `my_chat_member` arrives. It
  then shows the group's name, with *Use this group* and *Send a test*.
- **S4. Once connected:**
  - the section shows the group;
  - *Disconnect* forgets the token and the group, and leaves the messages
    where they are;
  - the token is kept in `config.json`, sent nowhere but Telegram, and
    never shown again in full.
- **S5. On connecting,** if takes have been sent to the cloud folder
  before, it offers: "Post the 23 takes already sent? Oldest first, so the
  chat reads in order." Posting them is background work like any other.

## Schema (migration 0006)

| Table | Change |
|---|---|
| `chat_post` | new: `take_id` PK → `take` ON DELETE CASCADE, `chat_id` TEXT, `message_id` INT, `source` JSON (what it was made from: name, song, go, starred, marks, length, as `cloud.source_of` fingerprints a copy), `error` TEXT nullable. |
| `chat_pin` | new: one row per group, `chat_id` TEXT PK, `message_id` INT (*Starred*). |

## Python

- **A1.** A small Telegram client of our own, on `urllib` and multipart
  upload, with no new dependency. It covers `getMe`, `getUpdates`,
  `sendAudio`, `editMessageCaption`, `editMessageMedia`, `deleteMessage`,
  `pinChatMessage` and `editMessageText`.
- **A2.** `set_band_chat_token(token)`, `band_chat_status()` (S3's waiting,
  and the group found), `use_band_chat(chat_id)`, `test_band_chat()`,
  `disconnect_band_chat()`.
- **A3.** The send path builds the mix as `share_take` does, encodes it to
  MP3 (M3), posts it, and records `chat_post`. The edit paths hang off
  where the cloud copy is mirrored today: rename, crop, delete, marks, and
  ★ and song changes.

## Testing

Tests come before the code, and each is seen failing first.

- **Python, against a fake Telegram:** a local HTTP server answering the
  Bot API's methods, which the client is pointed at in tests.
  - posting a take, with its title, performer and caption;
  - the caption's hashtag spelling, including Cyrillic, spaces and
    punctuation;
  - truncation at 1024 characters;
  - re-encoding over 50 MB, and refusing past 96 kbps;
  - K1–K5, including a refused delete;
  - `retry_after` and network errors;
  - S5's back-posting order.
- **Playwright:**
  - the *Sending* group: the cloud folder's settings there and gone from
    *Folders*; *Send saved takes automatically* above both places, naming
    the ones set up, and absent with neither;
  - the *Band chat* steps, the wait, *Use this group*, the test and
    disconnecting;
  - a take's chat status beside its cloud status.

## Steps

1. **Check on a real group first**, before any code beyond A1:
   - timestamps seek in an audio caption on iOS and Android;
   - a hashtag tap finds the takes;
   - an administrator bot can delete a message older than 48 hours;
   - message links in the pinned list.

   Adjust M2, K4 and M4 by what is found.
2. The *Sending* group, setting up (S1–S4), and posting a take (D1, D2,
   M1–M3, Q1–Q4).
3. Keeping in step (K1–K5).
4. *Starred* (M4) and posting what was sent before (S5).

## Docs

- `docs/using-it.md`:
  - a *Band chat* section beside "Sending takes to the cloud", with the
    set-up steps;
  - "Settings → Folders" becomes "Settings → Sending" where it is about the
    cloud folder.
- `CHANGELOG.md`.

## Not part of this

- Changing the cloud folder's layout. With the chat answering "find a
  take", the folder is for the tracks, and stays as it is.
- Reading the chat back into the app (replies, reactions).
- Other messengers. WhatsApp's API is for businesses, behind a business
  account, not for a group of friends.
