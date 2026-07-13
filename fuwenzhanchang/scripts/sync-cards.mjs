import fs from 'node:fs/promises'

const endpoint = 'https://riftscribe.gg/api/cards'
const pageSize = 200
const cards = []

for (let offset = 0; ; offset += pageSize) {
  const response = await fetch(`${endpoint}?limit=${pageSize}&offset=${offset}`)
  if (!response.ok) throw new Error(`Card API returned ${response.status}`)
  const page = await response.json()
  if (!Array.isArray(page)) throw new Error('Unexpected card API response')
  cards.push(...page)
  process.stdout.write(`\rFetched ${cards.length} cards`)
  if (page.length < pageSize) break
}

await fs.writeFile('public/cards.json', JSON.stringify(cards))
console.log(`\nSaved public/cards.json (${cards.length} English printings).`)
