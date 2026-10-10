/**
 * A five-pin DIN socket, the MIDI sign: beside a track's port on the setup
 * card, on a recording tile that takes notes, and on a notes lane's plate.
 */
export function MidiGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="7" cy="12" r="0.6" fill="currentColor" />
      <circle cx="17" cy="12" r="0.6" fill="currentColor" />
      <circle cx="8.6" cy="8.2" r="0.6" fill="currentColor" />
      <circle cx="15.4" cy="8.2" r="0.6" fill="currentColor" />
      <circle cx="12" cy="6.8" r="0.6" fill="currentColor" />
      <path d="M10.5 17.5h3" />
    </svg>
  )
}
