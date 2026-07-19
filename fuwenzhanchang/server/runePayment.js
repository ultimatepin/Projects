export const RUNE_DOMAINS = Object.freeze(['fury', 'calm', 'mind', 'body', 'chaos', 'order'])

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return 0
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase()
}

function structuredDomains(value) {
  const domains = value?.domains
    ?? value?.domainIdentity
    ?? value?.domain_identity
    ?? value?.domain
    ?? value?.faction
  if (Array.isArray(domains)) return domains.map(normalizeDomain).filter(Boolean)
  if (typeof domains === 'string') return domains.split(/[,+/]/).map(normalizeDomain).filter(Boolean)
  return []
}

function catalogGet(cardsById, cardId) {
  if (!cardId) return null
  if (cardsById instanceof Map) return cardsById.get(cardId) || null
  return asObject(cardsById)[cardId] || null
}

function normalizePowerByDomain(rawPower) {
  const powerByDomain = {}
  const unsupportedPowerByDomain = {}
  for (const [rawDomain, rawAmount] of Object.entries(asObject(rawPower))) {
    const amount = nonNegativeInteger(rawAmount)
    if (!amount) continue
    const domain = normalizeDomain(rawDomain) || 'unknown'
    const destination = RUNE_DOMAINS.includes(domain) ? powerByDomain : unsupportedPowerByDomain
    destination[domain] = (destination[domain] || 0) + amount
  }
  return { powerByDomain, unsupportedPowerByDomain }
}

function normalizeResourceCost(rawCost) {
  const cost = asObject(rawCost)
  const normalizedPower = normalizePowerByDomain(cost.powerByDomain ?? cost.power)
  const inheritedUnsupported = normalizePowerByDomain(cost.unsupportedPowerByDomain)
  return {
    energy: nonNegativeInteger(cost.energy),
    powerByDomain: normalizedPower.powerByDomain,
    unsupportedPowerByDomain: {
      ...normalizedPower.unsupportedPowerByDomain,
      ...inheritedUnsupported.unsupportedPowerByDomain,
    },
  }
}

/**
 * Derive the normal printed Energy and Power cost represented by the catalog.
 * Unsupported Power domains remain explicit so callers cannot silently make
 * an incompletely described card free.
 */
export function deriveCardResourceCost(card) {
  const value = asObject(card)
  const stats = asObject(value.stats)
  const structuredPower = stats.powerByDomain ?? value.powerByDomain
  if (structuredPower && typeof structuredPower === 'object') {
    return normalizeResourceCost({
      energy: stats.energy ?? value.energy,
      powerByDomain: structuredPower,
    })
  }

  const energy = nonNegativeInteger(stats.energy ?? value.energy)
  const power = nonNegativeInteger(stats.power ?? value.power)
  if (!power) return { energy, powerByDomain: {}, unsupportedPowerByDomain: {} }

  const domain = structuredDomains(value)[0] || 'unknown'
  if (RUNE_DOMAINS.includes(domain)) {
    return { energy, powerByDomain: { [domain]: power }, unsupportedPowerByDomain: {} }
  }
  return { energy, powerByDomain: {}, unsupportedPowerByDomain: { [domain]: power } }
}

function normalizeRunes(runes, cardsById) {
  return (Array.isArray(runes) ? runes : []).map((rawRune, index) => {
    const rune = typeof rawRune === 'string'
      ? { instanceId: rawRune, cardId: rawRune }
      : asObject(rawRune)
    const instanceId = String(rune.instanceId ?? rune.id ?? '')
    const card = catalogGet(cardsById, rune.cardId)
    const domain = structuredDomains(rune)[0] || structuredDomains(card)[0] || 'unknown'
    return {
      index,
      instanceId,
      domain,
      exhausted: Boolean(rune.exhausted),
    }
  }).filter((rune) => rune.instanceId)
}

function resourceSummary(resources, { includeUnsupported = false } = {}) {
  const parts = []
  if (resources.energy) parts.push(`${resources.energy} Energy`)
  for (const domain of RUNE_DOMAINS) {
    const amount = nonNegativeInteger(resources.powerByDomain?.[domain])
    if (amount) parts.push(`${amount} ${domain[0].toUpperCase()}${domain.slice(1)} Power`)
  }
  if (includeUnsupported) {
    for (const [domain, rawAmount] of Object.entries(resources.unsupportedPowerByDomain || {})) {
      const amount = nonNegativeInteger(rawAmount)
      if (amount) parts.push(`${amount} ${domain} Power`)
    }
  }
  return parts.join(' + ') || 'No resources'
}

