import { CHAMPION_DECKS } from '../data/championDecks.js'
import { createDeck } from './storage.js'

const MAIN_DECK_TYPES = new Set(['Unit', 'Spell', 'Gear'])

const VALIDATION_LIMITATIONS = Object.freeze([
  Object.freeze({
    code: 'CHAMPION_IDENTITY_UNVERIFIED',
    message: 'The local catalog identifies the chosen card only as a Unit; it does not include Champion tags needed to prove that it is a Champion Unit matching the Legend.',
  }),
  Object.freeze({
    code: 'DOMAIN_IDENTITY_UNVERIFIED',
    message: 'The local catalog does not contain complete Legend domain identity and card domain-requirement metadata, so domain legality cannot be verified.',
  }),
  Object.freeze({
    code: 'SIGNATURE_LIMIT_UNVERIFIED',
    message: 'The local catalog does not identify Signature cards or their Champion tags, so the aggregate three-Signature-card rule cannot be verified.',
  }),
])

function cardType(card) {
  return card?.type || card?.cardtype || ''
}

function cardName(card, fallback = '') {
  return String(card?.name || fallback).trim()
}

function normalizedName(card, fallback = '') {
  return cardName(card, fallback).toLocaleLowerCase('en')
}

function isBanned(card) {
  return card?.is_banned === true
    || card?.is_banned === 1
    || card?.is_banned === '1'
    || card?.banned === true
    || card?.banned === 1
    || card?.banned === '1'
}

function numericCount(value) {
  if (value === '' || value === null || value === undefined) return null
  const count = Number(value)
  return Number.isInteger(count) && count > 0 ? count : null
}

