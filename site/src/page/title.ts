/** The longest hyphenated word kept whole. A tile clips what does not fit
 *  rather than wrap it, so a long one, kept whole, would be cut off on a
 *  narrow phone; it breaks after a hyphen as any text does. */
const SHORT_WORD = 12

/**
 * A tile's title in pieces, each short hyphenated word apart from the text
 * round it and marked whole: on a phone, "e-kit" would otherwise end a line
 * on "e-". Joined, the pieces are the title.
 */
export function titleParts(text: string): { text: string; whole: boolean }[] {
  // Split on a capture: the hyphenated words are the odd pieces.
  return text
    .split(/(\S+-\S+)/)
    .map((part, i) => ({ text: part, whole: i % 2 === 1 && part.length < SHORT_WORD }))
    .filter((part) => part.text !== "")
}
