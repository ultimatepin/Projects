import { useState } from 'react'

const EFFECT_OPERATIONS = [
  ['draw', 'Draw cards'],
  ['discard', 'Discard a card'],
  ['recycle', 'Recycle a card'],
  ['banish', 'Banish a card'],
  ['damage', 'Damage a unit'],
  ['heal', 'Heal a unit'],
  ['kill', 'Kill a unit or gear'],
  ['recall', 'Recall from a battlefield'],
  ['move', 'Move a unit'],
  ['buff', 'Give a unit +1 Might'],
  ['ready', 'Ready a public card'],
  ['exhaust', 'Exhaust a public card'],
  ['channel', 'Channel runes'],
  ['gain_points', 'Gain points'],
  ['gain_xp', 'Gain XP'],
  ['spend_xp', 'Spend XP'],
  ['create_token', 'Create official tokens'],
]
const PLAYER_EFFECT_OPERATIONS = new Set(['draw', 'channel', 'gain_points', 'gain_xp', 'spend_xp', 'create_token'])
const AMOUNT_EFFECT_OPERATIONS = new Set(['draw', 'damage', 'heal', 'channel', 'gain_points', 'gain_xp', 'spend_xp', 'create_token'])
const DOMAINS = ['fury', 'calm', 'mind', 'body', 'chaos', 'order']

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function zoneData(zone) {
  if (Array.isArray(zone)) return { cards: zone, count: zone.length }
  if (typeof zone === 'string') return { cards: [zone], count: 1 }
  if (typeof zone === 'number') return { cards: [], count: zone }
  if (!zone || typeof zone !== 'object') return { cards: [], count: 0 }
  if (zone.cardId || zone.instanceId) return { cards: [zone], count: 1 }
  const cards = asArray(zone.cards)
  const count = Number.isFinite(Number(zone.count)) ? Number(zone.count) : cards.length
  return { cards, count }
}

function battlefieldUnits(battlefield) {
  return zoneData(battlefield?.units ?? battlefield?.cards).cards
}

function normalizedInstance(value, index = 0, prefix = 'card') {
  if (typeof value === 'string') {
    return { instanceId: value, cardId: value, _key: `${prefix}-${value}-${index}` }
  }
  const instance = value && typeof value === 'object' ? value : {}
  const cardId = instance.cardId || instance.card?.id || null
  const instanceId = instance.instanceId || instance.id || `${prefix}-${cardId || 'hidden'}-${index}`
  return { ...instance, instanceId, cardId, _key: `${prefix}-${instanceId}-${index}` }
}

function cardLookup(cardsById, cardId) {
  if (!cardId) return null
  if (cardsById instanceof Map) return cardsById.get(cardId) || null
  return cardsById?.[cardId] || null
}

function cardCatalogValues(cardsById) {
  if (cardsById instanceof Map) return [...cardsById.values()]
  return cardsById && typeof cardsById === 'object' ? Object.values(cardsById) : []
}

function isOfficialTokenCard(card) {
  const id = String(card?.id || '').toLowerCase()
  const variant = String(card?.variant || '').toLowerCase()
  const type = String(card?.type || '').toLowerCase()
  if (!['unit', 'gear'].includes(type)) return false
  const originToken = /^ogn-(271|272|273|274)(?:-|$)/.test(id)
    && type === 'unit'
    && String(card?.faction || '').toLowerCase() === 'colorless'
    && Number(card?.stats?.energy ?? card?.energy ?? 0) === 0
  const tokenVariant = /^t\d{2,}$/.test(variant)
    && String(card?.faction || '').toLowerCase() === 'colorless'
  return originToken || tokenVariant
}

function cardImage(card) {
  return card?.image_thumb?.medium
    || card?.image_thumb?.small
    || card?.image
    || ''
}

function normalCardSpend(card) {
  const energy = Math.max(0, Math.trunc(Number(card?.stats?.energy ?? card?.energy) || 0))
  const power = Math.max(0, Math.trunc(Number(card?.stats?.power ?? card?.power) || 0))
  const domain = String(card?.faction || '').trim().toLowerCase()
  return {
    energy,
    powerByDomain: power > 0 && DOMAINS.includes(domain) ? { [domain]: power } : {},
  }
}

function currentUnitMight(cardsById, instance) {
  const card = cardLookup(cardsById, instance.cardId)
  const printed = Number(card?.stats?.might ?? card?.might)
  return Math.max(0, (Number.isFinite(printed) ? printed : 0) + (instance.buff ? 1 : 0))
}

function defaultCombatAllocations(cardsById, instances, total) {
  let remaining = Math.max(0, Math.trunc(Number(total) || 0))
  const allocations = []
  instances.forEach((instance, index) => {
    if (remaining < 1) return
    const lethal = Math.max(1, currentUnitMight(cardsById, instance) - (Number(instance.damage) || 0))
    const isLastTarget = index === instances.length - 1
    const amount = isLastTarget ? remaining : Math.min(remaining, lethal)
    allocations.push({ instanceId: instance.instanceId, amount })
    remaining -= amount
  })
  return allocations
}

function playerName(players, playerId, fallback = 'Player') {
  return players.find((player) => player.id === playerId)?.name || fallback
}

