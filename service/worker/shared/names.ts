/**
 * A name as the band would compare it, whatever its case, in any alphabet,
 * folded as РЭХА folds a song's title (Python's casefold): “Ціха” and
 * “ЦІХА”, “Łaŭka” and “łaŭka”, “Straße” and “STRASSE”. Up and down again
 * turns ß into ss; a final ς is σ. SQLite's NOCASE folds only A to Z, so
 * the check is made here, on the names read out.
 */
export const fold = (name: string) => name.trim().toUpperCase().toLowerCase().replaceAll("ς", "σ").replaceAll("ß", "ss")

/** Two names the band would call one. */
export const same = (a: string, b: string) => fold(a) === fold(b)

/**
 * What a take with no song is called, so no song can be (РЭХА's
 * store/names.py): “Take 47”, and “Take #47” as the pages write it.
 */
export const TAKE_NAME = /^Take(?:\s*#\s*|\s+)\d+$/
