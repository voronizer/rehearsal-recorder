/** The 24 keys a song can be in, as the song's panel offers them; the pages read this list too. */
export const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"].flatMap((n) => [`${n} major`, `${n} minor`])
