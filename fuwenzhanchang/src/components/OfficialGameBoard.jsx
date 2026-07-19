import { useEffect, useRef, useState } from 'react'

import { planRunePayment, RUNE_DOMAINS } from '../../server/runePayment.js'

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
const DOMAINS = RUNE_DOMAINS

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

function cardImage(card, large = false) {
  if (large) {
    return card?.image_thumb?.large
      || card?.image
      || card?.image_thumb?.medium
      || card?.image_thumb?.small
      || ''
  }
  return card?.image_thumb?.medium
    || card?.image_thumb?.small
    || card?.image
    || ''
}

function titleCase(value) {
  const text = String(value || '').trim()
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : ''
}

function cardStatSummary(card) {
  if (!card) return ''
  const stats = card.stats || {}
  const parts = [titleCase(card.type)]
  const rawEnergy = stats.energy ?? card.energy
  const rawPower = stats.power ?? card.power
  const rawMight = stats.might ?? card.might
  const energy = Number(rawEnergy)
  const power = Number(rawPower)
  const might = Number(rawMight)
  if (rawEnergy !== null && rawEnergy !== undefined && Number.isFinite(energy)) parts.push(`${energy} Energy`)
  if (rawPower !== null && rawPower !== undefined && Number.isFinite(power) && power > 0) parts.push(`${power} Power`)
  if (rawMight !== null && rawMight !== undefined && Number.isFinite(might)) parts.push(`${might} Might`)
  return parts.filter(Boolean).join(' · ')
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

function focusCardInstance(instanceId) {
  const card = Array.from(globalThis.document?.querySelectorAll?.('[data-card-instance]') || [])
    .find((element) => element.dataset.cardInstance === instanceId)
  card?.focus({ preventScroll: true })
}

function ackMessage(response) {
  if (typeof response?.error === 'string') return response.error
  return response?.error?.message || response?.message || 'The host rejected that action.'
}

function OfficialCardArt({ card, hidden = false, large = false }) {
  const image = !hidden && cardImage(card, large)
  return (
    <span className={`official-game__art ${hidden ? 'official-game__art--hidden' : ''} ${large ? 'official-game__art--large' : ''}`}>
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
  hand = false,
  prompted = false,
}) {
  const instance = normalizedInstance(value, index, prefix)
  const card = cardLookup(cardsById, instance.cardId)
  const hidden = Boolean(instance.faceDown || !instance.cardId)
  const classes = [
    'official-game__instance',
    compact ? 'official-game__instance--compact' : '',
    hand ? 'official-game__instance--hand' : '',
    prompted ? 'official-game__instance--prompted' : '',
    instance.exhausted ? 'official-game__instance--exhausted' : '',
    selected === instance.instanceId ? 'official-game__instance--selected' : '',
    hidden ? 'official-game__instance--hidden' : '',
  ].filter(Boolean).join(' ')
  const content = (
    <>
      <OfficialCardArt card={card} hidden={hidden} />
      {!hand && <span className="official-game__instance-name">{hidden ? 'Face-down card' : card?.name || instance.cardId || 'Unknown card'}</span>}
      {!hand && !hidden && cardStatSummary(card) && <span className="official-game__instance-meta">{cardStatSummary(card)}</span>}
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
      data-card-instance={instance.instanceId}
      aria-pressed={selected === instance.instanceId}
      aria-label={label || (prompted
        ? `Discard ${card?.name || 'card'} for the pending effect`
        : `${selected === instance.instanceId ? 'Deselect' : 'Select'} ${card?.name || 'card'}`)}
      title={prompted
        ? `Discard ${card?.name || 'card'}, then draw 1 automatically`
        : selected === instance.instanceId
          ? 'Selected — actions are open'
          : `Select ${card?.name || 'card'} to open its actions`}
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
    <section className={`official-game__zone ${compact ? 'official-game__zone--compact' : ''} ${data.cards.length < 1 ? 'official-game__zone--empty' : ''}`}>
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

function RunePool({ player, cardsById }) {
  const runeZone = zoneData(player?.zones?.runes)
  const pool = player?.runePool || {}
  const power = pool.powerByDomain && typeof pool.powerByDomain === 'object' ? pool.powerByDomain : {}
  return (
    <section className="official-game__runes">
      <header className="official-game__rune-summary">
        <strong>Resources</strong>
        <span>Energy {Number(pool.energy) || 0}</span>
      </header>
      <div className="official-game__power-list">
        {DOMAINS.map((domain) => <span key={domain}>{domain} {Number(power[domain]) || 0}</span>)}
      </div>
      <div className="official-game__rune-cards">
        {runeZone.cards.length > 0 ? runeZone.cards.map((value, index) => {
          const instance = normalizedInstance(value, index, `rune-${player?.id}`)
          const card = cardLookup(cardsById, instance.cardId)
          return (
            <article
              className={`official-game__rune ${instance.exhausted ? 'official-game__rune--exhausted' : ''}`}
              key={instance._key}
              title={`${card?.name || 'Rune'} · ${instance.exhausted ? 'Exhausted' : 'Ready'}${card?.faction ? ` · ${titleCase(card.faction)}` : ''}`}
            >
              <OfficialCardArt card={card} hidden={instance.faceDown} />
              <strong>{card?.name || 'Rune'}</strong>
              <small>{instance.exhausted ? 'Exhausted' : 'Ready'}{card?.faction ? ` · ${titleCase(card.faction)}` : ''}</small>
            </article>
          )
        }) : <span className="official-game__empty">No runes in play</span>}
      </div>
    </section>
  )
}

function PlayerSummary({ player, self, cardsById, selected, onSelect, interactionLocked = false }) {
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
          selectable={self && !interactionLocked}
          onSelect={(instance) => onSelect?.(instance, 'champion')}
        />
        <div className="official-game__private-counts">
          <span><b>{zoneData(zones.hand).count}</b> Hand</span>
          <span><b>{zoneData(zones.mainDeck).count}</b> Main deck</span>
          <span><b>{zoneData(zones.trash).count}</b> Trash</span>
          <span><b>{zoneData(zones.banishment).count}</b> Banished</span>
        </div>
      </div>
      <RunePool
        player={player}
        cardsById={cardsById}
      />
    </section>
  )
}

function Battlefield({ battlefield, index, players, selfId, cardsById, selected, onSelect, interactionLocked = false }) {
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
      <div className={`official-game__battlefield-units ${units.length < 1 ? 'official-game__battlefield-units--empty' : ''}`}>
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
              selectable={own && !interactionLocked}
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

function handGridStyle(count) {
  const total = Math.max(1, Number(count) || 0)
  return {
    '--hand-columns-wide': total <= 8 ? total : Math.ceil(total / 2),
    '--hand-columns-medium': total <= 6 ? total : Math.ceil(total / 2),
    '--hand-columns-compact': Math.min(3, total),
    '--hand-columns-small': Math.min(2, total),
  }
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
  const [damageOrder, setDamageOrder] = useState([])
  const actionDockRef = useRef(null)
  const primaryActionRef = useRef(null)
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

  // Keep the selection tied to the latest server snapshot. A card can be
  // exhausted, moved, discarded, or destroyed while it remains selected.
  const activeSelection = (() => {
    if (!selected || !self) return null
    let values = []
    if (['hand', 'champion', 'base'].includes(selected.zone)) {
      values = zoneData(self.zones?.[selected.zone]).cards
    } else if (selected.zone === 'battlefield') {
      const field = battlefields.find((candidate) => candidate?.instanceId === selected.battlefieldId)
      values = battlefieldUnits(field)
    }
    const current = values
      .map((value, index) => normalizedInstance(value, index, `selected-${selected.zone}`))
      .find((instance) => instance.instanceId === selected.instanceId)
    return current ? { ...current, zone: selected.zone, battlefieldId: selected.battlefieldId || null } : null
  })()
  const staleSelectionId = selected?.instanceId && !activeSelection ? selected.instanceId : ''

  useEffect(() => {
    const selectedInstanceId = activeSelection?.instanceId
    if (!selectedInstanceId) return undefined

    const focusTimer = globalThis.setTimeout(() => {
      const primaryAction = primaryActionRef.current
      const focusTarget = primaryAction && !primaryAction.disabled ? primaryAction : actionDockRef.current
      focusTarget?.focus({ preventScroll: true })
    }, 0)
    const dismissWithKeyboard = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setSelected(null)
      globalThis.setTimeout(() => focusCardInstance(selectedInstanceId), 0)
    }
    globalThis.document?.addEventListener?.('keydown', dismissWithKeyboard)
    return () => {
      globalThis.clearTimeout(focusTimer)
      globalThis.document?.removeEventListener?.('keydown', dismissWithKeyboard)
    }
  }, [activeSelection?.instanceId])

  useEffect(() => {
    if (!staleSelectionId) return undefined
    const fallback = globalThis.document?.querySelector?.(
      '.official-game__priority-actions button:not(:disabled), .official-game__hand .official-game__instance, .official-game__topbar button',
    )
    fallback?.focus({ preventScroll: true })
    setSelected(null)
    return undefined
  }, [staleSelectionId])

  const status = game?.status || 'loading'
  const phase = String(turn.phase || turn.state || '').toLowerCase()
  const turnState = String(turn.state || '').toLowerCase()
  const activePlayerId = turn.activePlayerId
  const focusPlayerId = turn.focusPlayerId
  const showdownOpen = Boolean(game?.showdown)
  const triggeredEffectOpen = game?.showdown?.type === 'triggered-effect'
  const cardDecision = game?.pendingDecision && typeof game.pendingDecision === 'object'
    ? game.pendingDecision
    : null
  const ownCardDecision = cardDecision?.playerId === selfId && Boolean(cardDecision?.id)
    ? cardDecision
    : null
  const decisionEligibleIds = asArray(ownCardDecision?.selection?.eligibleInstanceIds)
  const firstDecisionEligibleId = decisionEligibleIds[0] || ''

  useEffect(() => {
    if (!ownCardDecision?.id || !firstDecisionEligibleId) return undefined
    const focusTimer = globalThis.setTimeout(() => focusCardInstance(firstDecisionEligibleId), 0)
    return () => globalThis.clearTimeout(focusTimer)
  }, [ownCardDecision?.id, firstDecisionEligibleId])

  const hasFocus = !focusPlayerId ? activePlayerId === selfId : focusPlayerId === selfId
  const awaitingCombatAssignment = ['assign-attacker', 'assign-defender'].includes(String(game?.combat?.stage || '').toLowerCase())
  const canTakeAction = Boolean(connected && status === 'playing' && hasFocus && !pending && !cardDecision && !awaitingCombatAssignment)
  const canTakeTurnAction = Boolean(canTakeAction && activePlayerId === selfId)
  const canStandardMove = Boolean(canTakeTurnAction && phase === 'main' && turnState === 'neutral-open' && !showdownOpen && !game?.combat)
  const canPassFocus = Boolean(canTakeAction && showdownOpen && focusPlayerId === selfId)
  const canEndTurn = Boolean(connected && status === 'playing' && activePlayerId === selfId && phase === 'main' && !pending && !cardDecision && !showdownOpen && !game?.combat)
  const displayedError = error || localError
  const actionDisabledReason = !connected
    ? 'Reconnect to the host before acting.'
    : pending
      ? `Wait for ${pending.replaceAll('_', ' ').toLowerCase()} to finish.`
      : cardDecision
        ? (ownCardDecision
            ? 'Choose one highlighted hand card to discard for the pending effect.'
            : `Waiting for ${playerName(players, cardDecision.playerId, 'the other player')} to resolve a private card choice.`)
      : status !== 'playing'
        ? 'Complete the opening setup first.'
        : awaitingCombatAssignment
          ? 'Combat damage must be assigned before taking another action.'
          : !hasFocus
            ? `Waiting for ${playerName(players, focusPlayerId || activePlayerId, 'the other player')}.`
            : ''
  const standardMoveDisabledReason = !canTakeAction
    ? actionDisabledReason
    : activePlayerId !== selfId
      ? 'Standard Move is available only during your own turn.'
      : phase !== 'main' || turnState !== 'neutral-open' || showdownOpen || game?.combat
        ? 'Standard Move is available only in your open Main Phase, outside a showdown.'
        : ''

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
    if (cardDecision) {
      if (
        zone === 'hand'
        && ownCardDecision
        && decisionEligibleIds.includes(instance.instanceId)
      ) {
        sendAction('RESOLVE_PENDING_DECISION', {
          decisionId: ownCardDecision.id,
          instanceIds: [instance.instanceId],
        }, () => setSelected(null))
      }
      return
    }
    setSelected((current) => current?.instanceId === instance.instanceId
      && current.zone === zone
      && (current.battlefieldId || null) === (battlefieldId || null)
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
    if (!activeSelection || !['hand', 'champion'].includes(activeSelection.zone)) return
    sendAction('PLAY_CARD', {
      instanceId: activeSelection.instanceId,
      from: activeSelection.zone,
      destination,
    }, () => setSelected(null))
  }

  function moveSelected(destination) {
    if (!activeSelection || !['base', 'battlefield'].includes(activeSelection.zone)) return
    if (String(cardLookup(cardsById, activeSelection.cardId)?.type || '').toLowerCase() !== 'unit') return
    sendAction('STANDARD_MOVE', {
      unitIds: [activeSelection.instanceId],
      destination,
    }, () => setSelected(null))
  }

  function dismissSelection() {
    const selectedInstanceId = activeSelection?.instanceId
    setSelected(null)
    if (selectedInstanceId) globalThis.setTimeout(() => focusCardInstance(selectedInstanceId), 0)
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
  const combatTargetIds = opposingCombatUnits.map((instance) => instance.instanceId)
  const legalDamageOrder = [
    ...damageOrder.filter((instanceId) => combatTargetIds.includes(instanceId)),
    ...combatTargetIds.filter((instanceId) => !damageOrder.includes(instanceId)),
  ]
  const mightTotals = combat?.mightTotals && typeof combat.mightTotals === 'object' ? combat.mightTotals : {}
  const combatRole = combatAttackerId === selfId ? 'attacker' : combatDefenderId === selfId ? 'defender' : ''
  const ownCombatMight = Math.max(0, Number(mightTotals[selfId] ?? mightTotals[combatRole]) || 0)
  const orderedCombatTargets = legalDamageOrder
    .map((instanceId) => opposingCombatUnits.find((instance) => instance.instanceId === instanceId))
    .filter(Boolean)
  const combatAllocations = defaultCombatAllocations(cardsById, orderedCombatTargets, ownCombatMight)
  const expectedDamagePlayerId = combat?.stage === 'assign-attacker'
    ? combatAttackerId
    : combat?.stage === 'assign-defender'
      ? combatDefenderId
      : null
  const canAssignCombat = Boolean(connected && status === 'playing' && !pending && !cardDecision && expectedDamagePlayerId === selfId)

  function moveCombatTarget(instanceId, direction) {
    const currentOrder = [...legalDamageOrder]
    const currentIndex = currentOrder.indexOf(instanceId)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return
    const [moved] = currentOrder.splice(currentIndex, 1)
    currentOrder.splice(nextIndex, 0, moved)
    setDamageOrder(currentOrder)
  }

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

  const history = asArray(game.history || game.log).slice(-10)
  const winner = players.find((player) => player.id === game.winnerPlayerId)
  const decisionSourceName = cardLookup(cardsById, ownCardDecision?.source?.cardId)?.name || 'Card effect'
  const selectedCard = cardLookup(cardsById, activeSelection?.cardId)
  const selectedType = String(selectedCard?.type || '').toLowerCase()
  const selectedIsPlayable = ['unit', 'gear', 'spell'].includes(selectedType)
  const selectionFromHand = ['hand', 'champion'].includes(activeSelection?.zone)
  const selfRunePool = self?.runePool || {}
  const selectedPaymentPlan = planRunePayment({
    card: selectedCard,
    runePool: selfRunePool,
    runes: zoneData(self?.zones?.runes).cards,
    cardsById,
  })
  const canPlaySelected = Boolean(canTakeAction && selectedIsPlayable && selectedPaymentPlan.affordable)
  const playDisabledReason = actionDisabledReason
    || (!selectedIsPlayable ? 'Only Units, Gear, and Spells can be played this way.' : '')
    || (!selectedPaymentPlan.affordable ? selectedPaymentPlan.summaries.shortage : '')
  const selectedIsBoardUnit = selectedType === 'unit'
  const canMoveSelected = Boolean(canStandardMove && activeSelection && selectedIsBoardUnit && !activeSelection.exhausted)
  const moveDisabledReason = !selectedIsBoardUnit
    ? 'Only Units can use a Standard Move. This card is selected for inspection.'
    : standardMoveDisabledReason
      || (activeSelection?.exhausted ? 'This Unit is exhausted and cannot pay the Standard Move cost.' : '')
  const effectSubmitReason = actionDisabledReason
    || (!effect.description.trim() ? 'Enter the card name and printed effect first.' : '')
    || (!legalEffectTarget ? 'Choose a legal target.' : '')
    || (['move', 'create_token'].includes(effect.operation) && !legalEffectDestination ? 'Choose a legal destination.' : '')
    || (effect.operation === 'create_token' && !legalTokenCardId ? 'Choose an official token.' : '')
  const actionDockMode = selectionFromHand ? 'play' : selectedIsBoardUnit ? 'move' : 'inspect'
  const actionDockBlocked = selectionFromHand
    ? !canPlaySelected
    : selectedIsBoardUnit
      ? !canMoveSelected
      : false
  const standardMoveDestinations = selectedIsBoardUnit && activeSelection?.zone === 'battlefield'
    ? [{ value: 'base', label: 'Your base', context: 'Return this Unit to your base' }]
    : selectedIsBoardUnit && activeSelection?.zone === 'base'
      ? battlefields.filter(Boolean).map((field, index) => {
          const label = cardLookup(cardsById, field.cardId)?.name || `Battlefield ${index + 1}`
          const controller = field.controllerPlayerId
            ? (field.controllerPlayerId === selfId ? 'You control it' : `${playerName(players, field.controllerPlayerId)} controls it`)
            : 'Uncontrolled'
          const contested = field.contestedByPlayerId
            ? ` · contested by ${playerName(players, field.contestedByPlayerId)}`
            : ''
          return { value: field.instanceId, label, context: `${controller}${contested}` }
        })
      : []
  const selectedCostText = selectedPaymentPlan.summaries.cost
  const selectedPoolParts = [
    selectedPaymentPlan.fromPool.energy
      ? `${selectedPaymentPlan.fromPool.energy} Energy`
      : '',
    ...Object.entries(selectedPaymentPlan.fromPool.powerByDomain)
      .filter(([, amount]) => Number(amount) > 0)
      .map(([domain, amount]) => `${amount} ${titleCase(domain)} Power`),
  ].filter(Boolean)
  const selectedActivatesRunes = selectedPaymentPlan.exhaustIds.length > 0
    || selectedPaymentPlan.recycleIds.length > 0
  const selectedHasCost = selectedPaymentPlan.cost.energy > 0
    || Object.values(selectedPaymentPlan.cost.powerByDomain).some((amount) => Number(amount) > 0)
    || Object.values(selectedPaymentPlan.cost.unsupportedPowerByDomain).some((amount) => Number(amount) > 0)
  const selectedPaymentText = [
    selectedPoolParts.length ? `Use ${selectedPoolParts.join(' + ')} already in the pool` : '',
    selectedActivatesRunes ? selectedPaymentPlan.summaries.payment : '',
  ].filter(Boolean).join('; ')
  const actionDockStatusTone = actionDockBlocked ? 'blocked' : actionDockMode === 'inspect' ? 'info' : 'ready'
  const actionDockStatusTitle = selectionFromHand
    ? (canPlaySelected
        ? (selectedHasCost ? `Auto-pay ready · ${selectedCostText}` : 'Ready · no Rune payment')
        : 'Not ready to play')
    : selectedIsBoardUnit
      ? (canMoveSelected ? 'Ready for a Standard Move' : 'Standard Move unavailable')
      : 'Inspect this card'
  const actionDockStatusCopy = selectionFromHand
    ? (playDisabledReason || `${selectedHasCost ? `Auto-pay: ${selectedPaymentText}. ` : ''}Choose a destination below.`)
    : selectedIsBoardUnit
      ? (moveDisabledReason || 'Choose a destination below. This Unit exhausts to pay the move cost.')
      : 'Gear cannot use a Standard Move. Resolve its printed text with your opponent when relevant.'

  let nextAction = {
    tone: 'waiting',
    kicker: 'Next action',
    title: 'Waiting for the game state',
    copy: 'The host is preparing the next step.',
    steps: [],
  }
  if (!connected) {
    nextAction = {
      tone: 'blocked',
      kicker: 'Connection interrupted',
      title: 'Reconnecting to the host',
      copy: 'Keep this page open. Actions will return when the local connection is restored.',
      steps: [],
    }
  } else if (status === 'finished') {
    nextAction = {
      tone: game.winnerPlayerId === selfId ? 'ready' : 'waiting',
      kicker: 'Game complete',
      title: game.winnerPlayerId === selfId ? 'You won the match' : `${winner?.name || 'Your opponent'} won the match`,
      copy: 'Review the final score and game log, or leave the table when ready.',
      steps: [],
    }
  } else if (status === 'mulligan') {
    nextAction = self?.mulliganSubmitted
      ? {
          tone: 'waiting',
          kicker: 'Opening hand locked',
          title: opponent?.mulliganSubmitted ? 'Both players are ready' : `Waiting for ${opponent?.name || 'your opponent'}`,
          copy: 'Your mulligan choice has been submitted and cannot be changed.',
          steps: [],
        }
      : {
          tone: 'ready',
          kicker: 'Your opening choice',
          title: mulliganIds.length ? `Replace ${mulliganIds.length} selected card${mulliganIds.length === 1 ? '' : 's'}` : 'Keep all four, or replace up to two',
          copy: 'Select unwanted cards, then confirm your opening hand.',
          steps: ['Select 0–2 cards', 'Confirm once', 'Wait for your opponent'],
        }
  } else if (pending) {
    nextAction = {
      tone: 'waiting',
      kicker: 'Action sent',
      title: `Applying ${pending.replaceAll('_', ' ').toLowerCase()}`,
      copy: 'Wait for the host to confirm before choosing another action.',
      steps: [],
    }
  } else if (cardDecision) {
    nextAction = ownCardDecision
      ? {
          tone: 'combat',
          kicker: `${decisionSourceName} · required effect`,
          title: 'Choose one hand card to discard',
          copy: 'Select one highlighted card below. The host discards it and draws 1 automatically.',
          steps: [],
        }
      : {
          tone: 'waiting',
          kicker: 'Private card choice',
          title: `Waiting for ${playerName(players, cardDecision.playerId, 'the other player')}`,
          copy: 'Their legal choice is private. The host will continue the effect automatically.',
          steps: [],
        }
  } else if (expectedDamagePlayerId) {
    nextAction = expectedDamagePlayerId === selfId
      ? {
          tone: 'combat',
          kicker: 'Your combat decision',
          title: `Assign ${ownCombatMight} combat damage`,
          copy: ownCombatMight > 0
            ? 'Choose the first opposing Unit to receive damage, review the allocation, then confirm.'
            : 'You have no Might to assign. Confirm zero damage to continue combat.',
          steps: ['Choose first target', 'Review all damage', 'Confirm assignment'],
        }
      : {
          tone: 'waiting',
          kicker: 'Combat in progress',
          title: `Waiting for ${playerName(players, expectedDamagePlayerId)}`,
          copy: 'The other player must assign combat damage before the game can continue.',
          steps: [],
        }
  } else if (status === 'playing' && !hasFocus) {
    nextAction = {
      tone: 'waiting',
      kicker: showdownOpen ? 'Showdown response window' : 'Opponent’s turn',
      title: `Waiting for ${playerName(players, focusPlayerId || activePlayerId, 'your opponent')}`,
      copy: showdownOpen
        ? (triggeredEffectOpen
            ? 'Zaun Warrens is on the Chain. They may respond or pass Focus; its discard/draw resolves after both players pass.'
            : 'They have Focus. Watch for their response; you will be prompted when Focus returns to you.')
        : 'You can inspect cards and the game log while they take their turn.',
      steps: [],
    }
  } else if (status === 'playing' && activeSelection) {
    const selectedName = selectedCard?.name || 'selected card'
    const selectedFromHand = ['hand', 'champion'].includes(activeSelection.zone)
    nextAction = {
      tone: selectedFromHand
        ? (canPlaySelected ? 'ready' : 'blocked')
        : selectedIsBoardUnit
          ? (canMoveSelected ? 'ready' : 'blocked')
          : 'waiting',
      kicker: `${titleCase(activeSelection.zone)} selected`,
      title: selectedFromHand
        ? `Choose how to play ${selectedName}`
        : selectedIsBoardUnit
          ? `Choose where to move ${selectedName}`
          : `Inspect ${selectedName}`,
      copy: selectedFromHand
        ? (playDisabledReason || 'Review its normal cost and choose one legal destination below.')
        : selectedIsBoardUnit
          ? (moveDisabledReason || 'Choose one legal Standard Move destination below.')
          : 'Read the enlarged card. Gear remains at base unless a printed effect changes it.',
      steps: [],
    }
  } else if (canPassFocus) {
    nextAction = {
      tone: 'combat',
      kicker: triggeredEffectOpen ? 'Zaun Warrens on the Chain' : 'You have Focus',
      title: triggeredEffectOpen ? 'Respond, or pass Focus' : 'Respond to the showdown, or pass',
      copy: triggeredEffectOpen
        ? 'After both players pass, the host resolves discard 1, then draw 1. Take a legal response now or pass.'
        : 'Play a card or resolve an agreed printed effect. Pass Focus when you have no response.',
      steps: ['Take one response, if any', 'Resolve its text together', 'Pass Focus'],
    }
  } else if (status === 'playing' && activePlayerId === selfId) {
    nextAction = {
      tone: 'ready',
      kicker: 'Your Main Phase',
      title: 'Choose a card or ready Unit',
      copy: 'Select a card to play or a ready Unit to move. Legal choices appear beside your hand.',
      steps: [],
    }
  }

  return (
    <main className={`official-game official-game--${status} ${activeSelection ? 'official-game--action-dock-open' : ''}`}>
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

      <section
        className={`official-game__action-guide official-game__action-guide--${nextAction.tone}`}
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="official-game__action-guide-copy">
          <small className="official-game__action-guide-kicker">{nextAction.kicker}</small>
          <strong>{nextAction.title}</strong>
          <p>{nextAction.copy}</p>
        </div>
        <div className="official-game__match-hud-state">
          <span>Active <strong>{playerName(players, activePlayerId, 'Not selected')}</strong></span>
          <span>{showdownOpen ? 'Focus' : 'Showdown'} <strong>{showdownOpen ? playerName(players, focusPlayerId, 'Resolving') : 'Closed'}</strong></span>
          {pending && <span>Processing <strong>{pending.replaceAll('_', ' ').toLowerCase()}</strong></span>}
          {cardDecision && <span>Card choice <strong>{ownCardDecision ? 'Choose below' : 'Waiting'}</strong></span>}
        </div>
      </section>

      {status === 'finished' && (
        <section className={`official-game__result ${game.winnerPlayerId === selfId ? 'official-game__result--win' : ''}`}>
          <strong>{game.winnerPlayerId === selfId ? 'Victory' : `${winner?.name || 'Your opponent'} wins`}</strong>
          <span>Final score: {players.map((player) => `${player.name} ${player.score || 0}`).join(' · ')}</span>
        </section>
      )}

      {opponent && (
        <PlayerSummary
          player={opponent}
          cardsById={cardsById}
          selected={activeSelection?.instanceId}
          interactionLocked={Boolean(cardDecision)}
        />
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
              selected={activeSelection?.instanceId}
              onSelect={chooseOwnCard}
              interactionLocked={Boolean(cardDecision)}
            />
          ))}
        </div>
        <CardZone
          title="Your base"
          zone={self?.zones?.base}
          cardsById={cardsById}
          prefix="self-base"
          selected={activeSelection?.instanceId}
          selectable={!cardDecision}
          onSelect={(instance) => chooseOwnCard(instance, 'base')}
          compact
        />
      </section>

      {self && (
        <PlayerSummary
          player={self}
          self
          cardsById={cardsById}
          selected={activeSelection?.instanceId}
          onSelect={chooseOwnCard}
          interactionLocked={Boolean(cardDecision)}
        />
      )}

      {status === 'mulligan' && self && (
        <section className="official-game__mulligan">
          <header>
            <strong>Opening mulligan</strong>
            <span>Selected cards are highlighted. You may replace zero, one, or two.</span>
          </header>
          <div className="official-game__mulligan-cards" style={handGridStyle(selfHand.cards.length)}>
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
                  hand
                />
              )
            })}
          </div>
          <button
            type="button"
            className="official-game__action-button official-game__action-button--primary"
            disabled={!connected || Boolean(pending) || self.mulliganSubmitted}
            title={!connected
              ? 'Reconnect before submitting your opening hand.'
              : pending
                ? 'Wait for the host to confirm your choice.'
                : self.mulliganSubmitted
                  ? 'Your opening choice is already locked.'
                  : 'This choice cannot be changed after confirmation.'}
            onClick={() => sendAction('SUBMIT_MULLIGAN', { instanceIds: mulliganIds }, () => setMulliganIds([]))}
          >
            {self.mulliganSubmitted
              ? 'Opening hand confirmed'
              : mulliganIds.length
                ? `Confirm: replace ${mulliganIds.length} selected`
                : 'Confirm: keep all four cards'}
          </button>
          <small className="official-game__disabled-reason">
            {self.mulliganSubmitted
              ? (opponent?.mulliganSubmitted ? 'Both players are ready. The first turn is starting.' : 'Waiting for your opponent’s choice.')
              : 'Confirm only when you are happy with the highlighted selection.'}
          </small>
        </section>
      )}

      {status === 'playing' && activeSelection && !cardDecision && (
        <section
          ref={actionDockRef}
          className={`official-game__selection-panel official-game__action-dock official-game__action-dock--${actionDockMode} ${actionDockBlocked ? 'official-game__action-dock--blocked' : ''}`}
          role="region"
          aria-labelledby="battle-action-dock-title"
          tabIndex={-1}
        >
          <header className="official-game__action-dock-header">
            <span className="official-game__action-dock-title">
              <small>{titleCase(activeSelection.zone)} selected · actions ready here</small>
              <strong id="battle-action-dock-title">{selectedCard?.name || activeSelection.cardId}</strong>
            </span>
            <button
              type="button"
              className="official-game__action-dock-close"
              onClick={dismissSelection}
              aria-label="Close card actions and return to the selected card"
              title="Close card actions (Escape)"
            >×</button>
          </header>

          <div className="official-game__action-dock-body">
            <div className="official-game__action-dock-controls">
              <div
                className={`official-game__action-dock-status official-game__action-dock-status--${actionDockStatusTone}`}
                aria-live="polite"
              >
                <strong>{actionDockStatusTitle}</strong>
                <span>{actionDockStatusCopy}</span>
              </div>

              <div className="official-game__action-dock-actions">
                {selectionFromHand && selectedType === 'spell' && (
                  <div className="official-game__action-dock-primary">
                    <button
                      ref={primaryActionRef}
                      type="button"
                      className="official-game__action-button official-game__action-button--primary"
                      disabled={!canPlaySelected}
                      title={playDisabledReason || 'Cast this Spell; it moves to trash after resolving'}
                      onClick={() => playSelected('base')}
                    >Cast {selectedCard?.name || 'Spell'}</button>
                  </div>
                )}

                {selectionFromHand && selectedType === 'gear' && (
                  <div className="official-game__action-dock-primary">
                    <button
                      ref={primaryActionRef}
                      type="button"
                      className="official-game__action-button official-game__action-button--primary"
                      disabled={!canPlaySelected}
                      title={playDisabledReason || 'Play this Gear to your base'}
                      onClick={() => playSelected('base')}
                    >Play Gear to your base</button>
                  </div>
                )}

                {selectionFromHand && selectedType === 'unit' && (
                  <>
                    <div className="official-game__action-dock-primary">
                      <button
                        ref={primaryActionRef}
                        type="button"
                        className="official-game__action-button official-game__action-button--primary"
                        disabled={!canPlaySelected}
                        title={playDisabledReason || 'Play this Unit exhausted to your base'}
                        onClick={() => playSelected('base')}
                      >Play Unit to your base</button>
                    </div>
                    {controlledBattlefields.length > 0 && (
                      <div className="official-game__action-dock-secondary">
                        <span className="official-game__action-dock-secondary-label">Or play to a controlled battlefield</span>
                        {controlledBattlefields.map((field) => {
                          const battlefieldIndex = battlefields.findIndex((candidate) => candidate?.instanceId === field.instanceId)
                          const fieldName = cardLookup(cardsById, field.cardId)?.name || `Battlefield ${battlefieldIndex + 1}`
                          return (
                            <button
                              type="button"
                              className="official-game__action-button official-game__action-button--secondary"
                              disabled={!canPlaySelected}
                              title={playDisabledReason || `Play this Unit exhausted to ${fieldName}`}
                              key={field.instanceId}
                              onClick={() => playSelected(field.instanceId)}
                            >Play to {fieldName}</button>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}

                {!selectionFromHand && selectedIsBoardUnit && standardMoveDestinations.length > 0 && (
                  <>
                    {standardMoveDestinations.length === 1 ? (
                      <div className="official-game__action-dock-primary">
                        <button
                          ref={primaryActionRef}
                          type="button"
                          className="official-game__action-button official-game__action-button--primary"
                          disabled={!canMoveSelected}
                          title={moveDisabledReason || `Standard Move to ${standardMoveDestinations[0].label}`}
                          onClick={() => moveSelected(standardMoveDestinations[0].value)}
                        >Standard Move → {standardMoveDestinations[0].label}</button>
                      </div>
                    ) : (
                      <div className="official-game__action-dock-secondary">
                        <span className="official-game__action-dock-secondary-label">Choose a battlefield · no destination is preselected</span>
                        {standardMoveDestinations.map((destination) => (
                          <button
                            type="button"
                            className="official-game__action-button official-game__action-button--secondary official-game__action-dock-destination"
                            disabled={!canMoveSelected}
                            title={moveDisabledReason || `Standard Move to ${destination.label}. ${destination.context}`}
                            key={destination.value}
                            onClick={() => moveSelected(destination.value)}
                          >
                            <strong>Standard Move → {destination.label}</strong>
                            <small>{destination.context}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {status === 'playing' && cardDecision && (
        <section
          className={`official-game__card-decision ${ownCardDecision ? 'official-game__card-decision--mine' : ''}`}
          role="status"
          aria-live="polite"
        >
          <div>
            <small>{ownCardDecision ? `${decisionSourceName} · Conquer effect` : 'Private effect choice'}</small>
            <strong>{ownCardDecision ? 'Discard 1, then draw 1' : `${playerName(players, cardDecision.playerId)} is choosing`}</strong>
            <span>{ownCardDecision
              ? 'Select any highlighted card in your hand. One click resolves the discard; the draw follows automatically.'
              : 'No action is needed from you. Hidden card information stays on the deciding player’s device.'}</span>
          </div>
          {ownCardDecision && <b>{decisionEligibleIds.length} legal cards</b>}
        </section>
      )}

      {status === 'playing' && self && (
        <section className="official-game__hand">
          <header><strong>Your hand</strong><span>{selfHand.count} cards · private to this device</span></header>
          <div className="official-game__hand-cards" style={handGridStyle(selfHand.cards.length)}>
            {selfHand.cards.length > 0 ? selfHand.cards.map((value, index) => {
              const instance = normalizedInstance(value, index, 'hand')
              const prompted = Boolean(ownCardDecision && decisionEligibleIds.includes(instance.instanceId))
              return (
                <InstanceCard
                  key={instance._key}
                  value={instance}
                  index={index}
                  prefix="hand"
                  cardsById={cardsById}
                  selected={activeSelection?.instanceId}
                  selectable={!pending && (!cardDecision || prompted)}
                  onSelect={(chosen) => chooseOwnCard(chosen, 'hand')}
                  prompted={prompted}
                  hand
                />
              )
            }) : <span className="official-game__empty">Your hand is empty</span>}
          </div>
        </section>
      )}

      {status === 'playing' && !cardDecision && !awaitingCombatAssignment && (showdownOpen || (activePlayerId === selfId && !game?.combat)) && (
        <section className="official-game__priority-actions">
          <div className="official-game__priority-copy">
            <strong>{triggeredEffectOpen ? 'Zaun Warrens trigger' : showdownOpen ? 'Showdown response' : 'Finished taking actions?'}</strong>
            <span>{showdownOpen
              ? (canPassFocus
                  ? (triggeredEffectOpen
                      ? 'Pass if you have no response. The discard/draw starts after both players pass.'
                      : 'Pass only when you do not want to take another response.')
                  : `Waiting for ${playerName(players, focusPlayerId)} to respond.`)
              : 'Ending the turn clears unspent Rune Pool resources and begins your opponent’s turn.'}</span>
          </div>
          <div className="official-game__priority-buttons">
            {canPassFocus && (
              <button
                type="button"
                className="official-game__action-button official-game__action-button--primary"
                onClick={() => sendAction('PASS_FOCUS')}
              >Pass Focus · no response</button>
            )}
            {!showdownOpen && (
              <button
                type="button"
                className="official-game__action-button official-game__action-button--secondary"
                disabled={!canEndTurn}
                title={canEndTurn ? 'Finish your Main Phase and begin the opponent’s turn' : actionDisabledReason || 'Resolve the current action first'}
                onClick={() => sendAction('END_TURN')}
              >End turn</button>
            )}
          </div>
        </section>
      )}

      {combat && (
        <section className={`official-game__combat ${expectedDamagePlayerId ? 'official-game__combat--assigning' : 'official-game__combat--showdown'}`}>
          <header>
            <strong>Combat · {titleCase(String(combat.stage || 'resolving').replaceAll('-', ' '))}</strong>
            <span>{playerName(players, combatAttackerId, 'Attacker')} attacks {playerName(players, combatDefenderId, 'Defender')}</span>
          </header>
          <div className="official-game__combat-might">
            {Object.entries(mightTotals).map(([key, value]) => <span key={key}>{playerName(players, key, key)}: <b>{value}</b> Might</span>)}
          </div>
          {!expectedDamagePlayerId && (
            <p className="official-game__combat-instruction">
              The showdown response window is open. The player with Focus may respond; damage assignment begins after both players pass consecutively.
            </p>
          )}
          {expectedDamagePlayerId && expectedDamagePlayerId !== selfId && (
            <p className="official-game__combat-instruction">Waiting for {playerName(players, expectedDamagePlayerId)} to assign their combat damage.</p>
          )}
          {expectedDamagePlayerId === selfId && (
            <div className="official-game__combat-assignment">
              <div className="official-game__selection-step">
                <small>{ownCombatMight > 0 ? '1 · Set damage order' : 'Combat total'}</small>
                <strong>{ownCombatMight > 0 ? `${ownCombatMight} Might to assign` : 'No damage to assign'}</strong>
                <span>{ownCombatMight > 0
                  ? 'Arrange every opposing Unit in the order it should receive damage. Each Unit before the last must receive exactly lethal damage.'
                  : 'Your side has 0 Might. Confirm zero damage so combat can continue.'}</span>
              </div>
              {ownCombatMight > 0 && opposingCombatUnits.length > 0 && (
                <div className="official-game__combat-order" aria-live="polite" aria-atomic="true">
                  <strong>Damage order</strong>
                  <ol aria-label="Combat damage target order">
                    {orderedCombatTargets.map((instance, index) => {
                      const targetName = cardLookup(cardsById, instance.cardId)?.name || instance.cardId
                      const lethal = Math.max(1, currentUnitMight(cardsById, instance) - (Number(instance.damage) || 0))
                      return (
                        <li className="official-game__combat-order-item" key={instance.instanceId}>
                          <b>{index + 1}</b>
                          <span className="official-game__combat-order-copy">
                            <strong>{targetName}</strong>
                            <small>{lethal} damage is lethal now</small>
                          </span>
                          <span className="official-game__combat-order-actions">
                            <button
                              type="button"
                              disabled={!canAssignCombat || index === 0}
                              aria-label={`Move ${targetName} earlier in damage order`}
                              onClick={() => moveCombatTarget(instance.instanceId, -1)}
                            >Earlier</button>
                            <button
                              type="button"
                              disabled={!canAssignCombat || index === orderedCombatTargets.length - 1}
                              aria-label={`Move ${targetName} later in damage order`}
                              onClick={() => moveCombatTarget(instance.instanceId, 1)}
                            >Later</button>
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )}
              {ownCombatMight > 0 && <div className="official-game__selection-step">
                <small>2 · Review allocation</small>
                {combatAllocations.length > 0 ? (
                  <ul className="official-game__combat-allocation">
                    {combatAllocations.map((allocation) => {
                      const instance = opposingCombatUnits.find((unit) => unit.instanceId === allocation.instanceId)
                      return <li key={allocation.instanceId}><strong>{allocation.amount} damage</strong><span>{cardLookup(cardsById, instance?.cardId)?.name || instance?.cardId}</span></li>
                    })}
                  </ul>
                ) : <span className="official-game__disabled-reason">No legal damage allocation is available.</span>}
              </div>}
              <button
                type="button"
                className="official-game__action-button official-game__action-button--primary"
                disabled={!canAssignCombat || (ownCombatMight > 0 && combatAllocations.length < 1)}
                title={!canAssignCombat ? 'Wait until the host asks you to assign damage.' : 'Lock this damage assignment; it cannot be edited afterward.'}
                onClick={() => sendAction('ASSIGN_COMBAT_DAMAGE', { allocations: combatAllocations })}
              >{ownCombatMight > 0 ? `Confirm ${ownCombatMight} combat damage` : 'Confirm zero combat damage'}</button>
              {opposingCombatUnits.length === 0 && ownCombatMight > 0 && <span className="official-game__disabled-reason">No opposing Unit is available for a legal allocation.</span>}
            </div>
          )}
        </section>
      )}

      {status === 'playing' && !cardDecision && (
        <details className="official-game__effect-panel">
          <summary><span>Optional manual tool</span> Resolve printed card effect</summary>
          <p className="official-game__effect-intro">
            Vetted triggers such as Zaun Warrens resolve automatically. For other printed text, read the card, agree on its result together, then record one legal board-state change here—including an instructed discard or recycle.
          </p>
          <ol className="official-game__effect-steps">
            <li>Describe the card and effect</li>
            <li>Choose exactly one operation and target</li>
            <li>Review, then apply</li>
          </ol>
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
            className="official-game__action-button official-game__action-button--primary"
            disabled={Boolean(effectSubmitReason)}
            title={effectSubmitReason || 'Apply this agreed operation and record it in the game log'}
            onClick={applyManualEffect}
          >Apply and record agreed effect</button>
          {effectSubmitReason && <span className="official-game__disabled-reason">{effectSubmitReason}</span>}
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
