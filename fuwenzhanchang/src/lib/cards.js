export const SET_NAMES = {
  OGN: 'Origins',
  OGS: 'Origins · Proving Grounds',
  SFD: 'Spiritforged',
  UNL: 'Unleashed',
  VEN: 'Vendetta',
}

export const DOMAIN_COLORS = {
  fury: '#f06a41',
  calm: '#77b9d0',
  mind: '#7f73dd',
  body: '#5fb37b',
  chaos: '#d267a2',
  order: '#d5b257',
  colorless: '#879198',
}

export const titleCase = (value = '') => value.charAt(0).toUpperCase() + value.slice(1)

export function cardImage(card, size = 'medium') {
  return card.image_thumb?.[size] || card.image || ''
}

export function cardSearchText(card) {
  return [card.name, card.type, card.faction, card.set_id, card.rarity].join(' ').toLowerCase()
}

export function deckCount(deck) {
  return Object.values(deck.cards || {}).reduce((sum, count) => sum + count, 0)
}

export function zoneCount(zone = {}) {
  return Object.values(zone).reduce((sum, count) => sum + count, 0)
}

export function deckEntries(deck, cardsById) {
  return Object.entries(deck.cards || {})
    .map(([id, count]) => ({ card: cardsById[id], count }))
    .filter((entry) => entry.card)
    .sort((a, b) => (a.card.stats?.energy ?? 0) - (b.card.stats?.energy ?? 0) || a.card.name.localeCompare(b.card.name))
}
