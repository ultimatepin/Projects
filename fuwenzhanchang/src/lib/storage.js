const KEY = 'rift-local-decks-v1'

function randomId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16)
      globalThis.crypto.getRandomValues(bytes)
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
    }
  } catch {
    // Continue to the timestamp-based identifier when browser crypto is unavailable.
  }
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function loadDecks() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

export function saveDecks(decks) {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks))
    return true
  } catch {
    return false
  }
}

export function createDeck(name = 'Untitled deck') {
  return {
    id: randomId(),
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
