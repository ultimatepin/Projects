import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Globe2,
  Grid2X2,
  Layers3,
  Library,
  Menu,
  Minus,
  Plus,
  Radio,
  Search,
  Settings2,
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
import AccountModal from './components/AccountModal'
import HelpModal from './components/HelpModal'
import OfficialGameBoard from './components/OfficialGameBoard'
import UpdatesView from './components/UpdatesView'
import { CHAMPION_DECKS } from './data/championDecks'
import { fallbackCards } from './data/fallbackCards'
import { getAccountDecks, getAccountSession, loginAccount, logoutAccount, registerAccount, replaceAccountDecks } from './lib/account'
import { copyText, parseInvite, readStorage, removeStorage, writeStorage } from './lib/browser'
import { cardImage, cardSearchText, deckCount, deckEntries, DOMAIN_COLORS, SET_NAMES, titleCase, zoneCount } from './lib/cards'
import { championDeckToUserDeck, deckDefinition, getPlayableDeckChoices, validateDeck } from './lib/decks'
import { createDeck, loadDecks, saveDecks } from './lib/storage'

const NAV = [
  { id: 'discover', label: 'Discover', icon: Grid2X2 },
  { id: 'decks', label: 'My decks', icon: Layers3 },
  { id: 'play', label: 'Play local', icon: Swords },
  { id: 'updates', label: 'Updates', icon: Settings2 },
]

const FILTER_TYPES = ['All', 'Unit', 'Spell', 'Gear', 'Battlefield', 'Legend', 'Rune']
const FILTER_DOMAINS = ['all', 'fury', 'calm', 'mind', 'body', 'chaos', 'order', 'colorless']
const ACCOUNT_SAVE_RETRY_DELAYS = [600, 1800]

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

