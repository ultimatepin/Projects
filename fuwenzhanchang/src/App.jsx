import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Gamepad2,
  Globe2,
  Grid2X2,
  Layers3,
  Library,
  Menu,
  Minus,
  MoreHorizontal,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  Trash2,
  UserRound,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import { io } from 'socket.io-client'
import { fallbackCards } from './data/fallbackCards'
import { cardImage, cardSearchText, deckCount, deckEntries, DOMAIN_COLORS, SET_NAMES, titleCase, zoneCount } from './lib/cards'
import { createDeck, loadDecks, saveDecks } from './lib/storage'

const NAV = [
  { id: 'discover', label: 'Discover', icon: Grid2X2 },
  { id: 'decks', label: 'My decks', icon: Layers3 },
  { id: 'play', label: 'Play local', icon: Swords },
]

const FILTER_TYPES = ['All', 'Unit', 'Spell', 'Gear', 'Battlefield', 'Legend', 'Rune']
const FILTER_DOMAINS = ['all', 'fury', 'calm', 'mind', 'body', 'chaos', 'order', 'colorless']

function normalizeDeck(deck) {
  return {
    ...createDeck(),
    ...deck,
    cards: deck.cards || {},
    runes: deck.runes || {},
    battlefields: deck.battlefields || (deck.battlefieldId ? { [deck.battlefieldId]: 1 } : {}),
  }
}

function useCards() {
  const [cards, setCards] = useState(fallbackCards)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/cards.json')
      .then((response) => {
        if (!response.ok) throw new Error('Card catalog unavailable')
        return response.json()
      })
      .then((data) => {
        if (alive && Array.isArray(data) && data.length) setCards(data)
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  return { cards, loading }
}

function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand-mark"><span /></span>
      {!compact && <span><strong>RIFT</strong><small>LOCAL</small></span>}
    </div>
  )
}

function Sidebar({ page, onPage }) {
  return (
    <aside className="sidebar">
      <Brand />
      <nav className="primary-nav" aria-label="Main navigation">
        <span className="nav-eyebrow">Library</span>
        {NAV.slice(0, 2).map(({ id, label, icon: Icon }) => (
          <button key={id} className={page === id ? 'active' : ''} onClick={() => onPage(id)}>
            <Icon size={18} strokeWidth={1.8} />{label}
          </button>
        ))}
        <span className="nav-eyebrow nav-eyebrow--spaced">Tabletop</span>
        {NAV.slice(2).map(({ id, label, icon: Icon }) => (
          <button key={id} className={page === id ? 'active' : ''} onClick={() => onPage(id)}>
            <Icon size={18} strokeWidth={1.8} />{label}<i className="live-dot" />
          </button>
        ))}
      </nav>
      <div className="sidebar-note">
        <Wifi size={17} />
        <div><strong>Local network</strong><span>Private by design</span></div>
        <ShieldCheck size={16} className="verified" />
      </div>
      <div className="sidebar-footer">
        <button><CircleHelp size={17} /> How to play</button>
        <div className="profile-dot">P1</div>
        <div><strong>Player one</strong><span>Ready to play</span></div>
        <MoreHorizontal size={17} />
      </div>
    </aside>
  )
}

function MobileNav({ page, onPage }) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {NAV.map(({ id, label, icon: Icon }) => (
        <button key={id} className={page === id ? 'active' : ''} onClick={() => onPage(id)}>
          <Icon size={20} /><span>{label.replace('My ', '').replace(' local', '')}</span>
        </button>
      ))}
    </nav>
  )
}

function Topbar({ title, kicker, onMenu }) {
  return (
    <header className="topbar">
      <button className="mobile-menu" onClick={onMenu} aria-label="Open menu"><Menu /></button>
      <div><span>{kicker}</span><strong>{title}</strong></div>
      <div className="topbar-actions">
        <span className="connection-pill"><i /> Server online</span>
        <button className="icon-btn" aria-label="Help"><CircleHelp size={19} /></button>
      </div>
    </header>
  )
}

function CardArtwork({ card, eager = false }) {
  const [failed, setFailed] = useState(false)
  const source = cardImage(card, 'medium')
  if (!source || failed) {
    return (
      <div className="card-fallback" style={{ '--domain': DOMAIN_COLORS[card.faction] || DOMAIN_COLORS.colorless }}>
        <span className="fallback-rift" />
        <small>{card.set_id}</small>
        <strong>{card.name}</strong>
        <em>{card.type}</em>
      </div>
    )
  }
  return <img src={source} alt={card.name} loading={eager ? 'eager' : 'lazy'} onError={() => setFailed(true)} />
}

