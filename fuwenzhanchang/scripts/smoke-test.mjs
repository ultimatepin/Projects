import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { io } from 'socket.io-client'

const port = 3099
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverError = ''
server.stderr.on('data', (chunk) => { serverError += chunk })

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.ok) return
    } catch {}
    await delay(100)
  }
  throw new Error(`Server did not start. ${serverError}`)
}

function connectClient() {
  return new Promise((resolve, reject) => {
    const socket = io(origin, { forceNew: true, transports: ['websocket'] })
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
    }, 2500)
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
try {
  await waitForServer()
  ;[host, guest] = await Promise.all([connectClient(), connectClient()])

  const deck = ['ogn-001-298', 'ogn-002-298', 'ogn-003-298', 'ogn-004-298']
  const created = await emitAck(host, 'room:create', { playerName: 'Host', deck })
  assert.equal(created.ok, true)
  assert.equal(created.roomCode.length, 6)

  const joined = await emitAck(guest, 'room:join', { roomCode: created.roomCode, playerName: 'Guest', deck })
  assert.equal(joined.ok, true)
  await emitAck(host, 'game:ready', { ready: true })
  await emitAck(guest, 'game:ready', { ready: true })

  const playing = nextState(host, (state) => state.status === 'playing')
  const started = await emitAck(host, 'game:start')
  assert.equal(started.ok, true)
  await playing

  const hostDrawState = nextState(host, (state) => state.players.find((player) => player.id === created.playerId)?.zones.hand.count === 1)
  const guestDrawState = nextState(guest, (state) => state.players.find((player) => player.id === created.playerId)?.zones.hand.count === 1)
  const drawn = await emitAck(host, 'game:action', { type: 'DRAW', payload: { count: 1 } })
  assert.equal(drawn.ok, true)
  const [hostView, guestView] = await Promise.all([hostDrawState, guestDrawState])
  const hostPlayerForHost = hostView.players.find((player) => player.id === created.playerId)
  const hostPlayerForGuest = guestView.players.find((player) => player.id === created.playerId)
  assert.equal(hostPlayerForHost.zones.hand.cards.length, 1)
  assert.equal(hostPlayerForGuest.zones.hand.cards, undefined)

  const card = hostPlayerForHost.zones.hand.cards[0]
  const boardState = nextState(guest, (state) => state.players.find((player) => player.id === created.playerId)?.zones.board.count === 1)
  const moved = await emitAck(host, 'game:action', { type: 'MOVE_CARD', payload: { instanceId: card.instanceId, from: 'hand', to: 'board' } })
  assert.equal(moved.ok, true)
  const publicBoard = await boardState
  assert.equal(publicBoard.players.find((player) => player.id === created.playerId).zones.board.cards[0].cardId, card.cardId)

  console.log('LAN smoke test passed: create → join → ready → start → private draw → public play')
} finally {
  host?.disconnect()
  guest?.disconnect()
  server.kill()
}
