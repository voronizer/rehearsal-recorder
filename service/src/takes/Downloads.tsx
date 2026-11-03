import { Group, Rows } from "../shell/parts"
import type { TakePage } from "../api"

const link = "rounded-md border px-2 py-1 text-xs hover:bg-accent"

/**
 * **Download tracks**: each track's original in FLAC, and its notes as
 * .mid where it recorded MIDI. Until РЭХА has sent the originals, each
 * track is offered as its MP3, and the page says the originals are coming.
 */
export function Downloads({ take }: { take: TakePage }) {
  const file = (position: number, kind: string) => `/files/${take.uid}/${take.gen}/${position}.${kind}?download=1`
  // A row a track: its sound and its notes are files of their own, and one track.
  const tracks = new Map<string, { sound?: TakePage["files"][number]; notes?: TakePage["files"][number] }>()
  for (const f of take.files) tracks.set(f.name, { ...tracks.get(f.name), ...(f.mid ? { notes: f } : { sound: f }) })
  return (
    <Group title="Download tracks" hint={take.flac_coming ? undefined : "FLAC, as РЭХА recorded them"}>
      {take.flac_coming && <p className="text-muted-foreground">The originals are still coming from РЭХА. For now, each track is an MP3.</p>}
      <Rows>
        {[...tracks].map(([name, { sound, notes }]) => (
          <div key={name} data-download={name} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {sound?.flac ? (
              <a className={link} href={file(sound.position, "flac")} aria-label={`${name} FLAC`}>
                FLAC
              </a>
            ) : (
              sound?.mp3 && (
                <a className={link} href={file(sound.position, "mp3")} aria-label={`${name} MP3`}>
                  MP3
                </a>
              )
            )}
            {notes && (
              <a className={link} href={file(notes.position, "mid")} aria-label={`${name} MIDI`}>
                MIDI
              </a>
            )}
          </div>
        ))}
      </Rows>
    </Group>
  )
}
