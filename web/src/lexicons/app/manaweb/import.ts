import type * as AppManawebCard from './card.js'

export interface Main {
  $type: 'app.manaweb.import'
  /** A sanity bound, not a promise: the writer packs by bytes. */
  entries: Entry[]
  /** The tool the cards were exported from. */
  source?: string
  /** The file they arrived in, world-readable like every other field. */
  file?: string
  createdAt: string
  [k: string]: unknown
}

/** A card to write, in the shape app.manaweb.card records it. */
export interface Entry {
  $type?: 'app.manaweb.import#entry'
  /** Scryfall print id: the exact printing, which also pins the language. */
  scryfallId: string
  /** Part of what identifies these copies; foil and nonfoil are separate records. */
  finish: 'nonfoil' | 'foil' | 'etched' | (string & {})
  /** Copies owned now. Deleted rather than kept at zero. */
  quantity: number
  /** The Cardmarket scale, as ManaBox exports. Absent means ungraded. */
  condition?:
    | 'mint'
    | 'nearMint'
    | 'excellent'
    | 'good'
    | 'lightPlayed'
    | 'played'
    | 'poor'
    | (string & {})
  /** The container holding these copies. Absent means unfiled. */
  container?: string
  /** How these copies were come by. History, so it need not sum to quantity. */
  acquisitions?: AppManawebCard.Acquisition[]
  /** Not a real card: fills a deck slot but counts toward no valuation. */
  proxy?: boolean
  /** Free text, and world-readable like every other field. */
  note?: string
  /** Free-form labels. Moxfield exports these. */
  tags?: ('altered' | 'misprint' | 'signed' | (string & {}))[]
  createdAt: string
}
