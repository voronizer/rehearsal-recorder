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
  return (
    <Group title="Download tracks" hint={take.flac_coming ? undefined : "FLAC, as РЭХА recorded them"}>
      {take.flac_coming && <p className="text-muted-foreground">The originals are still coming from РЭХА. For now, each track is an MP3.</p>}
      <Rows>
        {take.files.map((f) => (
          <div key={f.position} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {f.flac ? (
              <a className={link} href={file(f.position, "flac")} aria-label={`${f.name} FLAC`}>
                FLAC
              </a>
            ) : (
              f.mp3 && (
                <a className={link} href={file(f.position, "mp3")} aria-label={`${f.name} MP3`}>
                  MP3
                </a>
              )
            )}
            {f.mid && (
              <a className={link} href={file(f.position, "mid")} aria-label={`${f.name} MIDI`}>
                MIDI
              </a>
            )}
          </div>
        ))}
      </Rows>
    </Group>
  )
}
