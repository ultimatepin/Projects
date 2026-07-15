import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

import { io } from 'socket.io-client'

import { CHAMPION_DECKS } from '../src/data/championDecks.js'

const port = 3099
const origin = `http://127.0.0.1:${port}`
const otherOrigin = 'http://127.0.0.1:3100'
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const otherServer = spawn(process.execPath, ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: '3100' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverError = ''
server.stderr.on('data', (chunk) => { serverError += chunk })

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function presetPayload(id) {
  const preset = CHAMPION_DECKS.find((deck) => deck.id === id)
  assert.ok(preset, `Missing Champion Deck ${id}`)
  return {
    legendId: preset.legendId,
    championId: preset.championId,
    cards: preset.cards,
    runes: preset.runes,
    battlefields: preset.battlefields,
    casualPreconException: preset.validation.casualExactPreconException === true,
  }
}

async function waitForServer(targetOrigin) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${targetOrigin}/api/health`)
      if (response.ok) return
    } catch {
      // The server may still be starting; retry until the deadline below.
    }
    await delay(100)
  }
  throw new Error(`Server did not start. ${serverError}`)
}

function connectClient(targetOrigin = origin) {
  return new Promise((resolve, reject) => {
    const socket = io(targetOrigin, { forceNew: true, transports: ['websocket'] })
    socket.once('connect', () => resolve(socket))
    socket.once('connect_error', reject)
  })
}

function emitAck(socket, event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, resolve))
}

function nextState(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('room:state', onState)
      reject(new Error('Timed out waiting for room state'))
    }, 3000)
    function onState(message) {
      if (!predicate(message.state)) return
      clearTimeout(timeout)
      socket.off('room:state', onState)
      resolve(message.state)
    }
    socket.on('room:state', onState)
  })
}

let host
let guest
let wrongHostGuest
try {
  await Promise.all([waitForServer(origin), waitForServer(otherOrigin)])
  ;[host, wrongHostGuest] = await Promise.all([connectClient(), connectClient(otherOrigin)])

  const hostDeck = presetPayload('precon-ogn-jinx')
  const guestDeck = presetPayload('precon-unl-vi')
  const created = await emitAck(host, 'room:create', { playerName: 'Host', deck: hostDeck })
  assert.equal(created.ok, true)
  assert.equal(created.roomCode.length, 6)

  let duplicateGlobalError = null
  wrongHostGuest.once('server:error', (payload) => { duplicateGlobalError = payload })
  const wrongHostJoin = await emitAck(wrongHostGuest, 'room:join', {
    roomCode: created.roomCode,
    playerName: 'Wrong host',
    deck: guestDeck,
  })
  assert.equal(wrongHostJoin.ok, false)
  assert.equal(wrongHostJoin.error.code, 'ROOM_NOT_FOUND')
  await delay(30)
  assert.equal(duplicateGlobalError, null, 'acknowledged errors should not also emit server:error')
  assert.equal((await fetch(`${otherOrigin}/api/rooms/${created.roomCode}`)).status, 404)
  assert.equal((await fetch(`${origin}/api/rooms/${created.roomCode}`)).status, 200)

  wrongHostGuest.disconnect()
  guest = await connectClient(origin)

  const joined = await emitAck(guest, 'room:join', {
    roomCode: created.roomCode,
    playerName: 'Guest',
    deck: guestDeck,
  })
  assert.equal(joined.ok, true)
  assert.equal((await emitAck(host, 'game:ready', { ready: true })).ok, true)
  assert.equal((await emitAck(guest, 'game:ready', { ready: true })).ok, true)

  const hostStartState = nextState(host, (state) => state.game?.status === 'mulligan')
  const guestStartState = nextState(guest, (state) => state.game?.status === 'mulligan')
  const started = await emitAck(host, 'game:start')
  assert.equal(started.ok, true)
  const [hostOpening, guestOpening] = await Promise.all([hostStartState, guestStartState])

  const hostViewOfHost = hostOpening.game.players.find((player) => player.id === created.playerId)
  const guestViewOfHost = guestOpening.game.players.find((player) => player.id === created.playerId)
  assert.equal(hostViewOfHost.zones.hand.count, 4)
  assert.equal(hostViewOfHost.zones.hand.cards.length, 4)
  assert.equal(guestViewOfHost.zones.hand.cards, undefined)
  assert.equal(hostViewOfHost.zones.mainDeck.count, 35, 'Chosen Champion must be outside the shuffled 39 before opening draw')

  assert.equal((await emitAck(host, 'game:action', { type: 'SUBMIT_MULLIGAN', payload: { instanceIds: [] } })).ok, true)
  const hostPlayingState = nextState(host, (state) => state.game?.status === 'playing')
  const guestPlayingState = nextState(guest, (state) => state.game?.status === 'playing')
  assert.equal((await emitAck(guest, 'game:action', { type: 'SUBMIT_MULLIGAN', payload: { instanceIds: [] } })).ok, true)
  const [hostPlaying, guestPlaying] = await Promise.all([hostPlayingState, guestPlayingState])

  const activePlayerId = hostPlaying.game.turn.activePlayerId
  const activeSocket = activePlayerId === created.playerId ? host : guest
  const activeView = activePlayerId === created.playerId ? hostPlaying : guestPlaying
  const activePlayer = activeView.game.players.find((player) => player.id === activePlayerId)
  assert.equal(activePlayer.zones.runes.length, 2, 'first player channels two Runes')
  assert.equal(activePlayer.zones.hand.count, 5, 'first player draws normally in Duel')

  const energyState = nextState(activeSocket, (state) => state.game?.players.find((player) => player.id === activePlayerId)?.runePool.energy === 1)
  assert.equal((await emitAck(activeSocket, 'game:action', {
    type: 'USE_RUNE',
    payload: { instanceId: activePlayer.zones.runes[0].instanceId, mode: 'energy' },
  })).ok, true)
  await energyState

  const secondPlayerId = hostPlaying.game.players.find((player) => player.id !== activePlayerId).id
  const secondTurnState = nextState(host, (state) => state.game?.turn.activePlayerId === secondPlayerId)
  assert.equal((await emitAck(activeSocket, 'game:action', { type: 'END_TURN', payload: {} })).ok, true)
  const secondTurn = await secondTurnState
  const secondPlayer = secondTurn.game.players.find((player) => player.id === secondPlayerId)
  assert.equal(secondPlayer.zones.runes.length, 3, 'second player channels three Runes on their first turn')

  const finishedState = nextState(host, (state) => state.status === 'finished')
  const concession = await emitAck(guest, 'game:action', { type: 'CONCEDE', payload: {} })
  assert.equal(concession.ok, true)
  const finished = await finishedState
  assert.equal(finished.game.status, 'finished')
  assert.ok(finished.game.winnerPlayerId)

  const networkInfo = await (await fetch(`${origin}/api/network-info`)).json()
  assert.equal(networkInfo.ok, true)
  assert.ok(networkInfo.urls.some((url) => url.endsWith(`:${port}`)))

  console.log('LAN smoke passed: wrong-host diagnosis -> exact precon -> private opening hand -> mulligan -> official Rune turns -> concession')
} finally {
  host?.disconnect()
  guest?.disconnect()
  wrongHostGuest?.disconnect()
  server.kill()
  otherServer.kill()
}