function actionId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {
    // The timestamp fallback also works in non-secure LAN browser contexts.
  }
  return `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function ackMessage(response) {
  if (typeof response?.error === 'string') return response.error
  return response?.error?.message || response?.message || 'The host rejected that action.'
}

function OfficialCardArt({ card, hidden = false }) {
  const image = !hidden && cardImage(card)
  return (
    <span className={`official-game__art ${hidden ? 'official-game__art--hidden' : ''}`}>
      {image && <img src={image} alt={card?.name || 'Riftbound card'} onError={(event) => { event.currentTarget.hidden = true }} />}
      <span className="official-game__art-fallback">{hidden ? 'RIFTBOUND' : card?.name || 'Unknown card'}</span>
    </span>
  )
}

function InstanceCard({
  value,
  index,
  prefix,
  cardsById,
  selected,
  selectable,
  onSelect,
  label,
  compact = false,
}) {
  const instance = normalizedInstance(value, index, prefix)
  const card = cardLookup(cardsById, instance.cardId)
  const hidden = Boolean(instance.faceDown || !instance.cardId)
  const classes = [
    'official-game__instance',
    compact ? 'official-game__instance--compact' : '',
    instance.exhausted ? 'official-game__instance--exhausted' : '',
    selected === instance.instanceId ? 'official-game__instance--selected' : '',
    hidden ? 'official-game__instance--hidden' : '',
  ].filter(Boolean).join(' ')
  const content = (
    <>
      <OfficialCardArt card={card} hidden={hidden} />
      <span className="official-game__instance-name">{hidden ? 'Face-down card' : card?.name || instance.cardId || 'Unknown card'}</span>
      {(Number(instance.damage) > 0 || Number(instance.buff) !== 0) && (
        <span className="official-game__instance-counters">
          {Number(instance.damage) > 0 && <b>Damage {instance.damage}</b>}
          {Number(instance.buff) !== 0 && <b>Buff {Number(instance.buff) > 0 ? '+' : ''}{instance.buff}</b>}
        </span>
      )}
    </>
  )

  return selectable ? (
    <button
      type="button"
      className={classes}
      aria-pressed={selected === instance.instanceId}
      aria-label={label || `Select ${card?.name || 'card'}`}
      onClick={() => onSelect?.(instance)}
    >
      {content}
    </button>
  ) : <span className={classes}>{content}</span>
}

function CardZone({
  title,
  zone,
  cardsById,
  prefix,
  selected,
  selectable = false,
  onSelect,
  empty = 'Empty',
  compact = false,
}) {
  const data = zoneData(zone)
  return (
    <section className={`official-game__zone ${compact ? 'official-game__zone--compact' : ''}`}>
      <header className="official-game__zone-title"><strong>{title}</strong><span>{data.count}</span></header>
      <div className="official-game__zone-cards">
        {data.cards.length > 0
          ? data.cards.map((value, index) => (
            <InstanceCard
              key={normalizedInstance(value, index, prefix)._key}
              value={value}
              index={index}
              prefix={prefix}
              cardsById={cardsById}
              selected={selected}
              selectable={selectable}
              onSelect={onSelect}
              compact={compact}
            />
          ))
          : <span className="official-game__empty">{empty}</span>}
      </div>
    </section>
  )
}

function IdentityCard({ title, zone, cardsById, selected, selectable, onSelect, prefix }) {
  const data = zoneData(zone)
  const value = data.cards[0]
  return (
    <section className="official-game__identity-card">
      <small>{title}</small>
      {value ? (
        <InstanceCard
          value={value}
          index={0}
          prefix={prefix}
          cardsById={cardsById}
          selected={selected}
          selectable={selectable}
          onSelect={onSelect}
          compact
        />
      ) : <span className="official-game__empty">Not available</span>}
    </section>
  )
}

function RunePool({ player, cardsById, canAct, pending, onUseRune }) {
  const runeZone = zoneData(player?.zones?.runes)
  const pool = player?.runePool || {}
  const power = pool.powerByDomain && typeof pool.powerByDomain === 'object' ? pool.powerByDomain : {}
  return (
    <section className="official-game__runes">
      <header className="official-game__rune-summary">
        <strong>Runes & resources</strong>
        <span>Energy {Number(pool.energy) || 0}</span>
        <span>Rune deck {zoneData(player?.zones?.runeDeck).count}</span>
      </header>
      <div className="official-game__power-list">
        {DOMAINS.map((domain) => <span key={domain}>{domain} {Number(power[domain]) || 0}</span>)}
      </div>
      <div className="official-game__rune-cards">
        {runeZone.cards.length > 0 ? runeZone.cards.map((value, index) => {
          const instance = normalizedInstance(value, index, `rune-${player?.id}`)
          const card = cardLookup(cardsById, instance.cardId)
          return (
            <article className={`official-game__rune ${instance.exhausted ? 'official-game__rune--exhausted' : ''}`} key={instance._key}>
              <OfficialCardArt card={card} hidden={instance.faceDown} />
              <strong>{card?.name || 'Rune'}</strong>
              <div className="official-game__rune-actions">
                <button type="button" disabled={!canAct || Boolean(pending) || instance.exhausted} onClick={() => onUseRune(instance.instanceId, 'energy')}>Energy</button>
                <button type="button" disabled={!canAct || Boolean(pending)} onClick={() => onUseRune(instance.instanceId, 'power')}>Power</button>
              </div>
            </article>
          )
        }) : <span className="official-game__empty">No runes in play</span>}
      </div>
    </section>
  )
}

function PlayerSummary({ player, self, cardsById, selected, canAct, pending, onSelect, onUseRune }) {
  const zones = player?.zones || {}
  return (
    <section className={`official-game__player ${self ? 'official-game__player--self' : 'official-game__player--opponent'}`}>
      <header className="official-game__player-header">
        <span className="official-game__avatar">{player?.name?.slice(0, 2).toUpperCase() || '??'}</span>
        <span><small>{self ? 'You' : 'Opponent'}</small><strong>{player?.name || 'Player'}</strong></span>
        <b className="official-game__score">{Number(player?.score) || 0}<small>/ 8</small></b>
        <span className="official-game__xp">XP {Number(player?.xp) || 0}</span>
      </header>
      <div className="official-game__identity-row">
        <IdentityCard title="Legend" zone={zones.legend} cardsById={cardsById} prefix={`legend-${player?.id}`} />
        <IdentityCard
          title="Champion"
          zone={zones.champion}
          cardsById={cardsById}
          prefix={`champion-${player?.id}`}
          selected={selected}
          selectable={self}
          onSelect={(instance) => onSelect?.(instance, 'champion')}
        />
        <div className="official-game__private-counts">
          <span><b>{zoneData(zones.hand).count}</b> Hand</span>
          <span><b>{zoneData(zones.mainDeck).count}</b> Main deck</span>
          <span><b>{zoneData(zones.trash).count}</b> Trash</span>
          <span><b>{zoneData(zones.banishment).count}</b> Banished</span>
        </div>
      </div>
      <RunePool player={player} cardsById={cardsById} canAct={self && canAct} pending={pending} onUseRune={onUseRune} />
    </section>
  )
}

function Battlefield({ battlefield, index, players, selfId, cardsById, selected, onSelect }) {
  const field = battlefield || { instanceId: `missing-battlefield-${index}` }
  const card = cardLookup(cardsById, field.cardId)
  const units = battlefieldUnits(field)
  return (
    <section className={`official-game__battlefield ${field.contestedByPlayerId ? 'official-game__battlefield--contested' : ''}`}>
      <header className="official-game__battlefield-header">
        <span>Battlefield {index + 1}</span>
        <strong>{card?.name || 'Battlefield not revealed'}</strong>
        <small>
          {field.controllerPlayerId
            ? `Controlled by ${playerName(players, field.controllerPlayerId)}`
            : 'Uncontrolled'}
          {field.contestedByPlayerId ? ` · contested by ${playerName(players, field.contestedByPlayerId)}` : ''}
        </small>
      </header>
      <OfficialCardArt card={card} hidden={!field.cardId} />
      <div className="official-game__battlefield-units">
        {units.length > 0 ? units.map((value, unitIndex) => {
          const instance = normalizedInstance(value, unitIndex, `field-${field.instanceId}`)
          const own = (instance.controllerPlayerId || instance.ownerPlayerId || field.controllerPlayerId) === selfId
          return (
            <InstanceCard
              key={instance._key}
              value={instance}
              index={unitIndex}
              prefix={`field-${field.instanceId}`}
              cardsById={cardsById}
              selected={selected}
              selectable={own}
              onSelect={(chosen) => onSelect?.(chosen, 'battlefield', field.instanceId)}
              compact
            />
          )
        }) : <span className="official-game__empty">No units here</span>}
      </div>
    </section>
  )
}

function logText(entry) {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object') return String(entry || '')
  return entry.message || entry.summary || entry.description || JSON.stringify(entry)
}

export default function OfficialGameBoard({
  room,
  socket,
  cardsById,
  connected,
  error,
  onClearError,
  onLeave,
  onError,
}) {
  const game = room?.game
  const selfId = room?.selfId
  const players = asArray(game?.players)
  const self = players.find((player) => player.id === selfId) || null
  const opponent = players.find((player) => player.id !== selfId) || null
  const turn = game?.turn || {}
  const battlefields = asArray(game?.battlefields).slice(0, 2)
  while (battlefields.length < 2) battlefields.push(null)

  const [selected, setSelected] = useState(null)
  const [mulliganIds, setMulliganIds] = useState([])
  const [pending, setPending] = useState('')
  const [localError, setLocalError] = useState('')
  const [damageTarget, setDamageTarget] = useState('')
  const [effect, setEffect] = useState({
    description: '',
    operation: 'draw',
    target: '',
    destination: '',
    tokenCardId: '',
    amount: 1,
    exhausted: false,
    tokenExhausted: true,
  })

  const status = game?.status || 'loading'
  const phase = String(turn.phase || turn.state || '').toLowerCase()
  const activePlayerId = turn.activePlayerId
  const focusPlayerId = turn.focusPlayerId
  const hasFocus = !focusPlayerId ? activePlayerId === selfId : focusPlayerId === selfId
  const awaitingCombatAssignment = ['assign-attacker', 'assign-defender'].includes(String(game?.combat?.stage || '').toLowerCase())
  const canTakeAction = Boolean(connected && status === 'playing' && hasFocus && !pending && !awaitingCombatAssignment)
  const canTakeTurnAction = Boolean(canTakeAction && activePlayerId === selfId)
  const displayedError = error || localError

  function reportError(message) {
    setLocalError(message)
    onError?.(message)
  }

  function clearError() {
    setLocalError('')
    onClearError?.()
  }

  function sendAction(type, payload = {}, onSuccess) {
    if (!connected || !socket?.emit || pending) {
      reportError(connected ? 'Another action is still being processed.' : 'Reconnect to the host before acting.')
      return
    }
    clearError()
    setPending(type)
    const body = { type, payload, actionId: actionId() }
    const emitter = typeof socket.timeout === 'function' ? socket.timeout(8000) : socket
    emitter.emit('game:action', body, (first, second) => {
      const timedEmitter = typeof socket.timeout === 'function'
      const timeoutFailure = timedEmitter && second === undefined && first instanceof Error
        ? first
        : timedEmitter && second !== undefined
          ? first
          : first instanceof Error
            ? first
            : null
      const response = timedEmitter && second !== undefined ? second : first
      setPending('')
      if (timeoutFailure) {
        reportError('The host did not answer. Check the local connection and try again.')
        return
      }
      if (!response?.ok) {
        reportError(ackMessage(response))
        return
      }
      onSuccess?.(response)
    })
  }

  function chooseOwnCard(instance, zone, battlefieldId = null) {
    if (!selfId) return
    const ownerId = instance.controllerPlayerId || instance.ownerPlayerId || selfId
    if (ownerId !== selfId) return
    if (['base', 'battlefield'].includes(zone)) {
      const card = cardLookup(cardsById, instance.cardId)
      if (String(card?.type || '').toLowerCase() !== 'unit') {
        reportError('Only Units can use a Standard Move.')
        return
      }
    }
    setSelected((current) => current?.instanceId === instance.instanceId
      ? null
      : { ...instance, zone, battlefieldId })
  }

  function toggleMulligan(instanceId) {
    if (self?.mulliganSubmitted) return
    if (mulliganIds.includes(instanceId)) {
      setMulliganIds(mulliganIds.filter((id) => id !== instanceId))
      return
    }
    if (mulliganIds.length >= 2) {
      reportError('You may replace at most two cards during the mulligan.')
      return
    }
    clearError()
    setMulliganIds([...mulliganIds, instanceId])
  }

  function playSelected(destination) {
    if (!selected || !['hand', 'champion'].includes(selected.zone)) return
    const card = cardLookup(cardsById, selected.cardId)
    const spend = normalCardSpend(card)
    if ((Number(card?.stats?.power ?? card?.power) || 0) > 0 && Object.keys(spend.powerByDomain).length === 0) {
      reportError('This card has a Power cost but no supported domain. Resolve its cost before playing it.')
      return
    }
    sendAction('PLAY_CARD', {
      instanceId: selected.instanceId,
      from: selected.zone,
      destination,
      spend,
    }, () => setSelected(null))
  }

  function moveSelected(destination) {
    if (!selected || !['base', 'battlefield'].includes(selected.zone)) return
    sendAction('STANDARD_MOVE', {
      unitIds: [selected.instanceId],
      destination,
    }, () => setSelected(null))
  }

  if (!game) {
    return (
      <main className="official-game official-game--unavailable">
        <header className="official-game__topbar"><button type="button" onClick={onLeave}>Leave match</button><strong>Official game state unavailable</strong></header>
        <p>The room has not supplied a serialized official game yet.</p>
        {displayedError && <button type="button" className="official-game__error" onClick={clearError}>{displayedError}</button>}
      </main>
    )
  }

  const selfHand = zoneData(self?.zones?.hand)
  const controlledBattlefields = battlefields.filter((field) => field?.controllerPlayerId === selfId)
  const combat = game.combat && typeof game.combat === 'object' ? game.combat : null
  const combatBattlefield = battlefields.find((field) => field?.instanceId === combat?.battlefieldId)
  const combatAttackerId = combat?.attackerPlayerId || combat?.attackerId
  const combatDefenderId = combat?.defenderPlayerId || combat?.defenderId
  const opposingCombatUnits = battlefieldUnits(combatBattlefield)
    .map((value, index) => normalizedInstance(value, index, 'combat'))
    .filter((instance) => (instance.controllerPlayerId || instance.ownerPlayerId) !== selfId)
  const legalDamageTarget = opposingCombatUnits.some((instance) => instance.instanceId === damageTarget)
    ? damageTarget
    : opposingCombatUnits[0]?.instanceId || ''
  const mightTotals = combat?.mightTotals && typeof combat.mightTotals === 'object' ? combat.mightTotals : {}
  const combatRole = combatAttackerId === selfId ? 'attacker' : combatDefenderId === selfId ? 'defender' : ''
  const ownCombatMight = Math.max(0, Number(mightTotals[selfId] ?? mightTotals[combatRole]) || 0)
  const orderedCombatTargets = legalDamageTarget
    ? [
        opposingCombatUnits.find((instance) => instance.instanceId === legalDamageTarget),
        ...opposingCombatUnits.filter((instance) => instance.instanceId !== legalDamageTarget),
      ].filter(Boolean)
    : opposingCombatUnits
  const combatAllocations = defaultCombatAllocations(cardsById, orderedCombatTargets, ownCombatMight)
  const expectedDamagePlayerId = combat?.stage === 'assign-attacker'
    ? combatAttackerId
    : combat?.stage === 'assign-defender'
      ? combatDefenderId
      : null
  const canAssignCombat = Boolean(connected && status === 'playing' && !pending && expectedDamagePlayerId === selfId)

  const effectInstances = []
  for (const player of players) {
    for (const zoneName of ['legend', 'champion', 'base', 'runes', 'trash', 'banishment']) {
      zoneData(player?.zones?.[zoneName]).cards.forEach((value, index) => {
        const instance = normalizedInstance(value, index, `${player.id}-${zoneName}`)
        if (instance.instanceId) effectInstances.push({ ...instance, zoneName, playerId: player.id })
      })
    }
    if (player.id === selfId) {
      zoneData(player?.zones?.hand).cards.forEach((value, index) => {
        const instance = normalizedInstance(value, index, `${player.id}-hand`)
        if (instance.instanceId) effectInstances.push({ ...instance, zoneName: 'hand', playerId: player.id })
      })
    }
  }
  battlefields.forEach((field) => battlefieldUnits(field).forEach((value, index) => {
    const instance = normalizedInstance(value, index, `effect-${field?.instanceId}`)
    if (instance.instanceId) {
      effectInstances.push({
        ...instance,
        zoneName: 'battlefield',
        battlefieldId: field?.instanceId,
        playerId: instance.controllerPlayerId || instance.ownerPlayerId,
      })
    }
  }))
  const uniqueEffectInstances = [...new Map(effectInstances.map((instance) => [instance.instanceId, instance])).values()]
  const legalCardEffectTargets = uniqueEffectInstances.filter((instance) => {
    const card = cardLookup(cardsById, instance.cardId)
    const type = String(card?.type || '').toLowerCase()
    const onBoard = ['base', 'battlefield'].includes(instance.zoneName)
    const controlledBySelf = (instance.controllerPlayerId || instance.ownerPlayerId) === selfId
    if (effect.operation === 'discard') return instance.zoneName === 'hand' && instance.playerId === selfId
    if (effect.operation === 'recycle' || effect.operation === 'banish') {
      if (instance.faceDown && !controlledBySelf) return false
      return ['hand', 'base', 'battlefield', 'runes', 'trash', 'banishment'].includes(instance.zoneName)
    }
    if (instance.faceDown) return false
    if (effect.operation === 'damage' || effect.operation === 'heal') return onBoard && type === 'unit'
    if (effect.operation === 'kill') return onBoard && ['unit', 'gear'].includes(type)
    if (effect.operation === 'recall') return instance.zoneName === 'battlefield' && ['unit', 'gear'].includes(type)
    if (effect.operation === 'move' || effect.operation === 'buff') return onBoard && type === 'unit'
    return ['base', 'battlefield', 'runes', 'legend'].includes(instance.zoneName)
  })
  const effectTargets = PLAYER_EFFECT_OPERATIONS.has(effect.operation)
    ? [...players]
        .sort((left, right) => Number(right.id === selfId) - Number(left.id === selfId))
        .map((player) => ({ value: `player:${player.id}`, label: `${player.name || 'Player'} · ${player.id === selfId ? 'you' : 'opponent'}` }))
    : legalCardEffectTargets.map((instance) => {
      const card = cardLookup(cardsById, instance.cardId)
      const location = instance.zoneName === 'battlefield'
        ? cardLookup(cardsById, battlefields.find((field) => field?.instanceId === instance.battlefieldId)?.cardId)?.name || 'battlefield'
        : instance.zoneName
      const controller = playerName(players, instance.controllerPlayerId || instance.playerId || instance.ownerPlayerId, 'public')
      return {
        value: `card:${instance.instanceId}`,
        label: `${card?.name || instance.cardId || 'Card'} · ${location} · ${controller}`,
      }
    })
  const legalEffectTarget = effectTargets.some((target) => target.value === effect.target)
    ? effect.target
    : effectTargets[0]?.value || ''
  const selectedEffectInstanceId = legalEffectTarget.startsWith('card:')
    ? legalEffectTarget.slice('card:'.length)
    : ''
  const selectedEffectInstance = uniqueEffectInstances.find((instance) => instance.instanceId === selectedEffectInstanceId)
  const moveDestinations = effect.operation === 'move' && selectedEffectInstance
    ? [
        ...(selectedEffectInstance.zoneName === 'base'
          ? []
          : [{ value: 'base', label: `${playerName(players, selectedEffectInstance.controllerPlayerId || selectedEffectInstance.ownerPlayerId)}'s base` }]),
        ...battlefields.filter((field) => field && field.instanceId !== selectedEffectInstance.battlefieldId).map((field, index) => ({
          value: field.instanceId,
          label: cardLookup(cardsById, field.cardId)?.name || `Battlefield ${index + 1}`,
        })),
      ]
    : []
  const tokenCards = cardCatalogValues(cardsById)
    .filter(isOfficialTokenCard)
    .sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)))
  const legalTokenCardId = tokenCards.some((card) => card.id === effect.tokenCardId)
    ? effect.tokenCardId
    : tokenCards[0]?.id || ''
  const selectedTokenCard = cardLookup(cardsById, legalTokenCardId)
  const tokenPlayerId = legalEffectTarget.startsWith('player:') ? legalEffectTarget.slice('player:'.length) : selfId
  const tokenDestinations = effect.operation === 'create_token' && selectedTokenCard
    ? [
        { value: 'base', label: `${playerName(players, tokenPlayerId)}'s base` },
        ...(String(selectedTokenCard.type || '').toLowerCase() === 'unit'
          ? battlefields.filter(Boolean).map((field, index) => ({
              value: field.instanceId,
              label: cardLookup(cardsById, field.cardId)?.name || `Battlefield ${index + 1}`,
            }))
          : []),
      ]
    : []
  const effectDestinations = effect.operation === 'create_token' ? tokenDestinations : moveDestinations
  const legalEffectDestination = effectDestinations.some((destination) => destination.value === effect.destination)
    ? effect.destination
    : effectDestinations[0]?.value || ''

  function applyManualEffect() {
    const description = effect.description.trim()
    const amountLimit = effect.operation === 'channel' ? 12 : 20
    const amount = Math.max(1, Math.min(amountLimit, Number(effect.amount) || 1))
    const requiresDestination = effect.operation === 'move' || effect.operation === 'create_token'
    if (
      !description
      || !legalEffectTarget
      || (requiresDestination && !legalEffectDestination)
      || (effect.operation === 'create_token' && !legalTokenCardId)
    ) {
      reportError('Describe the printed effect and choose a legal target first.')
      return
    }
    const [kind, ...targetParts] = legalEffectTarget.split(':')
    const targetId = targetParts.join(':')
    let operation
    if (effect.operation === 'draw') {
      operation = { type: 'draw', playerId: targetId, count: amount }
    } else if (effect.operation === 'channel') {
      operation = { type: 'channel', playerId: targetId, count: amount, exhausted: Boolean(effect.exhausted) }
    } else if (['gain_points', 'gain_xp', 'spend_xp'].includes(effect.operation)) {
      operation = { type: effect.operation, playerId: targetId, count: amount }
    } else if (effect.operation === 'create_token') {
      operation = {
        type: 'create_token',
        cardId: legalTokenCardId,
        playerId: targetId,
        destination: legalEffectDestination,
        exhausted: Boolean(effect.tokenExhausted),
        count: amount,
      }
    } else {
      operation = { type: effect.operation, instanceId: targetId }
      if (effect.operation === 'damage' || effect.operation === 'heal') operation.amount = amount
      if (effect.operation === 'move') operation.destination = legalEffectDestination
      if (effect.operation === 'buff') operation.value = true
    }
    const needsPlayer = PLAYER_EFFECT_OPERATIONS.has(effect.operation)
    if ((needsPlayer && kind !== 'player') || (!needsPlayer && kind !== 'card')) {
      reportError('That target does not match the selected operation.')
      return
    }
    sendAction('APPLY_EFFECT', { description, operations: [operation] }, () => {
      setEffect({
        description: '',
        operation: 'draw',
        target: '',
        destination: '',
        tokenCardId: '',
        amount: 1,
        exhausted: false,
        tokenExhausted: true,
      })
    })
  }

  const rulesVersion = typeof game.rules === 'string'
    ? game.rules
    : game.rules?.version || game.rules?.coreVersion || game.rules?.ruleVersion || 'server-defined'
  const history = asArray(game.history || game.log).slice(-10)
  const winner = players.find((player) => player.id === game.winnerPlayerId)
  const selectedCard = cardLookup(cardsById, selected?.cardId)
  const selectedSpend = normalCardSpend(selectedCard)
  const selectedPowerEntry = Object.entries(selectedSpend.powerByDomain)[0]

  return (
    <main className={`official-game official-game--${status}`}>
      <header className="official-game__topbar">
        <button type="button" onClick={onLeave}>Leave table</button>
        <span>Room {room?.code || '—'}</span>
        <strong>{status === 'finished' ? `${winner?.name || 'A player'} won` : `Turn ${turn.number || 1} · ${phase || status}`}</strong>
        <span>{connected ? 'Connected' : 'Reconnecting'}</span>
        {status === 'playing' && (
          <button
            type="button"
            className="official-game__concede"
            disabled={!connected || Boolean(pending)}
            onClick={() => {
              if (globalThis.confirm?.('Concede this game? This cannot be undone.')) sendAction('CONCEDE')
            }}
          >Concede</button>
        )}
      </header>

      <section className="official-game__rules-notice">
        <strong>Core rules {rulesVersion}</strong>
        <span>Score 8 to win. The final point must follow the server’s official win-condition checks.</span>
        <p>Printed card text is not automatically interpreted. Resolve it together, then record only the constrained operation in “Apply printed effect.”</p>
      </section>

      <section className="official-game__turn-state">
        <span>Active: <strong>{playerName(players, activePlayerId, 'Not selected')}</strong></span>
        <span>Phase: <strong>{phase || '—'}</strong></span>
        <span>Focus: <strong>{playerName(players, focusPlayerId, 'None')}</strong></span>
        {pending && <span>Host is processing <strong>{pending.replaceAll('_', ' ').toLowerCase()}</strong></span>}
      </section>

      {status === 'finished' && (
        <section className={`official-game__result ${game.winnerPlayerId === selfId ? 'official-game__result--win' : ''}`}>
          <strong>{game.winnerPlayerId === selfId ? 'Victory' : `${winner?.name || 'Your opponent'} wins`}</strong>
          <span>Final score: {players.map((player) => `${player.name} ${player.score || 0}`).join(' · ')}</span>
        </section>
      )}

      {opponent && (
        <PlayerSummary player={opponent} cardsById={cardsById} selected={selected?.instanceId} />
      )}

      <section className="official-game__table">
        <CardZone title={`${opponent?.name || 'Opponent'} base`} zone={opponent?.zones?.base} cardsById={cardsById} prefix="opponent-base" compact />
        <div className="official-game__battlefields">
          {battlefields.map((field, index) => (
            <Battlefield
              key={field?.instanceId || `battlefield-${index}`}
              battlefield={field}
              index={index}
              players={players}
              selfId={selfId}
              cardsById={cardsById}
              selected={selected?.instanceId}
              onSelect={chooseOwnCard}
            />
          ))}
        </div>
        <CardZone
          title="Your base"
          zone={self?.zones?.base}
          cardsById={cardsById}
          prefix="self-base"
          selected={selected?.instanceId}
          selectable
          onSelect={(instance) => chooseOwnCard(instance, 'base')}
          compact
        />
      </section>

      {self && (
        <PlayerSummary
          player={self}
          self
          cardsById={cardsById}
          selected={selected?.instanceId}
          canAct={canTakeAction}
          pending={pending}
          onSelect={chooseOwnCard}
          onUseRune={(instanceId, mode) => sendAction('USE_RUNE', { instanceId, mode })}
        />
      )}

      {status === 'mulligan' && self && (
        <section className="official-game__mulligan">
          <header><strong>Opening mulligan</strong><span>Select up to two cards to replace.</span></header>
          <div className="official-game__mulligan-cards">
            {selfHand.cards.map((value, index) => {
              const instance = normalizedInstance(value, index, 'mulligan')
              return (
                <InstanceCard
                  key={instance._key}
                  value={instance}
                  index={index}
                  prefix="mulligan"
                  cardsById={cardsById}
                  selected={mulliganIds.includes(instance.instanceId) ? instance.instanceId : ''}
                  selectable={!self.mulliganSubmitted}
                  onSelect={() => toggleMulligan(instance.instanceId)}
                  label={`Mulligan ${cardLookup(cardsById, instance.cardId)?.name || 'card'}`}
                />
              )
            })}
          </div>
          <button
            type="button"
            disabled={!connected || Boolean(pending) || self.mulliganSubmitted}
            onClick={() => sendAction('SUBMIT_MULLIGAN', { instanceIds: mulliganIds }, () => setMulliganIds([]))}
          >
            {self.mulliganSubmitted ? 'Mulligan submitted' : `Keep hand · replace ${mulliganIds.length}`}
          </button>
          <small>{opponent?.mulliganSubmitted ? 'Opponent is ready.' : 'Waiting for the opponent’s choice.'}</small>
        </section>
      )}

      {status === 'playing' && self && (
        <section className="official-game__hand">
          <header><strong>Your hand</strong><span>{selfHand.count} cards · private to this device</span></header>
          <div className="official-game__hand-cards">
            {selfHand.cards.length > 0 ? selfHand.cards.map((value, index) => (
              <InstanceCard
                key={normalizedInstance(value, index, 'hand')._key}
                value={value}
                index={index}
                prefix="hand"
                cardsById={cardsById}
                selected={selected?.instanceId}
                selectable
                onSelect={(instance) => chooseOwnCard(instance, 'hand')}
              />
            )) : <span className="official-game__empty">Your hand is empty</span>}
          </div>
        </section>
      )}

      {status === 'playing' && selected && (
        <section className="official-game__selection-panel">
          <header><strong>Selected: {cardLookup(cardsById, selected.cardId)?.name || selected.cardId}</strong><button type="button" onClick={() => setSelected(null)}>Clear</button></header>
          {['hand', 'champion'].includes(selected.zone) && (
            <div className="official-game__selection-actions">
              <small>
                Normal declared cost: {selectedSpend.energy} Energy
                {selectedPowerEntry ? ` + ${selectedPowerEntry[1]} ${selectedPowerEntry[0]} Power` : ''}.
              </small>
              <button type="button" disabled={!canTakeAction} onClick={() => playSelected('base')}>Play to base</button>
              {controlledBattlefields.map((field, index) => (
                <button type="button" disabled={!canTakeAction} key={field.instanceId} onClick={() => playSelected(field.instanceId)}>Play to battlefield {index + 1}</button>
              ))}
              {controlledBattlefields.length === 0 && <small>Control a battlefield before playing directly to one.</small>}
            </div>
          )}
          {['base', 'battlefield'].includes(selected.zone) && (
            <div className="official-game__selection-actions">
              {selected.zone === 'battlefield' && (
                <button type="button" disabled={!canTakeAction} onClick={() => moveSelected('base')}>Move to base</button>
              )}
              {selected.zone === 'base' && battlefields.filter(Boolean).map((field, index) => (
                <button
                  type="button"
                  disabled={!canTakeAction}
                  key={field.instanceId}
                  onClick={() => moveSelected(field.instanceId)}
                >Move to battlefield {index + 1}</button>
              ))}
              {selected.zone === 'battlefield' && <small>Battlefield-to-battlefield movement is available only through a verified Ganking effect.</small>}
            </div>
          )}
        </section>
      )}

      {status === 'playing' && (
        <section className="official-game__priority-actions">
          <button type="button" disabled={!connected || focusPlayerId !== selfId || Boolean(pending)} onClick={() => sendAction('PASS_FOCUS')}>Pass focus</button>
          <button type="button" disabled={!canTakeTurnAction || phase !== 'main'} onClick={() => sendAction('END_MAIN')}>End main phase</button>
          <button type="button" disabled={!canTakeTurnAction || phase !== 'main'} onClick={() => sendAction('END_TURN')}>End turn</button>
        </section>
      )}

      {combat && (
        <section className="official-game__combat">
          <header>
            <strong>Combat · {combat.stage || 'resolving'}</strong>
            <span>{playerName(players, combatAttackerId, 'Attacker')} attacks {playerName(players, combatDefenderId, 'Defender')}</span>
          </header>
          <div className="official-game__combat-might">
            {Object.entries(mightTotals).map(([key, value]) => <span key={key}>{playerName(players, key, key)}: <b>{value}</b> Might</span>)}
          </div>
          <label className="official-game__field-label">
            First damage target
            <select value={legalDamageTarget} onChange={(event) => setDamageTarget(event.target.value)}>
              {opposingCombatUnits.map((instance) => <option value={instance.instanceId} key={instance.instanceId}>{cardLookup(cardsById, instance.cardId)?.name || instance.cardId}</option>)}
            </select>
          </label>
          {combatAllocations.length > 0 && (
            <ul className="official-game__combat-allocation">
              {combatAllocations.map((allocation) => {
                const instance = opposingCombatUnits.find((unit) => unit.instanceId === allocation.instanceId)
                return <li key={allocation.instanceId}>{cardLookup(cardsById, instance?.cardId)?.name || instance?.cardId}: {allocation.amount} damage</li>
              })}
            </ul>
          )}
          <button
            type="button"
            disabled={!canAssignCombat || (ownCombatMight > 0 && combatAllocations.length < 1)}
            onClick={() => sendAction('ASSIGN_COMBAT_DAMAGE', { allocations: combatAllocations })}
          >{ownCombatMight > 0 ? 'Assign combat damage' : 'Confirm zero combat damage'}</button>
          {expectedDamagePlayerId && expectedDamagePlayerId !== selfId && <small>Waiting for {playerName(players, expectedDamagePlayerId)} to assign damage.</small>}
          {opposingCombatUnits.length === 0 && <small>No opposing unit is available for a default allocation.</small>}
        </section>
      )}

      {status === 'playing' && (
        <details className="official-game__effect-panel">
          <summary>Apply printed effect</summary>
          <p>Use this only after both players read and agree on the physical card text.</p>
          <label className="official-game__field-label">
            Effect description
            <input
              value={effect.description}
              maxLength={160}
              placeholder="Card name and printed effect being resolved"
              onChange={(event) => setEffect((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label className="official-game__field-label">
            Operation
            <select
              value={effect.operation}
              onChange={(event) => setEffect((current) => ({
                ...current,
                operation: event.target.value,
                target: '',
                destination: '',
                amount: 1,
              }))}
            >
              {EFFECT_OPERATIONS.map(([operation, label]) => <option value={operation} key={operation}>{label}</option>)}
            </select>
          </label>
          <label className="official-game__field-label">
            Target
            <select value={legalEffectTarget} onChange={(event) => setEffect((current) => ({ ...current, target: event.target.value }))}>
              {effectTargets.length === 0 && <option value="">No legal public target</option>}
              {effectTargets.map((target) => <option value={target.value} key={target.value}>{target.label}</option>)}
            </select>
          </label>
          {effect.operation === 'create_token' && (
            <label className="official-game__field-label">
              Official token
              <select
                value={legalTokenCardId}
                onChange={(event) => {
                  const nextToken = cardLookup(cardsById, event.target.value)
                  setEffect((current) => ({
                    ...current,
                    tokenCardId: event.target.value,
                    destination: '',
                    tokenExhausted: String(nextToken?.type || '').toLowerCase() === 'unit',
                  }))
                }}
              >
                {tokenCards.length === 0 && <option value="">No catalog-backed Unit or Gear tokens</option>}
                {tokenCards.map((card) => <option value={card.id} key={card.id}>{card.name || card.id} · {card.type}</option>)}
              </select>
            </label>
          )}
          {['move', 'create_token'].includes(effect.operation) && (
            <label className="official-game__field-label">
              Destination
              <select value={legalEffectDestination} onChange={(event) => setEffect((current) => ({ ...current, destination: event.target.value }))}>
                {effectDestinations.length === 0 && <option value="">No legal destination</option>}
                {effectDestinations.map((destination) => <option value={destination.value} key={destination.value}>{destination.label}</option>)}
              </select>
            </label>
          )}
          {AMOUNT_EFFECT_OPERATIONS.has(effect.operation) && (
            <label className="official-game__field-label">
              Amount
              <input
                type="number"
                min="1"
                max={effect.operation === 'channel' ? 12 : 20}
                value={effect.amount}
                onChange={(event) => setEffect((current) => ({ ...current, amount: event.target.value }))}
              />
            </label>
          )}
          {effect.operation === 'channel' && (
            <label className="official-game__field-label">
              Channeled runes enter
              <select
                value={effect.exhausted ? 'exhausted' : 'ready'}
                onChange={(event) => setEffect((current) => ({ ...current, exhausted: event.target.value === 'exhausted' }))}
              >
                <option value="ready">Ready</option>
                <option value="exhausted">Exhausted</option>
              </select>
            </label>
          )}
          {effect.operation === 'create_token' && (
            <label className="official-game__field-label">
              Tokens enter
              <select
                value={effect.tokenExhausted ? 'exhausted' : 'ready'}
                onChange={(event) => setEffect((current) => ({ ...current, tokenExhausted: event.target.value === 'exhausted' }))}
              >
                <option value="exhausted">Exhausted</option>
                <option value="ready">Ready</option>
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={
              !canTakeAction
              || !effect.description.trim()
              || !legalEffectTarget
              || (['move', 'create_token'].includes(effect.operation) && !legalEffectDestination)
              || (effect.operation === 'create_token' && !legalTokenCardId)
            }
            onClick={applyManualEffect}
          >Apply agreed effect</button>
        </details>
      )}

      <section className="official-game__public-zones">
        <CardZone title="Your trash" zone={self?.zones?.trash} cardsById={cardsById} prefix="self-trash" compact />
        <CardZone title="Your banishment" zone={self?.zones?.banishment} cardsById={cardsById} prefix="self-banishment" compact />
        <CardZone title="Opponent trash" zone={opponent?.zones?.trash} cardsById={cardsById} prefix="opponent-trash" compact />
        <CardZone title="Opponent banishment" zone={opponent?.zones?.banishment} cardsById={cardsById} prefix="opponent-banishment" compact />
      </section>

      <section className="official-game__history">
        <header><strong>Game log</strong><span>{history.length} recent entries</span></header>
        {history.length > 0
          ? <ol>{history.map((entry, index) => <li key={entry?.id || `${index}-${logText(entry)}`}>{logText(entry)}</li>)}</ol>
          : <p>No actions recorded yet.</p>}
      </section>

      {displayedError && <button type="button" className="official-game__error" onClick={clearError}>{displayedError}<span>Dismiss</span></button>}
    </main>
  )
}
