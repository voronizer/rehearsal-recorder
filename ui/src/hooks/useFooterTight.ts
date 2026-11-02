import { createContext, useContext } from "react"

/** How many of its steps a footer has taken to give its left part room
 *  (FooterRow's `squeeze`): 0 while all fits. */
export const FooterTight = createContext(0)

/** The steps the footer round this has taken: the metronome's gear offers
 *  what its row gave up. */
export function useFooterTight(): number {
  return useContext(FooterTight)
}