function plural(value, singular, pluralValue = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralValue}`
}

/**
 * Build a deterministic, non-mutating Rune payment plan.
 *
 * Energy and same-domain Power already in the Rune Pool are consumed first.
 * A ready Rune chosen for Power may be exhausted for Energy before it is
 * recycled. Selections preserve Rune-zone order, and the overlap policy keeps
 * as many otherwise usable Runes ready as possible.
 */
export function planRunePayment({ card, cost: rawCost, runePool, runes, cardsById } = {}) {
  const cost = rawCost === undefined ? deriveCardResourceCost(card) : normalizeResourceCost(rawCost)
  const pool = asObject(runePool)
  const poolPower = asObject(pool.powerByDomain ?? pool.power)
  const normalizedRunes = normalizeRunes(runes, cardsById)

  const fromPool = { energy: Math.min(cost.energy, nonNegativeInteger(pool.energy)), powerByDomain: {} }
  const deficits = { energy: cost.energy - fromPool.energy, powerByDomain: {} }
  for (const domain of RUNE_DOMAINS) {
    const required = nonNegativeInteger(cost.powerByDomain[domain])
    if (!required) continue
    const available = nonNegativeInteger(poolPower[domain])
    fromPool.powerByDomain[domain] = Math.min(required, available)
    deficits.powerByDomain[domain] = required - fromPool.powerByDomain[domain]
  }

  const domainPlans = RUNE_DOMAINS.map((domain) => {
    const needed = nonNegativeInteger(deficits.powerByDomain[domain])
    const matching = normalizedRunes.filter((rune) => rune.domain === domain)
    const ready = matching.filter((rune) => !rune.exhausted)
    const exhausted = matching.filter((rune) => rune.exhausted)
    const target = Math.min(needed, matching.length)
    const mandatoryReady = Math.max(0, target - exhausted.length)
    const optionalReadyCapacity = Math.min(target - mandatoryReady, ready.length - mandatoryReady)
    return { domain, needed, ready, exhausted, target, mandatoryReady, optionalReadyCapacity }
  })

  const mandatoryReadyTotal = domainPlans.reduce((total, plan) => total + plan.mandatoryReady, 0)
  let optionalOverlapBudget = Math.max(0, deficits.energy - mandatoryReadyTotal)
  const recycleSet = new Set()
  const recycleByDomain = {}

  for (const domainPlan of domainPlans) {
    if (!domainPlan.target) continue
    const optionalReady = Math.min(domainPlan.optionalReadyCapacity, optionalOverlapBudget)
    optionalOverlapBudget -= optionalReady
    const readyCount = domainPlan.mandatoryReady + optionalReady
    const exhaustedCount = domainPlan.target - readyCount
    const selected = [
      ...domainPlan.ready.slice(0, readyCount),
      ...domainPlan.exhausted.slice(0, exhaustedCount),
    ]
    recycleByDomain[domainPlan.domain] = selected
      .sort((left, right) => left.index - right.index)
      .map((rune) => rune.instanceId)
    for (const rune of selected) recycleSet.add(rune.instanceId)
  }

  const readyRecycleRunes = normalizedRunes.filter((rune) => !rune.exhausted && recycleSet.has(rune.instanceId))
  const otherReadyRunes = normalizedRunes.filter((rune) => !rune.exhausted && !recycleSet.has(rune.instanceId))
  const exhaustIds = [...readyRecycleRunes, ...otherReadyRunes]
    .slice(0, deficits.energy)
    .map((rune) => rune.instanceId)
  const recycleIds = normalizedRunes
    .filter((rune) => recycleSet.has(rune.instanceId))
    .map((rune) => rune.instanceId)

  const powerShortages = {}
  for (const domainPlan of domainPlans) {
    const shortage = domainPlan.needed - domainPlan.target
    if (shortage > 0) powerShortages[domainPlan.domain] = shortage
  }
  const shortages = {
    energy: Math.max(0, deficits.energy - normalizedRunes.filter((rune) => !rune.exhausted).length),
    powerByDomain: powerShortages,
    unsupportedPowerByDomain: { ...cost.unsupportedPowerByDomain },
  }
  const affordable = shortages.energy === 0
    && Object.keys(shortages.powerByDomain).length === 0
    && Object.keys(shortages.unsupportedPowerByDomain).length === 0

  const paymentParts = []
  if (exhaustIds.length) paymentParts.push(`Exhaust ${plural(exhaustIds.length, 'Rune')}`)
  for (const domain of RUNE_DOMAINS) {
    const ids = recycleByDomain[domain] || []
    if (ids.length) {
      const overlap = ids.filter((instanceId) => exhaustIds.includes(instanceId)).length
      const overlapNote = overlap === 1
        ? ' (the same Rune also pays Energy)'
        : overlap > 1
          ? ` (${overlap} of those Runes also pay Energy)`
          : ''
      paymentParts.push(`recycle ${plural(ids.length, `${domain[0].toUpperCase()}${domain.slice(1)} Rune`)}${overlapNote}`)
    }
  }
  const shortageParts = []
  if (shortages.energy) shortageParts.push(`Need ${plural(shortages.energy, 'more ready Rune')} for Energy`)
  for (const domain of RUNE_DOMAINS) {
    const amount = shortages.powerByDomain[domain]
    if (amount) shortageParts.push(`Need ${plural(amount, `more ${domain[0].toUpperCase()}${domain.slice(1)} Rune`)} in play`)
  }
  for (const [domain, amount] of Object.entries(shortages.unsupportedPowerByDomain)) {
    shortageParts.push(`Unsupported ${domain} Power cost (${amount})`)
  }

  return {
    affordable,
    cost,
    fromPool,
    deficits,
    shortages,
    exhaustIds,
    recycleIds,
    recycleByDomain,
    generated: {
      energy: exhaustIds.length,
      powerByDomain: Object.fromEntries(
        RUNE_DOMAINS
          .map((domain) => [domain, recycleByDomain[domain]?.length || 0])
          .filter(([, amount]) => amount > 0),
      ),
    },
    summaries: {
      cost: resourceSummary(cost, { includeUnsupported: true }),
      payment: paymentParts.join('; ') || 'Use resources already in the Rune Pool',
      shortage: shortageParts.join('; '),
    },
  }
}
