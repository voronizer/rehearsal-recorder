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
    <section aria-labelledby="downloads" className="flex flex-col gap-2">
      <h2 id="downloads" className="px-1 text-sm font-semibold">
        Download tracks
      </h2>
      {take.flac_coming && (
        <p className="px-1 text-xs text-muted-foreground">The originals are still coming from РЭХА. For now, each track is an MP3.</p>
      )}
      <ul className="flex flex-col rounded-xl bg-card">
        {take.files.map((f, i) => (
          <li key={f.position} className={`flex items-center gap-3 px-4 py-2 ${i > 0 ? "border-t" : ""}`}>
            <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
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
          </li>
        ))}
      </ul>
    </section>
  )
}