function sortedCountMap(countMap) {
  if (!countMap || typeof countMap !== 'object' || Array.isArray(countMap)) return {}

  return Object.fromEntries(
    Object.entries(countMap)
      .map(([id, value]) => [String(id), numericCount(value)])
      .filter(([id, count]) => id && count !== null)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function cardCatalog(cards) {
  if (cards instanceof Map) return new Map(cards)
  if (Array.isArray(cards)) return new Map(cards.filter((card) => card?.id).map((card) => [card.id, card]))
  if (cards && typeof cards === 'object') return new Map(Object.entries(cards))
  return new Map()
}

function definitionFingerprint(deck) {
  return JSON.stringify(deckDefinition(deck))
}

function exactPreconFor(deck) {
  const fingerprint = definitionFingerprint(deck)
  return CHAMPION_DECKS.find((precon) => definitionFingerprint(precon) === fingerprint) || null
}

function issue(code, message, details = {}) {
  return { code, message, ...details }
}

function inspectCountMap(zoneName, countMap, errors) {
  if (!countMap || typeof countMap !== 'object' || Array.isArray(countMap)) {
    errors.push(issue('INVALID_ZONE', `${zoneName} must be a card-count object.`, { zone: zoneName }))
    return []
  }

  const entries = []
  for (const [id, rawCount] of Object.entries(countMap)) {
    const count = numericCount(rawCount)
    if (!id || count === null) {
      errors.push(issue('INVALID_CARD_COUNT', `${zoneName} contains an invalid count for ${id || 'an empty card ID'}.`, {
        zone: zoneName,
        cardId: id,
        count: rawCount,
      }))
      continue
    }
    entries.push([id, count])
  }
  return entries
}

function totalEntries(entries) {
  return entries.reduce((total, [, count]) => total + count, 0)
}

export function expandCountMap(countMap = {}) {
  return Object.entries(sortedCountMap(countMap)).flatMap(([id, count]) => Array(count).fill(id))
}

export function deckDefinition(deck = {}) {
  const legacyBattlefields = !deck.battlefields && deck.battlefieldId
    ? { [deck.battlefieldId]: 1 }
    : deck.battlefields

  return {
    legendId: typeof deck.legendId === 'string' && deck.legendId ? deck.legendId : null,
    championId: typeof deck.championId === 'string' && deck.championId ? deck.championId : null,
    cards: sortedCountMap(deck.cards),
    runes: sortedCountMap(deck.runes),
    battlefields: sortedCountMap(legacyBattlefields),
  }
}

export function validateDeck(deck, cards, { allowExactPrecon = true } = {}) {
  const errors = []
  const warnings = []
  const catalog = cardCatalog(cards)
  const definition = deckDefinition(deck)
  const mainEntries = inspectCountMap('cards', deck?.cards, errors)
  const runeEntries = inspectCountMap('runes', deck?.runes, errors)
  const battlefieldSource = !deck?.battlefields && deck?.battlefieldId
    ? { [deck.battlefieldId]: 1 }
    : deck?.battlefields
  const battlefieldEntries = inspectCountMap('battlefields', battlefieldSource, errors)

  const mainDeckCount = totalEntries(mainEntries)
  const runeCount = totalEntries(runeEntries)
  const battlefieldCount = totalEntries(battlefieldEntries)

  if (!definition.legendId) {
    errors.push(issue('LEGEND_REQUIRED', 'Choose exactly one Legend.'))
  } else {
    const legend = catalog.get(definition.legendId)
    if (!legend) {
      errors.push(issue('CARD_NOT_FOUND', `Legend ${definition.legendId} is not in the card catalog.`, {
        zone: 'legend',
        cardId: definition.legendId,
      }))
    } else if (cardType(legend) !== 'Legend') {
      errors.push(issue('INVALID_LEGEND_TYPE', `${cardName(legend, definition.legendId)} is not a Legend.`, {
        cardId: definition.legendId,
        actualType: cardType(legend),
      }))
    }
  }

  if (mainDeckCount !== 40) {
    errors.push(issue('MAIN_DECK_COUNT', `The Main Deck must contain exactly 40 cards; found ${mainDeckCount}.`, {
      expected: 40,
      actual: mainDeckCount,
    }))
  }

  if (runeCount !== 12) {
    errors.push(issue('RUNE_DECK_COUNT', `The Rune Deck must contain exactly 12 cards; found ${runeCount}.`, {
      expected: 12,
      actual: runeCount,
    }))
  }

  if (battlefieldCount !== 3) {
    errors.push(issue('BATTLEFIELD_COUNT', `A deck must contain exactly three Battlefields; found ${battlefieldCount}.`, {
      expected: 3,
      actual: battlefieldCount,
    }))
  }

  const missingIds = new Set()
  const referencedEntries = [
    ...mainEntries.map(([id, count]) => ['cards', id, count]),
    ...runeEntries.map(([id, count]) => ['runes', id, count]),
    ...battlefieldEntries.map(([id, count]) => ['battlefields', id, count]),
  ]

  for (const [zone, id] of referencedEntries) {
    if (!catalog.has(id) && !missingIds.has(id)) {
      missingIds.add(id)
      errors.push(issue('CARD_NOT_FOUND', `${id} is not in the card catalog.`, { zone, cardId: id }))
    }
  }

  for (const [id] of mainEntries) {
    const card = catalog.get(id)
    if (card && !MAIN_DECK_TYPES.has(cardType(card))) {
      errors.push(issue('INVALID_MAIN_DECK_TYPE', `${cardName(card, id)} cannot be placed in the Main Deck.`, {
        zone: 'cards',
        cardId: id,
        actualType: cardType(card),
      }))
    }
  }

  for (const [id] of runeEntries) {
    const card = catalog.get(id)
    if (card && cardType(card) !== 'Rune') {
      errors.push(issue('INVALID_RUNE_TYPE', `${cardName(card, id)} is not a Rune.`, {
        zone: 'runes',
        cardId: id,
        actualType: cardType(card),
      }))
    }
  }

  const battlefieldNames = new Map()
  for (const [id, count] of battlefieldEntries) {
    const card = catalog.get(id)
    if (!card) continue
    if (cardType(card) !== 'Battlefield') {
      errors.push(issue('INVALID_BATTLEFIELD_TYPE', `${cardName(card, id)} is not a Battlefield.`, {
        zone: 'battlefields',
        cardId: id,
        actualType: cardType(card),
      }))
      continue
    }
    if (count !== 1) {
      errors.push(issue('BATTLEFIELD_COPY_COUNT', `${cardName(card, id)} must appear exactly once.`, {
        zone: 'battlefields',
        cardId: id,
        count,
      }))
    }
    const nameKey = normalizedName(card, id)
    const previousId = battlefieldNames.get(nameKey)
    if (previousId) {
      errors.push(issue('DUPLICATE_BATTLEFIELD_NAME', `Battlefields must have unique names; ${cardName(card, id)} appears more than once.`, {
        zone: 'battlefields',
        cardId: id,
        otherCardId: previousId,
      }))
    } else {
      battlefieldNames.set(nameKey, id)
    }
  }

  if (!definition.championId) {
    errors.push(issue('CHOSEN_CHAMPION_REQUIRED', 'Choose one Champion Unit from the Main Deck.'))
  } else {
    const champion = catalog.get(definition.championId)
    if (!champion) {
      if (!missingIds.has(definition.championId)) {
        errors.push(issue('CARD_NOT_FOUND', `Chosen Champion ${definition.championId} is not in the card catalog.`, {
          zone: 'champion',
          cardId: definition.championId,
        }))
      }
    } else if (cardType(champion) !== 'Unit') {
      errors.push(issue('INVALID_CHOSEN_CHAMPION_TYPE', `${cardName(champion, definition.championId)} is not a Unit.`, {
        cardId: definition.championId,
        actualType: cardType(champion),
      }))
    }
    if (!definition.cards[definition.championId]) {
      errors.push(issue('CHOSEN_CHAMPION_NOT_IN_MAIN_DECK', 'The Chosen Champion must be included in the 40-card Main Deck count.', {
        cardId: definition.championId,
      }))
    }
  }

  const mainCopiesByName = new Map()
  for (const [id, count] of mainEntries) {
    const card = catalog.get(id)
    if (!card) continue
    const nameKey = normalizedName(card, id)
    const current = mainCopiesByName.get(nameKey) || { name: cardName(card, id), count: 0, cardIds: [] }
    current.count += count
    current.cardIds.push(id)
    mainCopiesByName.set(nameKey, current)
  }
  for (const copies of mainCopiesByName.values()) {
    if (copies.count > 3) {
      errors.push(issue('MAIN_DECK_COPY_LIMIT', `The Main Deck contains ${copies.count} copies of ${copies.name}; the limit is three across all print variants.`, {
        cardName: copies.name,
        cardIds: copies.cardIds,
        count: copies.count,
        max: 3,
      }))
    }
  }

  const exactPrecon = exactPreconFor(deck)
  const bannedCards = [...new Set([
    definition.legendId,
    ...referencedEntries.map(([, id]) => id),
  ].filter(Boolean))]
    .map((id) => catalog.get(id))
    .filter(isBanned)

  let usedExactPreconException = false
  if (bannedCards.length > 0) {
    const exceptionRecorded = exactPrecon?.validation?.casualExactPreconException === true
    if (allowExactPrecon && exactPrecon && exceptionRecorded) {
      usedExactPreconException = true
      warnings.push(issue(
        'BANNED_CARDS_ALLOWED_ONLY_AS_EXACT_CASUAL_PRECON',
        `This unchanged ${exactPrecon.name} contains banned cards and is allowed only under Riot's Casual exact-preconstructed-deck exception. Any modification removes that exception.`,
        { cardIds: bannedCards.map((card) => card.id), presetId: exactPrecon.id },
      ))
    } else {
      for (const card of bannedCards) {
        errors.push(issue('BANNED_CARD', `${cardName(card, card.id)} is banned.`, {
          cardId: card.id,
          exactPreconRequired: true,
        }))
      }
    }
  }

  const valid = errors.length === 0
  return {
    valid,
    playable: valid,
    fullyVerified: false,
    errors,
    warnings,
    limitations: VALIDATION_LIMITATIONS.map((limitation) => ({ ...limitation })),
    counts: {
      legend: definition.legendId ? 1 : 0,
      mainDeck: mainDeckCount,
      runes: runeCount,
      battlefields: battlefieldCount,
      distinctBattlefieldNames: battlefieldNames.size,
      packagedCards: (definition.legendId ? 1 : 0) + mainDeckCount + runeCount + battlefieldCount,
    },
    exactPrecon: Boolean(exactPrecon),
    exactPreconId: exactPrecon?.id || null,
    usedExactPreconException,
    bannedCardIds: bannedCards.map((card) => card.id),
    rulesContext: usedExactPreconException
      ? 'casual-exact-preconstructed-deck-exception'
      : valid
        ? 'structural-checks-passed-with-catalog-limitations'
        : 'invalid',
    definition,
  }
}

export function championDeckToUserDeck(precon) {
  if (!precon || typeof precon !== 'object' || !precon.id) {
    throw new TypeError('A Champion Deck preset is required.')
  }

  const base = createDeck(precon.name || 'Champion Deck')
  return {
    ...base,
    ...deckDefinition(precon),
    presetId: precon.id,
    exactPrecon: true,
  }
}

export function getPlayableDeckChoices(userDecks, cards) {
  const preconChoices = CHAMPION_DECKS.map((precon) => {
    const validation = validateDeck(precon, cards)
    return {
      id: `precon:${precon.id}`,
      name: precon.name,
      kind: 'precon',
      presetId: precon.id,
      exactPrecon: true,
      ...deckDefinition(precon),
      validation,
    }
  }).filter((choice) => choice.validation.playable)

  const userChoices = (Array.isArray(userDecks) ? userDecks : []).map((deck) => {
    const validation = validateDeck(deck, cards)
    return {
      ...deck,
      ...deckDefinition(deck),
      id: deck.id,
      name: deck.name || 'Untitled deck',
      kind: 'user',
      validation,
    }
  }).filter((choice) => choice.validation.playable)

  return [...preconChoices, ...userChoices]
}
