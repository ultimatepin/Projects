import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveCardResourceCost, planRunePayment, RUNE_DOMAINS } from './runePayment.js'

const catalogObject = {
  fury: { id: 'fury', type: 'Rune', faction: 'fury' },
  calm: { id: 'calm', type: 'Rune', faction: 'calm' },
  mind: { id: 'mind', type: 'Rune', faction: 'mind' },
}

function rune(instanceId, cardId, exhausted = false) {
  return { instanceId, cardId, exhausted }
}

test('exports the six canonical Rune domains and derives catalog card costs', () => {
  assert.deepEqual(RUNE_DOMAINS, ['fury', 'calm', 'mind', 'body', 'chaos', 'order'])
  assert.deepEqual(
    deriveCardResourceCost({ faction: 'fury', stats: { energy: 3, power: 2 } }),
    { energy: 3, powerByDomain: { fury: 2 }, unsupportedPowerByDomain: {} },
  )
  assert.deepEqual(
    deriveCardResourceCost({ faction: 'colorless', stats: { energy: 1, power: 1 } }),
    { energy: 1, powerByDomain: {}, unsupportedPowerByDomain: { colorless: 1 } },
  )
})

test('plans an Energy-only payment from ready Runes in zone order without mutation', () => {
  const runes = [rune('first', 'fury'), rune('second', 'calm'), rune('spent', 'mind', true)]
  const snapshot = structuredClone(runes)
  const plan = planRunePayment({
    card: { faction: 'fury', stats: { energy: 2, power: null } },
    runePool: { energy: 0, powerByDomain: {} },
    runes,
    cardsById: catalogObject,
  })

  assert.equal(plan.affordable, true)
  assert.deepEqual(plan.exhaustIds, ['first', 'second'])
  assert.deepEqual(plan.recycleIds, [])
  assert.deepEqual(plan.deficits, { energy: 2, powerByDomain: {} })
  assert.equal(plan.summaries.payment, 'Exhaust 2 Runes')
  assert.deepEqual(runes, snapshot)
})

test('uses one ready matching Rune for both Energy and Power before recycling it', () => {
  const plan = planRunePayment({
    cost: { energy: 2, powerByDomain: { fury: 1 } },
    runes: [rune('fury-ready', 'fury'), rune('calm-ready', 'calm'), rune('mind-ready', 'mind')],
    cardsById: new Map(Object.entries(catalogObject)),
  })

  assert.equal(plan.affordable, true)
  assert.deepEqual(plan.exhaustIds, ['fury-ready', 'calm-ready'])
  assert.deepEqual(plan.recycleIds, ['fury-ready'])
  assert.deepEqual(plan.recycleByDomain, { fury: ['fury-ready'] })
  assert.deepEqual(plan.generated, { energy: 2, powerByDomain: { fury: 1 } })
  assert.equal(
    plan.summaries.payment,
    'Exhaust 2 Runes; recycle 1 Fury Rune (the same Rune also pays Energy)',
  )
})

test('recycles an exhausted matching Rune when no Energy overlap is needed', () => {
  const plan = planRunePayment({
    cost: { energy: 0, powerByDomain: { fury: 1 } },
    runes: [rune('ready-fury', 'fury'), rune('exhausted-fury', 'fury', true)],
    cardsById: catalogObject,
  })

  assert.equal(plan.affordable, true)
  assert.deepEqual(plan.exhaustIds, [])
  assert.deepEqual(plan.recycleIds, ['exhausted-fury'])
})

test('consumes existing Rune Pool resources before planning Rune activations', () => {
  const plan = planRunePayment({
    cost: { energy: 3, powerByDomain: { fury: 1 } },
    runePool: { energy: 2, powerByDomain: { fury: 1 } },
    runes: [rune('first-ready', 'calm'), rune('second-ready', 'mind')],
    cardsById: catalogObject,
  })

  assert.equal(plan.affordable, true)
  assert.deepEqual(plan.fromPool, { energy: 2, powerByDomain: { fury: 1 } })
  assert.deepEqual(plan.deficits, { energy: 1, powerByDomain: { fury: 0 } })
  assert.deepEqual(plan.exhaustIds, ['first-ready'])
  assert.deepEqual(plan.recycleIds, [])
})

test('selection is deterministic and maximizes ready Rune overlap across Power costs', () => {
  const plan = planRunePayment({
    cost: { energy: 1, powerByDomain: { fury: 1, calm: 1 } },
    runes: [
      rune('fury-exhausted', 'fury', true),
      rune('calm-ready', 'calm'),
      rune('fury-ready', 'fury'),
      rune('extra-ready', 'mind'),
    ],
    cardsById: catalogObject,
  })

  assert.equal(plan.affordable, true)
  assert.deepEqual(plan.exhaustIds, ['calm-ready'])
  assert.deepEqual(plan.recycleIds, ['fury-exhausted', 'calm-ready'])
  assert.deepEqual(plan.recycleByDomain, { fury: ['fury-exhausted'], calm: ['calm-ready'] })
})

test('reports unsupported card Power domains without silently dropping their cost', () => {
  const plan = planRunePayment({
    card: { faction: 'colorless', stats: { energy: 1, power: 1 } },
    runes: [rune('ready', 'fury')],
    cardsById: catalogObject,
  })

  assert.equal(plan.affordable, false)
  assert.deepEqual(plan.exhaustIds, ['ready'])
  assert.deepEqual(plan.shortages.unsupportedPowerByDomain, { colorless: 1 })
  assert.match(plan.summaries.shortage, /Unsupported colorless Power cost/)
})

test('reports exact simultaneous Energy and matching-Power shortages', () => {
  const plan = planRunePayment({
    cost: { energy: 3, powerByDomain: { fury: 2 } },
    runes: [rune('only-fury', 'fury'), rune('spent-calm', 'calm', true)],
    cardsById: catalogObject,
  })

  assert.equal(plan.affordable, false)
  assert.deepEqual(plan.exhaustIds, ['only-fury'])
  assert.deepEqual(plan.recycleIds, ['only-fury'])
  assert.deepEqual(plan.shortages, {
    energy: 2,
    powerByDomain: { fury: 1 },
    unsupportedPowerByDomain: {},
  })
  assert.match(plan.summaries.shortage, /Need 2 more ready Runes for Energy/)
  assert.match(plan.summaries.shortage, /Need 1 more Fury Rune in play/)
})
