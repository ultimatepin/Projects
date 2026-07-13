const KEY = 'rift-local-decks-v1'

export function loadDecks() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

export function saveDecks(decks) {
  localStorage.setItem(KEY, JSON.stringify(decks))
}

export function createDeck(name = 'Untitled deck') {
  return {
    id: crypto.randomUUID(),
    name,
    legendId: null,
    championId: null,
    battlefields: {},
    runes: {},
    cards: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}
