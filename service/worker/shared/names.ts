/**
 * Two names the band would call one, whatever their case, in any alphabet:
 * “Ціха” and “ЦІХА”, “Łaŭka” and “łaŭka”. SQLite's NOCASE folds only A to
 * Z, so the check is made here, on the names read out.
 */
export const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