function CardTile({ card, onOpen, onAdd, count }) {
  return (
    <article className="card-tile" style={{ '--domain': DOMAIN_COLORS[card.faction] || DOMAIN_COLORS.colorless }}>
      <button className="card-art" onClick={() => onOpen?.(card)} aria-label={`View ${card.name}`}>
        <CardArtwork card={card} />
        <span className={`rarity-mark rarity-${card.rarity}`} />
        {count > 0 && <b className="in-deck-count">{count}</b>}
      </button>
      <div className="card-caption">
        <div>
          <strong title={card.name}>{card.name}</strong>
          <span>{titleCase(card.faction)} · {card.type}</span>
        </div>
        {onAdd && <button onClick={() => onAdd(card)} aria-label={`Add ${card.name}`}><Plus size={16} /></button>}
      </div>
    </article>
  )
}

function CardModal({ card, onClose, onAdd, count = 0 }) {
  if (!card) return null
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="card-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X /></button>
        <div className={`modal-art ${card.orientation === 'landscape' ? 'landscape' : ''}`}><CardArtwork card={card} eager /></div>
        <div className="modal-copy">
          <span className="eyebrow">{SET_NAMES[card.set_id] || card.set_id} · #{String(card.collector_number).padStart(3, '0')}</span>
          <h2>{card.name}</h2>
          <div className="detail-pills">
            <span><i style={{ background: DOMAIN_COLORS[card.faction] }} />{titleCase(card.faction)}</span>
            <span>{card.type}</span><span>{titleCase(card.rarity)}</span>
          </div>
          <div className="stat-row">
            <div><small>Energy</small><strong>{card.stats?.energy ?? '—'}</strong></div>
            <div><small>Might</small><strong>{card.stats?.might ?? '—'}</strong></div>
            <div><small>Power</small><strong>{card.stats?.power ?? '—'}</strong></div>
          </div>
          <p>Card text is shown on the official English card image. This catalog keeps printings and variants separate so your physical deck matches the tabletop.</p>
          {onAdd && <button className="primary-btn wide" onClick={() => onAdd(card)}><Plus size={17} /> Add to deck {count > 0 && `· ${count} in deck`}</button>}
        </div>
      </section>
    </div>
  )
}

