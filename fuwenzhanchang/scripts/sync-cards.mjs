import fs from 'node:fs/promises'

const endpoint = 'https://riftscribe.gg/api/cards'
const pageSize = 200
const cards = []

// RiftScribe's public list currently omits the two Spiritforged token fronts
// shipped with the official Fiora and Rumble Champion Decks. Keep these
// catalog-backed so printed token effects use the same bundled card index.
// IDs and quantities are published by Riot's decklists.
const supplementalCards = [
  {
    id: 'sfd-t01',
    name: 'Mech',
    set_id: 'SFD',
    collector_number: 1,
    variant: 't01',
    rarity: 'common',
    faction: 'colorless',
    type: 'Unit',
    orientation: 'portrait',
    stats: { energy: null, might: 3, power: null },
    image: 'https://cardsbeyond.com/cdn/shop/files/MechToken_SFD-T01.jpg?v=1773942007',
    image_thumb: {
      small: 'https://cardsbeyond.com/cdn/shop/files/MechToken_SFD-T01.jpg?v=1773942007&width=320',
      medium: 'https://cardsbeyond.com/cdn/shop/files/MechToken_SFD-T01.jpg?v=1773942007&width=640',
      large: 'https://cardsbeyond.com/cdn/shop/files/MechToken_SFD-T01.jpg?v=1773942007&width=960',
    },
    is_banned: false,
  },
  {
    id: 'sfd-t02',
    name: 'Sand Soldier',
    set_id: 'SFD',
    collector_number: 2,
    variant: 't02',
    rarity: 'common',
    faction: 'colorless',
    type: 'Unit',
    orientation: 'portrait',
    stats: { energy: null, might: 2, power: null },
    image: 'https://cardsbeyond.com/cdn/shop/files/SandSoldierToken_SFD-T02.jpg?v=1773942007',
    image_thumb: {
      small: 'https://cardsbeyond.com/cdn/shop/files/SandSoldierToken_SFD-T02.jpg?v=1773942007&width=320',
      medium: 'https://cardsbeyond.com/cdn/shop/files/SandSoldierToken_SFD-T02.jpg?v=1773942007&width=640',
      large: 'https://cardsbeyond.com/cdn/shop/files/SandSoldierToken_SFD-T02.jpg?v=1773942007&width=960',
    },
    is_banned: false,
  },
]

for (let offset = 0; ; offset += pageSize) {
  const response = await fetch(`${endpoint}?limit=${pageSize}&offset=${offset}`)
  if (!response.ok) throw new Error(`Card API returned ${response.status}`)
  const page = await response.json()
  if (!Array.isArray(page)) throw new Error('Unexpected card API response')
  cards.push(...page)
  process.stdout.write(`\rFetched ${cards.length} cards`)
  if (page.length < pageSize) break
}

for (const card of supplementalCards) {
  if (!cards.some((candidate) => candidate.id.toLowerCase() === card.id)) cards.push(card)
}

await fs.writeFile('public/cards.json', JSON.stringify(cards))
console.log(`\nSaved public/cards.json (${cards.length} English printings).`)