function Sidebar({ page, onPage, onHelp, account, onAccount }) {
  const username = account?.user?.username
  return (
    <aside className="sidebar">
      <Brand />
      <nav className="primary-nav" aria-label="Main navigation">
        <span className="nav-eyebrow">Library</span>
        {NAV.slice(0, 2).map(({ id, label, icon }) => (
          <button key={id} data-page={id} className={page === id ? 'active' : ''} onClick={() => onPage(id)}>
            {createElement(icon, { size: 18, strokeWidth: 1.8 })}{label}
          </button>
        ))}
        <span className="nav-eyebrow nav-eyebrow--spaced">Tabletop</span>
        {NAV.slice(2).map(({ id, label, icon }) => (
          <button key={id} data-page={id} className={page === id ? 'active' : ''} onClick={() => onPage(id)}>
            {createElement(icon, { size: 18, strokeWidth: 1.8 })}{label}{id === 'play' && <i className="live-dot" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-note">
        <Wifi size={17} />
        <div><strong>Local network</strong><span>Private by design</span></div>
        <ShieldCheck size={16} className="verified" />
      </div>
      <div className="sidebar-footer">
        <button onClick={onHelp}><CircleHelp size={17} /> How to play</button>
        <button className="sidebar-account" onClick={onAccount}>
          <span className="profile-dot">{username?.slice(0, 2).toUpperCase() || <UserRound size={15} />}</span>
          <span><strong>{username || 'Local account'}</strong><small>{username ? 'Decks saved on this host' : 'Sign in to save decks'}</small></span>
        </button>
      </div>
    </aside>
  )
}

function MobileNav({ page, onPage }) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {NAV.map(({ id, label, icon }) => (
        <button key={id} data-page={id} className={page === id ? 'active' : ''} onClick={() => onPage(id)}>
          {createElement(icon, { size: 20 })}<span>{label.replace('My ', '').replace(' local', '')}</span>
        </button>
      ))}
    </nav>
  )
}

function Topbar({ title, kicker, onMenu, onHelp, account, onAccount }) {
  return (
    <header className="topbar">
      <button className="mobile-menu" onClick={onMenu} aria-label="Open menu"><Menu /></button>
      <div><span>{kicker}</span><strong>{title}</strong></div>
      <div className="topbar-actions">
        <span className="connection-pill"><i /> Server online</span>
        <button className="account-pill" onClick={onAccount}><UserRound size={15} />{account?.user?.username || 'Sign in'}</button>
        <button className="icon-btn" onClick={onHelp} aria-label="Help"><CircleHelp size={19} /></button>
      </div>
    </header>
  )
}

function MobileDrawer({ open, page, onPage, onHelp, onClose }) {
  if (!open) return null
  return (
    <div className="mobile-drawer-backdrop" onMouseDown={onClose}>
      <aside className="mobile-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mobile-drawer-head"><Brand /><button onClick={onClose} aria-label="Close menu"><X /></button></div>
        <nav>{NAV.map(({ id, label, icon }) => <button key={id} data-page={id} className={page === id ? 'active' : ''} onClick={() => { onPage(id); onClose() }}>{createElement(icon, { size: 18 })}{label}</button>)}</nav>
        <button className="drawer-help" onClick={() => { onClose(); onHelp() }}><CircleHelp size={18} /> How to play</button>
      </aside>
    </div>
  )
}

function Toast({ toast, onClose }) {
  if (!toast) return null
  return <button className={`app-toast ${toast.tone || ''}`} onClick={onClose}><span>{toast.tone === 'error' ? '!' : <Check size={14} />}</span>{toast.message}<X size={13} /></button>
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

function EmptyState({ icon, title, copy, action }) {
  return <div className="empty-state"><span>{createElement(icon)}</span><h3>{title}</h3><p>{copy}</p>{action}</div>
}

function zoneForCard(card) {
  if (card.type === 'Legend') return 'legend'
  if (card.type === 'Rune') return 'runes'
  if (card.type === 'Battlefield') return 'battlefields'
  return 'cards'
}

function DecksView({ cards, decks, setDecks, onToast }) {
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

  function addChampionDeck(presetId) {
    const preset = CHAMPION_DECKS.find((item) => item.id === presetId)
    if (!preset) return
    const next = championDeckToUserDeck(preset)
    setDecks((current) => [...current, next])
    setActiveId(next.id)
    onToast?.(`${preset.champion} Champion Deck added to My decks.`)
  }

  function updateDeck(patch) {
    setDecks((current) => current.map((item) => item.id === activeId ? { ...item, ...patch, updatedAt: Date.now() } : item))
  }

  function addCard(card) {
    const zone = zoneForCard(card)
    if (card.is_banned) {
      onToast?.(`${card.name} is on the current Constructed ban list.`, 'error')
      return
    }
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
    if (zone === 'cards' && zoneTotal >= 40) {
      onToast?.('The main deck already has 40 cards.', 'error')
      return
    }
    if (currentCount >= cap || zoneTotal >= totalCap || (zone === 'cards' && sameNameCount >= 3) || (zone === 'battlefields' && sameNameCount >= 1)) {
      const message = zone === 'runes' ? 'The rune deck already has 12 cards.'
        : zone === 'battlefields' ? 'Choose three battlefields with unique names.'
          : 'A main deck can contain at most three cards with the same name.'
      onToast?.(message, 'error')
      return
    }
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
        <div className="precon-starter-grid">
          {CHAMPION_DECKS.map((preset) => <button key={preset.id} onClick={() => addChampionDeck(preset.id)}><Swords size={14} /><span><strong>{preset.champion}</strong><small>{SET_NAMES[preset.setId] || preset.setId} Champion Deck</small></span></button>)}
        </div>
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
  const validation = validateDeck(deck, cards)
  const complete = validation.valid
  const deckStatus = validation.errors[0]?.message || validation.warnings[0]?.message || 'Official structural checks passed; tag/domain metadata is unavailable.'

  return (
    <div className="deck-builder">
      <div className="deck-builder-head">
        <div className="deck-switcher">
          <span className="eyebrow">Deck builder</span>
          <label><select value={activeId} onChange={(event) => setActiveId(event.target.value)}>{decks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={16} /></label>
          <button className="icon-btn" onClick={addNewDeck} title="New deck"><Plus size={18} /></button>
          <label className="precon-import"><select value="" onChange={(event) => addChampionDeck(event.target.value)} aria-label="Add a Champion Deck"><option value="">Add Champion Deck…</option>{CHAMPION_DECKS.map((preset) => <option key={preset.id} value={preset.id}>{preset.champion} · {SET_NAMES[preset.setId] || preset.setId}</option>)}</select><ChevronDown size={16} /></label>
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
          <div className="deck-panel-footer"><span title={deckStatus}><i className={complete ? 'done' : ''}>{complete ? <Check size={12} /> : '!'}</i>{complete ? (validation.warnings.length ? 'Playable · casual exception' : 'Deck complete') : deckStatus}</span><button onClick={async () => { try { await copyText(JSON.stringify(deck, null, 2)); onToast?.('Deck list copied.') } catch { onToast?.('Could not copy. Select and copy the deck manually.', 'error') } }}><Copy size={15} /> Copy list</button></div>
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

function PlayView({ decks, cards, onToast }) {
  const inviteFromUrl = useMemo(() => parseInvite(window.location.href), [])
  const savedSession = useMemo(() => {
    try { return JSON.parse(readStorage(sessionStorage, 'rift-local-session', 'null')) } catch { return null }
  }, [])
  const [name, setName] = useState(() => readStorage(localStorage, 'rift-local-player', ''))
  const [roomCode, setRoomCode] = useState(inviteFromUrl?.code || '')
  const [selectedDeck, setSelectedDeck] = useState(`precon:${CHAMPION_DECKS[0].id}`)
  const [serverOrigin, setServerOrigin] = useState(inviteFromUrl?.origin || savedSession?.serverOrigin || window.location.origin)
  const [networkUrls, setNetworkUrls] = useState([])
  const [room, setRoom] = useState(null)
  const [selfId, setSelfId] = useState(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState('')
  const socketRef = useRef(null)

  useEffect(() => {
    setConnected(false)
    const target = serverOrigin === window.location.origin ? undefined : serverOrigin
    const socket = io(target, { transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 })
    socketRef.current = socket
    socket.on('connect', () => {
      setConnected(true)
      let saved = null
      try { saved = JSON.parse(readStorage(sessionStorage, 'rift-local-session', 'null')) } catch { saved = null }
      if (saved?.roomCode && saved?.playerId && saved?.reconnectToken && (!saved.serverOrigin || saved.serverOrigin === serverOrigin)) {
        socket.timeout(5000).emit('room:reconnect', saved, (timeoutError, response) => {
          if (!timeoutError && response?.ok) {
            setSelfId(response.playerId)
            setRoom({ ...response.state, selfId: response.playerId })
          } else {
            removeStorage(sessionStorage, 'rift-local-session')
          }
        })
      }
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('room:state', (payload) => setRoom((current) => ({ ...payload.state, selfId: current?.selfId })))
    socket.on('server:error', (payload) => setError(payload?.message || 'The local server rejected that action'))
    socket.on('server:shutdown', (payload) => setError(payload?.message || 'The host app closed.'))
    return () => socket.disconnect()
  }, [serverOrigin])

  useEffect(() => {
    const controller = new AbortController()
    let port = ''
    try { port = new URL(serverOrigin).port } catch { port = '' }
    fetch(`${serverOrigin}/api/network-info?clientPort=${port || 80}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setNetworkUrls(payload.urls || []))
      .catch(() => setNetworkUrls([]))
    return () => controller.abort()
  }, [serverOrigin])

  const cardsById = useMemo(() => Object.fromEntries(cards.map((card) => [card.id, card])), [cards])
  const playableChoices = useMemo(() => getPlayableDeckChoices(decks, cards), [cards, decks])
  const chosen = playableChoices.find((deck) => deck.id === selectedDeck)
  const userDeckOptions = useMemo(() => decks.map((deck) => ({ deck, validation: validateDeck(deck, cards) })), [cards, decks])
  const canJoin = connected && Boolean(chosen) && roomCode.length === 6 && !pending

  useEffect(() => {
    if (!chosen && playableChoices.length) setSelectedDeck(playableChoices[0].id)
  }, [chosen, playableChoices])

  function playerPayload() {
    const cleanName = name.trim() || 'Player'
    writeStorage(localStorage, 'rift-local-player', cleanName)
    if (!chosen) throw new Error('Choose a complete, playable deck first.')
    return {
      playerName: cleanName,
      deck: {
        ...deckDefinition(chosen),
        presetId: chosen.presetId || null,
        casualPreconException: chosen.validation?.usedExactPreconException === true,
      },
    }
  }

  function friendlyError(response, fallback) {
    if (response?.error?.code === 'ROOM_NOT_FOUND') return 'Room not found on this host. Paste the full invite link from the host, not only a code from another app copy.'
    return response?.error?.message || fallback
  }

  function acceptSession(response) {
    if (!response?.ok) {
      setError(friendlyError(response, 'Could not open that room.'))
      return false
    }
    const session = { roomCode: response.roomCode, playerId: response.playerId, reconnectToken: response.reconnectToken, serverOrigin }
    writeStorage(sessionStorage, 'rift-local-session', JSON.stringify(session))
    setSelfId(response.playerId)
    setRoom({ ...response.state, selfId: response.playerId })
    return true
  }

  function requestRoom(event, payload, label) {
    if (!socketRef.current?.connected || pending) return
    setPending(label)
    setError('')
    removeStorage(sessionStorage, 'rift-local-session')
    socketRef.current.timeout(7000).emit(event, payload, (timeoutError, response) => {
      setPending('')
      if (timeoutError) {
        setError('The host did not answer. Check the invite address, Wi-Fi, and Private-network firewall permission.')
        return
      }
      acceptSession(response)
    })
  }

  function createRoom() {
    try { requestRoom('room:create', playerPayload(), 'create') } catch (payloadError) { setError(payloadError.message) }
  }

  function joinRoom() {
    if (!canJoin) return
    try { requestRoom('room:join', { ...playerPayload(), roomCode }, 'join') } catch (payloadError) { setError(payloadError.message) }
  }

  function changeJoinValue(value) {
    const invite = parseInvite(value)
    if (invite) {
      setRoomCode(invite.code)
      setError('')
      if (invite.origin !== serverOrigin) {
        removeStorage(sessionStorage, 'rift-local-session')
        setRoom(null)
        setSelfId(null)
        setServerOrigin(invite.origin)
      }
      return
    }
    setRoomCode(value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase())
  }

  function leaveRoom() {
    socketRef.current?.emit('room:leave', {})
    removeStorage(sessionStorage, 'rift-local-session')
    setSelfId(null)
    setRoom(null)
    setError('')
  }

  if (room?.status === 'playing' || room?.status === 'finished') {
    return <OfficialGameBoard room={{ ...room, selfId: selfId || room.selfId }} socket={socketRef.current} cardsById={cardsById} connected={connected} error={error} onError={setError} onClearError={() => setError('')} onLeave={leaveRoom} />
  }

  if (room) {
    return <RoomLobby room={{ ...room, selfId: selfId || room.selfId }} socket={socketRef.current} connected={connected} networkUrls={networkUrls} serverOrigin={serverOrigin} error={error} onError={setError} onClearError={() => setError('')} onToast={onToast} onLeave={leaveRoom} />
  }

  return (
    <div className="play-page">
      <section className="play-intro">
        <span className="eyebrow"><Radio size={14} /> Same Wi-Fi · Two devices</span>
        <h1>Your table.<br /><em>No cloud required.</em></h1>
        <p>One device hosts the room. Device two opens that host’s full invite link, so both players reach the same table instead of two separate local servers.</p>
        <div className="connection-steps">
          <div><span>01</span><strong>Host the app</strong><small>Run the Windows package once</small></div>
          <i />
          <div><span>02</span><strong>Share the invite</strong><small>Send the full Wi-Fi address</small></div>
          <i />
          <div><span>03</span><strong>Join the same host</strong><small>Paste the link or enter its code</small></div>
        </div>
        <div className="local-callout"><ShieldCheck /><div><strong>Private local session</strong><span>Decks and game state never leave your network.</span></div></div>
      </section>

      <section className="room-card">
        <div className="room-card-head"><span className="room-icon"><Swords /></span><div><span className="eyebrow">Local duel</span><h2>Enter the arena</h2></div><span className={`server-badge ${connected ? '' : 'offline'}`}><i />{connected ? 'Server ready' : 'Connecting'}</span></div>
        <div className="target-host"><Globe2 size={15} /><span><small>Connected host</small><strong>{serverOrigin.replace(/^https?:\/\//, '')}</strong></span></div>
        <label className="field-label">Player name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder="What should we call you?" /></label>
        <label className="field-label">Battle deck<select value={selectedDeck} onChange={(event) => setSelectedDeck(event.target.value)}>
          <optgroup label="Official Champion Decks">{playableChoices.filter((choice) => choice.kind === 'precon').map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</optgroup>
          {userDeckOptions.length > 0 && <optgroup label="My decks">{userDeckOptions.map(({ deck, validation }) => <option key={deck.id} value={deck.id} disabled={!validation.playable}>{deck.name} · {validation.playable ? 'ready' : validation.errors[0]?.message || 'incomplete'}</option>)}</optgroup>}
        </select></label>
        {chosen?.validation?.warnings?.[0] && <p className="deck-choice-warning">{chosen.validation.warnings[0].message}</p>}
        <button className="primary-btn wide host-btn" onClick={createRoom} disabled={!connected || !chosen || Boolean(pending)}><Wifi size={18} /> {pending === 'create' ? 'Creating room…' : !chosen ? 'Loading playable decks…' : 'Create private room'}</button>
        <div className="or-divider"><span>or join a friend</span></div>
        <div className="join-row"><input value={roomCode} onChange={(event) => changeJoinValue(event.target.value)} onPaste={(event) => { const text = event.clipboardData.getData('text'); if (parseInvite(text)) { event.preventDefault(); changeJoinValue(text) } }} onKeyDown={(event) => event.key === 'Enter' && canJoin && joinRoom()} placeholder="CODE OR INVITE LINK" /><button className="outline-btn" onClick={joinRoom} disabled={!canJoin}>{pending === 'join' ? 'Joining…' : 'Join room'}</button></div>
        <p className="join-hint">If each device opened its own app, paste the host’s full invite link here.</p>
        {error && <p className="form-error">{error}</p>}
        <p className="room-footnote"><Globe2 size={14} /> Both devices must be connected to the same Private Wi-Fi.</p>
      </section>
    </div>
  )
}

function RoomLobby({ room, socket, connected, networkUrls, serverOrigin, error, onError, onClearError, onToast, onLeave }) {
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState('')
  const players = room.players || []
  const self = players.find((player) => player.id === room.selfId)
  const everyoneReady = players.length === 2 && players.every((player) => player.ready)
  const isHost = room.hostPlayerId === room.selfId
  const shareBase = networkUrls.find((url) => !url.includes('localhost') && !url.includes('127.0.0.1')) || serverOrigin
  const inviteUrl = `${shareBase.replace(/\/$/, '')}/?join=${room.code}`

  async function copy(value, label) {
    try {
      await copyText(value)
      setCopied(label)
      onToast?.(`${label} copied.`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      onToast?.('Copy is blocked. Select the invite address and copy it manually.', 'error')
    }
  }

  function lobbyAction(event, payload = {}) {
    if (!connected || pending) return
    setPending(event)
    onClearError()
    socket.timeout(6000).emit(event, payload, (timeoutError, response) => {
      setPending('')
      if (timeoutError) onError('The host did not answer. Check the Wi-Fi connection.')
      else if (!response?.ok) onError(response?.error?.message || 'That action could not be completed.')
    })
  }
  return (
    <div className="waiting-room">
      <button className="back-link" onClick={onLeave}><ArrowLeft size={17} /> Leave room</button>
      <div className="waiting-orb"><Radio /></div>
      <span className="eyebrow">Private local room</span>
      <h1>{players.length < 2 ? 'Waiting for your rival' : 'Both players are here'}</h1>
      <p>{players.length < 2 ? 'Open the full invite below on device two. The code alone cannot cross between two independently hosted app copies.' : 'Lock in when you are ready to begin the duel.'}</p>
      <div className="invite-panel">
        <button className="room-code" onClick={() => copy(room.code, 'Code')}><span>{room.code}</span><small>{copied === 'Code' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy code</>}</small></button>
        <div className="invite-link"><span><Globe2 size={14} /><strong>{inviteUrl}</strong></span><button onClick={() => copy(inviteUrl, 'Invite link')}>{copied === 'Invite link' ? <Check size={15} /> : <Copy size={15} />} {copied === 'Invite link' ? 'Copied' : 'Copy full invite'}</button></div>
      </div>
      <div className="versus-row">
        {[0, 1].map((index) => {
          const player = players[index]
          return <div className={`player-seat ${player ? 'filled' : ''}`} key={index}><span>{player ? player.name?.slice(0, 2).toUpperCase() : <UserRound />}</span><strong>{player?.name || 'Open seat'} {player?.id === room.selfId ? '· You' : ''}</strong><small>{player ? (player.ready ? 'Ready' : 'Choosing deck') : 'Waiting…'}</small>{player?.ready && <Check className="ready-check" size={14} />}</div>
        })}
        <i>VS</i>
      </div>
      {everyoneReady && isHost ? (
        <div className="lobby-action-row"><button className="outline-btn" disabled={!connected || Boolean(pending)} onClick={() => lobbyAction('game:ready', { ready: false })}>Cancel ready</button><button className="primary-btn ready-btn" disabled={!connected || Boolean(pending)} onClick={() => lobbyAction('game:start')}><Swords size={18} /> {pending === 'game:start' ? 'Starting…' : 'Start the duel'}</button></div>
      ) : (
        <button className="primary-btn ready-btn" disabled={!connected || players.length < 2 || Boolean(pending)} onClick={() => lobbyAction('game:ready', { ready: !self?.ready })}><Swords size={18} /> {self?.ready ? 'Ready — tap to cancel' : players.length < 2 ? 'Waiting for player two' : pending ? 'Saving…' : 'Lock in & play'}</button>
      )}
      {error && <button className="play-error-banner" onClick={onClearError}><span>!</span>{error}<X size={13} /></button>}
      <span className="pulse-copy"><i /> {connected ? 'Connected to local host' : 'Reconnecting…'}</span>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState(() => new URLSearchParams(window.location.search).has('join') ? 'play' : 'discover')
  const [helpOpen, setHelpOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountError, setAccountError] = useState(null)
  const [accountSession, setAccountSession] = useState({ signedIn: false, user: null, loading: true })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const { cards, loading } = useCards()
  const [decks, setDecksState] = useState(() => loadDecks().map(normalizeDeck))
  const guestDecksRef = useRef(decks)
  const deckRevisionRef = useRef(0)
  const lastSyncedDecksRef = useRef('')
  const accountGenerationRef = useRef(0)
  const deckSyncQueueRef = useRef(Promise.resolve())
  const latestDecksRef = useRef(decks)
  const accountSessionRef = useRef(accountSession)
  const unloadFlushFingerprintRef = useRef('')

  latestDecksRef.current = decks
  accountSessionRef.current = accountSession

  const closeAccount = useCallback(() => setAccountOpen(false), [])

  useEffect(() => {
    let alive = true
    async function restoreAccount() {
      try {
        const session = await getAccountSession()
        if (!alive) return
        if (!session.signedIn) {
          setAccountSession({ ...session, loading: false })
          return
        }
        const saved = await getAccountDecks()
        if (!alive) return
        let accountDecks = saved.decks.map(normalizeDeck)
        let revision = saved.revision
        if (!accountDecks.length && guestDecksRef.current.length) {
          const imported = await replaceAccountDecks(guestDecksRef.current, revision)
          if (!alive) return
          accountDecks = imported.decks.map(normalizeDeck)
          revision = imported.revision
        }
        deckRevisionRef.current = revision
        lastSyncedDecksRef.current = JSON.stringify(accountDecks)
        accountGenerationRef.current += 1
        setDecksState(accountDecks)
        setAccountSession({ ...session, loading: false })
      } catch (error) {
        if (!alive) return
        setAccountError(error)
        setAccountSession({ signedIn: false, user: null, loading: false, unavailable: true })
      }
    }
    restoreAccount()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!accountSession.signedIn || accountSession.loading) return undefined
    const fingerprint = JSON.stringify(decks)
    if (fingerprint === lastSyncedDecksRef.current) return undefined
    const generation = accountGenerationRef.current
    const timeout = setTimeout(() => {
      const snapshot = decks.map(normalizeDeck)
      deckSyncQueueRef.current = deckSyncQueueRef.current
        .catch(() => {})
        .then(async () => {
          if (generation !== accountGenerationRef.current) return
          let error = null
          for (let attempt = 0; attempt <= ACCOUNT_SAVE_RETRY_DELAYS.length; attempt += 1) {
            try {
              const saved = await replaceAccountDecks(snapshot, deckRevisionRef.current)
              if (generation !== accountGenerationRef.current) return
              deckRevisionRef.current = saved.revision
              lastSyncedDecksRef.current = JSON.stringify(snapshot)
              return
            } catch (caught) {
              error = caught
              if (
                generation !== accountGenerationRef.current
                || caught.isConflict
                || !isTransientAccountError(caught)
                || attempt >= ACCOUNT_SAVE_RETRY_DELAYS.length
              ) break
              await delay(ACCOUNT_SAVE_RETRY_DELAYS[attempt])
            }
          }
          if (generation !== accountGenerationRef.current) return
          if (error?.isConflict) {
            const latest = await getAccountDecks()
            if (generation !== accountGenerationRef.current) return
            const latestDecks = latest.decks.map(normalizeDeck)
            deckRevisionRef.current = latest.revision
            lastSyncedDecksRef.current = JSON.stringify(latestDecks)
            setDecksState(latestDecks)
            showToast('Decks changed in another window, so the newest saved copy was loaded.', 'error')
            return
          }
          setAccountError(error)
          showToast(error?.message || 'Could not save decks to this account.', 'error')
        })
    }, 450)
    return () => clearTimeout(timeout)
  }, [accountSession.loading, accountSession.signedIn, decks])

  useEffect(() => {
    function flushLatestAccountDecks() {
      const session = accountSessionRef.current
      if (!session.signedIn || session.loading) return
      const snapshot = latestDecksRef.current.map(normalizeDeck)
      const fingerprint = JSON.stringify(snapshot)
      if (
        fingerprint === lastSyncedDecksRef.current
        || fingerprint === unloadFlushFingerprintRef.current
      ) return
      unloadFlushFingerprintRef.current = fingerprint
      replaceAccountDecks(snapshot, deckRevisionRef.current, { keepalive: true })
        .then((saved) => {
          deckRevisionRef.current = saved.revision
          lastSyncedDecksRef.current = fingerprint
        })
        .catch(() => {
          if (unloadFlushFingerprintRef.current === fingerprint) {
            unloadFlushFingerprintRef.current = ''
          }
        })
    }

    window.addEventListener('pagehide', flushLatestAccountDecks)
    window.addEventListener('beforeunload', flushLatestAccountDecks)
    return () => {
      window.removeEventListener('pagehide', flushLatestAccountDecks)
      window.removeEventListener('beforeunload', flushLatestAccountDecks)
    }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timeout = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timeout)
  }, [toast])

  function showToast(message, tone = 'success') {
    setToast({ message, tone, id: Date.now() })
  }

  function setDecks(update) {
    setDecksState((current) => {
      const next = typeof update === 'function' ? update(current) : update
      if (!accountSession.signedIn) {
        guestDecksRef.current = next
        saveDecks(next)
      }
      return next
    })
  }

  async function finishAccountSignIn(result) {
    const session = { signedIn: true, user: result.user, loading: false }
    const saved = await getAccountDecks()
    let accountDecks = saved.decks.map(normalizeDeck)
    let revision = saved.revision
    if (!accountDecks.length && guestDecksRef.current.length) {
      const imported = await replaceAccountDecks(guestDecksRef.current, revision)
      accountDecks = imported.decks.map(normalizeDeck)
      revision = imported.revision
    }
    accountGenerationRef.current += 1
    deckRevisionRef.current = revision
    lastSyncedDecksRef.current = JSON.stringify(accountDecks)
    setDecksState(accountDecks)
    setAccountSession(session)
    setAccountError(null)
    showToast(`Signed in as ${result.user.username}.`)
  }

  async function handleAccountLogin(username, password) {
    setAccountBusy(true)
    setAccountError(null)
    try {
      await finishAccountSignIn(await loginAccount(username, password))
    } catch (error) {
      setAccountError(error)
      throw error
    } finally {
      setAccountBusy(false)
    }
  }

  async function handleAccountRegister(username, password) {
    setAccountBusy(true)
    setAccountError(null)
    try {
      await finishAccountSignIn(await registerAccount(username, password))
    } catch (error) {
      setAccountError(error)
      throw error
    } finally {
      setAccountBusy(false)
    }
  }

  async function handleAccountLogout() {
    setAccountBusy(true)
    setAccountError(null)
    try {
      const generation = accountGenerationRef.current
      const snapshot = decks.map(normalizeDeck)
      const fingerprint = JSON.stringify(snapshot)
      deckSyncQueueRef.current = deckSyncQueueRef.current.catch(() => {}).then(async () => {
        if (generation !== accountGenerationRef.current || fingerprint === lastSyncedDecksRef.current) return
        const saved = await replaceAccountDecks(snapshot, deckRevisionRef.current)
        deckRevisionRef.current = saved.revision
        lastSyncedDecksRef.current = fingerprint
      })
      await deckSyncQueueRef.current
      await logoutAccount()
      accountGenerationRef.current += 1
      setAccountSession({ signedIn: false, user: null, loading: false })
      setDecksState(guestDecksRef.current)
      closeAccount()
      showToast('Signed out. Guest decks on this device are active again.')
    } catch (error) {
      setAccountError(error)
      throw error
    } finally {
      setAccountBusy(false)
    }
  }

  const pageMeta = {
    discover: ['Card archive', 'All cards'],
    decks: ['Workshop', 'My decks'],
    play: ['Local tabletop', 'Play 1v1'],
    updates: ['Desktop app', 'Updates'],
  }[page]

  return (
    <div className={`app-shell page-${page}`}>
      <Sidebar page={page} onPage={setPage} onHelp={() => setHelpOpen(true)} account={accountSession} onAccount={() => { setAccountError(null); setAccountOpen(true) }} />
      <main className="main-content">
        <Topbar kicker={pageMeta[0]} title={pageMeta[1]} onMenu={() => setMobileMenuOpen(true)} onHelp={() => setHelpOpen(true)} account={accountSession} onAccount={() => { setAccountError(null); setAccountOpen(true) }} />
        <div className={`page-content ${page === 'decks' ? 'page-content--wide' : ''}`}>
          {page === 'discover' && <DiscoverView cards={cards} loading={loading} onBuild={() => setPage('decks')} />}
          {page === 'decks' && <DecksView cards={cards} decks={decks} setDecks={setDecks} onToast={showToast} />}
          {page === 'play' && <PlayView decks={decks} cards={cards} onToast={showToast} />}
          {page === 'updates' && <UpdatesView onToast={showToast} />}
        </div>
      </main>
      <MobileNav page={page} onPage={setPage} />
      <MobileDrawer open={mobileMenuOpen} page={page} onPage={setPage} onHelp={() => setHelpOpen(true)} onClose={() => setMobileMenuOpen(false)} />
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {accountOpen && <AccountModal session={accountSession} busy={accountBusy} error={accountError} onLogin={handleAccountLogin} onRegister={handleAccountRegister} onLogout={handleAccountLogout} onClose={closeAccount} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

function isTransientAccountError(error) {
  return error?.status === 0 || error?.status === 429 || error?.status >= 500
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