function DiscoverView({ cards, loading, onBuild }) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('All')
  const [setId, setSetId] = useState('All sets')
  const [domain, setDomain] = useState('all')
  const [visible, setVisible] = useState(36)
  const [selected, setSelected] = useState(null)

  const sets = useMemo(() => [...new Set(cards.map((card) => card.set_id))], [cards])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return cards.filter((card) =>
      (!needle || cardSearchText(card).includes(needle)) &&
      (type === 'All' || card.type === type) &&
      (setId === 'All sets' || card.set_id === setId) &&
      (domain === 'all' || card.faction === domain),
    )
  }, [cards, domain, query, setId, type])

  useEffect(() => setVisible(36), [query, type, setId, domain])

  return (
    <>
      <div className="page-hero discover-hero">
        <div>
          <span className="eyebrow"><Sparkles size={14} /> Complete English catalog</span>
          <h1>Discover the <em>Rift</em></h1>
          <p>Explore every card, compare printings, and turn inspiration into a battle-ready deck.</p>
        </div>
        <div className="hero-stat">
          <span>{loading ? '•••' : cards.length.toLocaleString()}</span>
          <small>card printings<br />locally indexed</small>
        </div>
      </div>

      <section className="catalog-toolbar">
        <label className="search-box"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, domain, set…" />{query && <button onClick={() => setQuery('')}><X size={16} /></button>}</label>
        <label className="select-box"><span>Set</span><select value={setId} onChange={(event) => setSetId(event.target.value)}><option>All sets</option>{sets.map((set) => <option key={set} value={set}>{SET_NAMES[set] || set}</option>)}</select><ChevronDown size={15} /></label>
        <div className="view-count"><Library size={17} /> {filtered.length.toLocaleString()} results</div>
      </section>

      <div className="type-tabs">
        {FILTER_TYPES.map((item) => <button key={item} className={type === item ? 'active' : ''} onClick={() => setType(item)}>{item}</button>)}
      </div>

      <div className="domain-filters">
        <span>Domains</span>
        {FILTER_DOMAINS.map((item) => <button key={item} className={domain === item ? 'active' : ''} onClick={() => setDomain(item)}>{item !== 'all' && <i style={{ background: DOMAIN_COLORS[item] }} />}{titleCase(item)}</button>)}
      </div>

      {loading ? <CardGridSkeleton /> : filtered.length ? (
        <>
          <div className="card-grid">{filtered.slice(0, visible).map((card) => <CardTile key={card.id} card={card} onOpen={setSelected} />)}</div>
          {visible < filtered.length && <button className="load-more" onClick={() => setVisible((value) => value + 36)}>Show more <span>{Math.min(36, filtered.length - visible)}</span></button>}
        </>
      ) : <EmptyState icon={Search} title="No cards found" copy="Try a different name or clear one of the filters." />}

      <div className="build-banner">
        <span className="banner-rune"><Zap /></span>
        <div><span className="eyebrow">Found your win condition?</span><h3>Forge it into a deck.</h3><p>Your decks stay on this device and are ready for local matches.</p></div>
        <button className="light-btn" onClick={onBuild}>Open deck builder <ArrowLeft className="arrow-right" size={17} /></button>
      </div>
      <CardModal card={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function CardGridSkeleton() {
  return <div className="card-grid">{Array.from({ length: 18 }).map((_, index) => <div className="card-skeleton" key={index}><span /><i /></div>)}</div>
}

function EmptyState({ icon: Icon, title, copy, action }) {
  return <div className="empty-state"><span><Icon /></span><h3>{title}</h3><p>{copy}</p>{action}</div>
}

function zoneForCard(card) {
  if (card.type === 'Legend') return 'legend'
  if (card.type === 'Rune') return 'runes'
  if (card.type === 'Battlefield') return 'battlefields'
  return 'cards'
}

function expandedMainDeck(deck) {
  return Object.entries(deck?.cards || {}).flatMap(([cardId, count]) => Array.from({ length: count }, () => cardId))
}

function DecksView({ cards, decks, setDecks }) {
  const [activeId, setActiveId] = useState(decks[0]?.id || null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [selectedCard, setSelectedCard] = useState(null)
  const [deckTab, setDeckTab] = useState('cards')

  useEffect(() => {
    if (activeId && !decks.some((deck) => deck.id === activeId)) setActiveId(decks[0]?.id || null)
  }, [activeId, decks])

  const deck = decks.find((item) => item.id === activeId)
  const cardsById = useMemo(() => Object.fromEntries(cards.map((card) => [card.id, card])), [cards])

  function addNewDeck() {
    const next = createDeck(`Deck ${decks.length + 1}`)
    setDecks((current) => [...current, next])
    setActiveId(next.id)
  }

  function updateDeck(patch) {
    setDecks((current) => current.map((item) => item.id === activeId ? { ...item, ...patch, updatedAt: Date.now() } : item))
  }

  function addCard(card) {
    const zone = zoneForCard(card)
    if (zone === 'legend') {
      updateDeck({ legendId: card.id })
      return
    }
    const currentZone = deck[zone] || {}
    const currentCount = currentZone[card.id] || 0
    const zoneTotal = zoneCount(currentZone)
    const cap = zone === 'cards' ? 3 : zone === 'battlefields' ? 1 : 12
    const totalCap = zone === 'battlefields' ? 3 : zone === 'runes' ? 12 : Infinity
    const sameNameCount = Object.entries(currentZone).reduce((total, [id, count]) => total + (cardsById[id]?.name === card.name ? count : 0), 0)
    if (currentCount >= cap || zoneTotal >= totalCap || (zone === 'cards' && sameNameCount >= 3) || (zone === 'battlefields' && sameNameCount >= 1)) return
    updateDeck({ [zone]: { ...currentZone, [card.id]: currentCount + 1 } })
  }

  function removeCard(card, zoneOverride) {
    const zone = zoneOverride || zoneForCard(card)
    if (zone === 'legend') {
      updateDeck({ legendId: null })
      return
    }
    const currentZone = { ...(deck[zone] || {}) }
    const removingLast = (currentZone[card.id] || 0) <= 1
    if (removingLast) delete currentZone[card.id]
    else currentZone[card.id] -= 1
    updateDeck({ [zone]: currentZone, ...(zone === 'cards' && removingLast && deck.championId === card.id ? { championId: null } : {}) })
  }

  function deleteDeck() {
    if (!window.confirm(`Delete “${deck.name}”?`)) return
    setDecks((current) => current.filter((item) => item.id !== activeId))
  }

  if (!deck) {
    return (
      <div className="decks-empty-page">
        <span className="huge-rune"><Layers3 /></span>
        <span className="eyebrow">Your workshop</span>
        <h1>Build your first deck</h1>
        <p>Choose a Legend, add a 40-card main deck, 12 runes, and 3 battlefields. Everything is saved locally.</p>
        <button className="primary-btn" onClick={addNewDeck}><Plus size={18} /> Create a deck</button>
        <div className="format-row"><span><strong>1</strong> Legend</span><span><strong>40</strong> Main</span><span><strong>12</strong> Runes</span><span><strong>3</strong> Fields</span></div>
      </div>
    )
  }

  const deckZone = deck[deckTab] || {}
  const allDeckCounts = { ...deck.cards, ...deck.runes, ...deck.battlefields, ...(deck.legendId ? { [deck.legendId]: 1 } : {}) }
  const builderCards = cards.filter((card) => {
    const needle = query.trim().toLowerCase()
    return (!needle || cardSearchText(card).includes(needle)) && (filter === 'All' || card.type === filter)
  })
  const legend = cardsById[deck.legendId]
  const champion = cardsById[deck.championId]
  const complete = Boolean(legend && champion && deck.cards?.[champion.id]) && deckCount(deck) === 40 && zoneCount(deck.runes) === 12 && zoneCount(deck.battlefields) === 3

  return (
    <div className="deck-builder">
      <div className="deck-builder-head">
        <div className="deck-switcher">
          <span className="eyebrow">Deck builder</span>
          <label><select value={activeId} onChange={(event) => setActiveId(event.target.value)}>{decks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={16} /></label>
          <button className="icon-btn" onClick={addNewDeck} title="New deck"><Plus size={18} /></button>
        </div>
        <div className={`legality ${complete ? 'complete' : ''}`}><span><Check size={13} /></span>{complete ? 'Ready to play' : 'In progress'}</div>
      </div>

      <div className="builder-layout">
        <section className="builder-catalog">
          <div className="builder-search-row">
            <label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a card…" /></label>
            <label className="compact-select"><select value={filter} onChange={(event) => setFilter(event.target.value)}>{FILTER_TYPES.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
          </div>
          <div className="builder-results-meta"><span>{builderCards.length} cards</span><span>Click + to add</span></div>
          <div className="builder-card-grid">{builderCards.slice(0, 180).map((card) => <CardTile key={card.id} card={card} onOpen={setSelectedCard} onAdd={addCard} count={allDeckCounts[card.id] || 0} />)}</div>
          {builderCards.length > 180 && <p className="result-hint">Refine your search to see the remaining {builderCards.length - 180} cards.</p>}
        </section>

        <aside className="deck-panel">
          <div className="deck-title-row">
            <input value={deck.name} onChange={(event) => updateDeck({ name: event.target.value.slice(0, 40) })} aria-label="Deck name" />
            <button className="danger-icon" onClick={deleteDeck} title="Delete deck"><Trash2 size={17} /></button>
          </div>
          <div className="legend-slot">
            {legend ? <><div className="legend-thumb"><CardArtwork card={legend} /></div><div><small>Your legend</small><strong>{legend.name}</strong><span><i style={{ background: DOMAIN_COLORS[legend.faction] }} />{titleCase(legend.faction)}</span></div><button onClick={() => removeCard(legend, 'legend')}><X size={15} /></button></> : <><span><UserRound /></span><div><small>Your legend</small><strong>Choose a Legend</strong><p>Add one from the catalog</p></div></>}
          </div>
          <div className={`champion-slot ${champion ? 'filled' : ''}`}>
            <span><Swords size={15} /></span>
            <div><small>Chosen champion</small><strong>{champion?.name || 'Mark a unit in your main deck'}</strong></div>
            {champion && <button onClick={() => updateDeck({ championId: null })}><X size={14} /></button>}
          </div>

          <div className="deck-progress-grid">
            <ProgressRing value={deckCount(deck)} target={40} label="Main" />
            <ProgressRing value={zoneCount(deck.runes)} target={12} label="Runes" />
            <ProgressRing value={zoneCount(deck.battlefields)} target={3} label="Fields" />
          </div>

          <div className="deck-tabs">
            {[['cards', 'Main deck'], ['runes', 'Runes'], ['battlefields', 'Fields']].map(([id, label]) => <button key={id} className={deckTab === id ? 'active' : ''} onClick={() => setDeckTab(id)}>{label}<span>{zoneCount(deck[id])}</span></button>)}
          </div>
          <div className="deck-list">
            {deckEntries({ cards: deckZone }, cardsById).map(({ card, count }) => (
              <div className="deck-list-item" key={card.id}>
                <span className="energy-gem">{card.stats?.energy ?? '·'}</span>
                <div><strong>{card.name}</strong><small><i style={{ background: DOMAIN_COLORS[card.faction] }} />{card.type}{deckTab === 'cards' && card.type === 'Unit' && <button className={deck.championId === card.id ? 'chosen' : ''} onClick={() => updateDeck({ championId: card.id })}>{deck.championId === card.id ? 'Chosen champion' : 'Set champion'}</button>}</small></div>
                <span className="quantity-control"><button onClick={() => removeCard(card, deckTab)}><Minus size={13} /></button><b>{count}</b><button onClick={() => addCard(card)}><Plus size={13} /></button></span>
              </div>
            ))}
            {!Object.keys(deckZone).length && <div className="zone-empty"><BookOpen size={22} /><span>No cards here yet</span><small>Add {deckTab === 'cards' ? 'units, spells, and gear' : deckTab} from the catalog.</small></div>}
          </div>
          <div className="deck-panel-footer"><span><i className={complete ? 'done' : ''}>{complete ? <Check size={12} /> : '!'}</i>{complete ? 'Deck complete' : 'Finish deck requirements'}</span><button onClick={() => navigator.clipboard?.writeText(JSON.stringify(deck))}><Copy size={15} /> Copy list</button></div>
        </aside>
      </div>
      <CardModal card={selectedCard} onClose={() => setSelectedCard(null)} onAdd={addCard} count={selectedCard ? allDeckCounts[selectedCard.id] || 0 : 0} />
    </div>
  )
}

function ProgressRing({ value, target, label }) {
  const progress = Math.min(100, (value / target) * 100)
  return <div className="progress-item"><span className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` }}><b>{value}</b><i>/{target}</i></span><small>{label}</small></div>
}

function PlayView({ decks, cards }) {
  const [name, setName] = useState(localStorage.getItem('rift-local-player') || '')
  const [roomCode, setRoomCode] = useState('')
  const [selectedDeck, setSelectedDeck] = useState(decks[0]?.id || '')
  const [room, setRoom] = useState(null)
  const [selfId, setSelfId] = useState(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const socketRef = useRef(null)

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] })
    socketRef.current = socket
    socket.on('connect', () => {
      setConnected(true)
      try {
        const saved = JSON.parse(sessionStorage.getItem('rift-local-session') || 'null')
        if (saved?.roomCode && saved?.playerId && saved?.reconnectToken) {
          socket.emit('room:reconnect', saved, (response) => {
            if (response?.ok) {
              setSelfId(response.playerId)
              setRoom({ ...response.state, selfId: response.playerId })
            } else {
              sessionStorage.removeItem('rift-local-session')
            }
          })
        }
      } catch { sessionStorage.removeItem('rift-local-session') }
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('room:state', (payload) => setRoom((current) => ({ ...payload.state, selfId: current?.selfId })))
    socket.on('server:error', (payload) => setError(payload?.message || 'The local server rejected that action'))
    return () => socket.disconnect()
  }, [])

  const cardsById = useMemo(() => Object.fromEntries(cards.map((card) => [card.id, card])), [cards])
  const chosen = decks.find((deck) => deck.id === selectedDeck)

  function quickDeck() {
    return cards.filter((card) => !['Legend', 'Rune', 'Battlefield'].includes(card.type) && !card.variant).slice(0, 40).map((card) => card.id)
  }

  function playerPayload() {
    const cleanName = name.trim() || 'Player'
    localStorage.setItem('rift-local-player', cleanName)
    const selectedCards = expandedMainDeck(chosen)
    return { playerName: cleanName, deck: selectedCards.length ? selectedCards : quickDeck() }
  }

  function acceptSession(response) {
    if (!response?.ok) {
      setError(response?.error?.message || 'Could not open that room')
      return
    }
    const session = { roomCode: response.roomCode, playerId: response.playerId, reconnectToken: response.reconnectToken }
    sessionStorage.setItem('rift-local-session', JSON.stringify(session))
    setSelfId(response.playerId)
    setRoom({ ...response.state, selfId: response.playerId })
  }

  function createRoom() {
    setError('')
    socketRef.current?.emit('room:create', playerPayload(), (response) => {
      acceptSession(response)
    })
  }

  function joinRoom() {
    setError('')
    socketRef.current?.emit('room:join', { ...playerPayload(), roomCode: roomCode.trim().toUpperCase() }, (response) => {
      acceptSession(response)
    })
  }

  function leaveRoom() {
    socketRef.current?.emit('room:leave', {})
    sessionStorage.removeItem('rift-local-session')
    setSelfId(null)
    setRoom(null)
  }

  if (room?.status === 'playing' || room?.status === 'finished') {
    return <GameBoard room={{ ...room, selfId: selfId || room.selfId }} socket={socketRef.current} cardsById={cardsById} onLeave={leaveRoom} />
  }

  if (room) {
    return <RoomLobby room={{ ...room, selfId: selfId || room.selfId }} socket={socketRef.current} connected={connected} onLeave={leaveRoom} />
  }

  return (
    <div className="play-page">
      <section className="play-intro">
        <span className="eyebrow"><Radio size={14} /> Same Wi‑Fi · Two devices</span>
        <h1>Your table.<br /><em>No cloud required.</em></h1>
        <p>One device creates a private room. The other joins with a six-character code. Every move stays on your local network.</p>
        <div className="connection-steps">
          <div><span>01</span><strong>Host the app</strong><small>Run it on one computer</small></div>
          <i />
          <div><span>02</span><strong>Share the address</strong><small>Open it on device two</small></div>
          <i />
          <div><span>03</span><strong>Enter the code</strong><small>Meet at the same table</small></div>
        </div>
        <div className="local-callout"><ShieldCheck /><div><strong>Private local session</strong><span>Cards and game state never leave your network.</span></div></div>
      </section>

      <section className="room-card">
        <div className="room-card-head"><span className="room-icon"><Swords /></span><div><span className="eyebrow">Local duel</span><h2>Enter the arena</h2></div><span className={`server-badge ${connected ? '' : 'offline'}`}><i />{connected ? 'Server ready' : 'Connecting'}</span></div>
        <label className="field-label">Player name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder="What should we call you?" /></label>
        <label className="field-label">Battle deck<select value={selectedDeck} onChange={(event) => setSelectedDeck(event.target.value)}><option value="">Quick demo deck · 40 cards</option>{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name} · {deckCount(deck)}/40</option>)}</select></label>
        <button className="primary-btn wide host-btn" onClick={createRoom} disabled={!connected}><Wifi size={18} /> Create private room</button>
        <div className="or-divider"><span>or join a friend</span></div>
        <div className="join-row"><input value={roomCode} onChange={(event) => setRoomCode(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase())} onKeyDown={(event) => event.key === 'Enter' && joinRoom()} placeholder="ROOM CODE" /><button className="outline-btn" onClick={joinRoom} disabled={roomCode.length < 4}>Join room</button></div>
        {error && <p className="form-error">{error}</p>}
        <p className="room-footnote"><Globe2 size={14} /> Both devices must be connected to the same Wi‑Fi.</p>
      </section>
    </div>
  )
}

function RoomLobby({ room, socket, connected, onLeave }) {
  const [copied, setCopied] = useState(false)
  const players = room.players || []
  const self = players.find((player) => player.id === room.selfId)
  const everyoneReady = players.length === 2 && players.every((player) => player.ready)
  const isHost = room.hostPlayerId === room.selfId
  function copyCode() {
    navigator.clipboard?.writeText(room.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="waiting-room">
      <button className="back-link" onClick={onLeave}><ArrowLeft size={17} /> Leave room</button>
      <div className="waiting-orb"><Radio /></div>
      <span className="eyebrow">Private local room</span>
      <h1>{players.length < 2 ? 'Waiting for your rival' : 'Both players are here'}</h1>
      <p>{players.length < 2 ? 'Open this app on the second device and enter the code below.' : 'Lock in when you are ready to begin the duel.'}</p>
      <button className="room-code" onClick={copyCode}><span>{room.code}</span><small>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy code</>}</small></button>
      <div className="versus-row">
        {[0, 1].map((index) => {
          const player = players[index]
          return <div className={`player-seat ${player ? 'filled' : ''}`} key={index}><span>{player ? player.name?.slice(0, 2).toUpperCase() : <UserRound />}</span><strong>{player?.name || 'Open seat'} {player?.id === room.selfId ? '· You' : ''}</strong><small>{player ? (player.ready ? 'Ready' : 'Choosing deck') : 'Waiting…'}</small>{player?.ready && <Check className="ready-check" size={14} />}</div>
        })}
        <i>VS</i>
      </div>
      {everyoneReady && isHost ? (
        <button className="primary-btn ready-btn" disabled={!connected} onClick={() => socket?.emit('game:start', {})}><Swords size={18} /> Start the duel</button>
      ) : (
        <button className="primary-btn ready-btn" disabled={!connected || players.length < 2} onClick={() => socket?.emit('game:ready', { ready: !self?.ready })}><Swords size={18} /> {self?.ready ? 'Ready — tap to cancel' : players.length < 2 ? 'Waiting for player two' : 'Lock in & play'}</button>
      )}
      <span className="pulse-copy"><i /> {connected ? 'Connected to local host' : 'Reconnecting…'}</span>
    </div>
  )
}

function GameBoard({ room, socket, cardsById, onLeave }) {
  const game = room
  const self = game.players?.find((player) => player.id === room.selfId) || {}
  const opponent = game.players?.find((player) => player.id !== room.selfId) || {}
  const hand = self.zones?.hand?.cards || []
  const [selected, setSelected] = useState(null)
  const ownBoard = self.zones?.board?.cards || []
  const opposingBoard = opponent.zones?.board?.cards || []
  const selectedBoardCard = ownBoard.find((card) => card.instanceId === selected)

  function action(type, payload = {}) {
    socket?.emit('game:action', { type, payload })
  }

  const fieldCards = (cards, field) => cards.filter((card) => {
    const value = card.counters?.field
    return field === -1 ? value == null || value === -1 : value === field
  })

  return (
    <div className="game-board">
      <div className="game-topbar"><button onClick={onLeave}><ArrowLeft size={16} /> Exit match</button><span>Room {room.code}</span><strong>{game.status === 'finished' ? (game.winnerPlayerId === room.selfId ? 'You won' : 'Match finished') : game.turnPlayerId === room.selfId ? 'Your turn' : `${opponent.name || 'Opponent'}’s turn`}</strong></div>
      <section className="opponent-strip"><PlayerBadge player={opponent} /><div className="card-back-stack"><span /><b>{opponent.zones?.hand?.count ?? 0}</b><small>hand</small></div><ScoreControl value={opponent.score || 0} label="Opponent" readOnly /></section>
      <section className="battlefield-mat">
        <div className="mat-glow" />
        <Zone label="Opponent base" cards={fieldCards(opposingBoard, -1)} cardsById={cardsById} compact />
        <div className="battlefields-row">
          {[0, 1, 2].map((index) => <Zone key={index} label={`Battlefield ${index + 1}`} cards={[...fieldCards(opposingBoard, index), ...fieldCards(ownBoard, index)]} cardsById={cardsById} selected={selected} onSelect={(instance) => instance.ownerPlayerId === room.selfId && setSelected(instance.instanceId)} landscape />)}
        </div>
        <Zone label="Your base" cards={fieldCards(ownBoard, -1)} cardsById={cardsById} selected={selected} onSelect={(instance) => setSelected(instance.instanceId)} compact />
      </section>
      <section className="player-strip"><PlayerBadge player={self} self /><div className="resource-counters"><ScoreControl value={self.counters?.energy || 0} label="Energy" onChange={(delta) => action('SET_COUNTER', { key: 'energy', value: (self.counters?.energy || 0) + delta })} /><ScoreControl value={self.score || 0} label="Score" onChange={(delta) => action('ADJUST_SCORE', { delta })} /></div><div className="deck-pile"><button onClick={() => action('DRAW')}><span /><b>{self.zones?.deck?.count ?? 0}</b><small>Draw</small></button></div></section>
      {selectedBoardCard && <div className="card-action-bar"><span>Move selected card</span><button onClick={() => action('SET_CARD_COUNTER', { instanceId: selected, key: 'field', value: -1 })}>Base</button>{[0, 1, 2].map((field) => <button key={field} onClick={() => action('SET_CARD_COUNTER', { instanceId: selected, key: 'field', value: field })}>Field {field + 1}</button>)}<button onClick={() => action('SET_CARD_STATE', { instanceId: selected, exhausted: !selectedBoardCard.exhausted })}>{selectedBoardCard.exhausted ? 'Ready' : 'Exhaust'}</button><button className="danger" onClick={() => { action('MOVE_CARD', { instanceId: selected, from: 'board', to: 'discard' }); setSelected(null) }}>Discard</button><button className="close-action" onClick={() => setSelected(null)}><X size={14} /></button></div>}
      <section className="hand-zone"><div className="hand-label">Your hand <span>{hand.length}</span><small>{self.zones?.discard?.count || 0} discarded</small></div><div className="hand-cards">{hand.map((instance) => { const card = cardsById[instance.cardId]; return card ? <button key={instance.instanceId} className={selected === instance.instanceId ? 'selected' : ''} onClick={() => setSelected(instance.instanceId)}><CardArtwork card={card} /></button> : null })}</div><div className="turn-actions"><button className="outline-btn" disabled={!hand.some((card) => card.instanceId === selected)} onClick={() => { action('MOVE_CARD', { instanceId: selected, from: 'hand', to: 'board' }); setSelected(null) }}>Play to base</button><button className="primary-btn" disabled={game.turnPlayerId !== room.selfId || game.status !== 'playing'} onClick={() => action('END_TURN')}>End turn <ArrowLeft className="arrow-right" size={16} /></button></div></section>
    </div>
  )
}

function PlayerBadge({ player, self }) {
  return <div className="player-badge"><span>{player?.name?.slice(0, 2).toUpperCase() || 'P?'}</span><div><small>{self ? 'You' : 'Opponent'}</small><strong>{player?.name || 'Player'}</strong></div></div>
}

function ScoreControl({ value, label, onChange, readOnly = false }) {
  return <div className="score-control"><small>{label}</small><span>{!readOnly && <button onClick={() => onChange(-1)}><Minus size={12} /></button>}<b>{value}</b>{!readOnly && <button onClick={() => onChange(1)}><Plus size={12} /></button>}</span></div>
}

function Zone({ label, cards = [], cardsById, compact, landscape, selected, onSelect }) {
  return <div className={`play-zone ${compact ? 'compact' : ''} ${landscape ? 'landscape' : ''}`}><small>{label}</small><div>{cards.length ? cards.map((item, index) => { const card = typeof item === 'string' ? cardsById[item] : cardsById[item.cardId]; return card ? <button key={item.instanceId || `${card.id}-${index}`} className={`${selected === item.instanceId ? 'selected' : ''} ${item.exhausted ? 'exhausted' : ''}`} onClick={() => onSelect?.(item)}><CardArtwork card={card} /></button> : <span className="face-down-card" key={item.instanceId || index} /> }) : <em>Drop zone</em>}</div></div>
}

export default function App() {
  const [page, setPage] = useState('discover')
  const { cards, loading } = useCards()
  const [decks, setDecksState] = useState(() => loadDecks().map(normalizeDeck))

  function setDecks(update) {
    setDecksState((current) => {
      const next = typeof update === 'function' ? update(current) : update
      saveDecks(next)
      return next
    })
  }

  const pageMeta = {
    discover: ['Card archive', 'All cards'],
    decks: ['Workshop', 'My decks'],
    play: ['Local tabletop', 'Play 1v1'],
  }[page]

  return (
    <div className={`app-shell page-${page}`}>
      <Sidebar page={page} onPage={setPage} />
      <main className="main-content">
        <Topbar kicker={pageMeta[0]} title={pageMeta[1]} />
        <div className={`page-content ${page === 'decks' ? 'page-content--wide' : ''}`}>
          {page === 'discover' && <DiscoverView cards={cards} loading={loading} onBuild={() => setPage('decks')} />}
          {page === 'decks' && <DecksView cards={cards} decks={decks} setDecks={setDecks} />}
          {page === 'play' && <PlayView decks={decks} cards={cards} />}
        </div>
      </main>
      <MobileNav page={page} onPage={setPage} />
    </div>
  )
}
