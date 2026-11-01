/** The time now, in one place, so a test's clock reaches every rule. */
export const now = (): Date => new Date()

/** A moment as the tables keep it. */
export const iso = (at: Date = now()): string => at.toISOString()
