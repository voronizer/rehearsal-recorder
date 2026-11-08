import { expect, test } from "vitest"
import { songAndNumber, takeText } from "./words"

const NB = " "

test("a take of a song reads as its title, then # and its number at the song", () => {
  expect(takeText({ name: "Viasna 12", song_id: 3 })).toBe(`Viasna${NB}#12`)
  expect(songAndNumber({ name: "Viasna 12", song_id: 3 })).toEqual({ song: "Viasna", number: 12 })
})

test("the number is the one in the name, whatever the take's number in its rehearsal", () => {
  // РЭХА sends the take's number in the evening beside the name: 33rd that night, 12th of Viasna.
  const take = { name: "Viasna 12", number: 33, song_id: 3 }
  expect(takeText(take)).toBe(`Viasna${NB}#12`)
})

test("a title that ends in a number keeps it, and the take's number comes after the #", () => {
  expect(takeText({ name: "Opus 5 3", song_id: 7 })).toBe(`Opus 5${NB}#3`)
})

test("a take's own page gives its song as an object, and reads the same", () => {
  expect(takeText({ name: "Pałyn 9", song: { id: 2 } })).toBe(`Pałyn${NB}#9`)
})

test("a take with no song reads as Take, then # and its number", () => {
  expect(takeText({ name: "Take 47", song_id: null })).toBe(`Take${NB}#47`)
  expect(takeText({ name: "Take 47", song: null })).toBe(`Take${NB}#47`)
  expect(songAndNumber({ name: "Take 47", song_id: null })).toEqual({ song: "Take", number: 47 })
})

test("a take with no song: the number in its name, never its number in the rehearsal", () => {
  // The 7th take that evening, the 3rd with no song.
  const take = { name: "Take 3", number: 7, song_id: null }
  expect(takeText(take)).toBe(`Take${NB}#3`)
})

test("a take with no song and some other name is that name", () => {
  expect(takeText({ name: "Jam 2", song_id: null })).toBe("Jam 2")
  expect(songAndNumber({ name: "Jam 2", song_id: null })).toBeNull()
})

test("a take moved to another song, not numbered yet, is the song's title alone", () => {
  expect(takeText({ name: "Kupalle", song_id: 5, moved: true })).toBe("Kupalle")
  // Moved to a song whose title ends in a number.
  expect(takeText({ name: "Opus 5", song_id: 7, moved: true })).toBe("Opus 5")
})

test("a take moved out of its song, not numbered yet, is Take alone", () => {
  expect(takeText({ name: "Take", song_id: null, moved: true })).toBe("Take")
  expect(songAndNumber({ name: "Take", song_id: null, moved: true })).toBeNull()
})

test("a name with no number at its end is shown as it is", () => {
  expect(takeText({ name: "Viasna", song_id: 3 })).toBe("Viasna")
})
