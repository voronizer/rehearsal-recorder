import { expect, test } from "vitest"
import { songOfName, takeText } from "./words"

const NB = "\u00a0"

test("a take of a song reads as its title, then # and its number", () => {
  expect(takeText({ name: "Viasna 12", number: 12, song_id: 3 })).toBe(`Viasna${NB}#12`)
  expect(songOfName({ name: "Viasna 12", number: 12, song_id: 3 })).toBe("Viasna")
})

test("a title that ends in a number keeps it, and the take's number comes after the #", () => {
  expect(takeText({ name: "Opus 5 3", number: 3, song_id: 7 })).toBe(`Opus 5${NB}#3`)
})

test("a take's own page gives its song as an object, and reads the same", () => {
  expect(takeText({ name: "Pałyn 9", number: 9, song: { id: 2 } })).toBe(`Pałyn${NB}#9`)
})

test("a take with no song is its name", () => {
  expect(takeText({ name: "Take 4", number: 4, song_id: null })).toBe("Take 4")
  expect(takeText({ name: "Take 4", number: 4, song: null })).toBe("Take 4")
  expect(songOfName({ name: "Take 4", number: 4, song_id: null })).toBeNull()
})

test("a take moved to another song, not numbered yet, is the song's title alone", () => {
  expect(takeText({ name: "Kupalle", number: 2, song_id: 5, moved: true })).toBe("Kupalle")
  // Moved to a song whose title ends in the take's old number.
  expect(takeText({ name: "Opus 5", number: 5, song_id: 7, moved: true })).toBe("Opus 5")
})

test("a name that does not end in the take's number is shown as it is", () => {
  expect(takeText({ name: "Viasna", number: 12, song_id: 3 })).toBe("Viasna")
})
