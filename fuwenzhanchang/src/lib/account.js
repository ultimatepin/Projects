const ACCOUNT_API = '/api/account'

let csrfToken = null
let sessionRequest = null

export class AccountApiError extends Error {
  constructor(message, { status = 0, code = 'ACCOUNT_REQUEST_FAILED', retryAfter = null, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'AccountApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
    this.isConflict = status === 409 || code === 'REVISION_CONFLICT'
    this.isAuthenticationRequired = status === 401 || code === 'AUTHENTICATION_REQUIRED'
  }
}

export async function getAccountSession() {
  if (!sessionRequest) {
    sessionRequest = accountFetch('/session')
      .then((session) => {
        rememberCsrfToken(session)
        return session
      })
      .finally(() => { sessionRequest = null })
  }
  return sessionRequest
}

export async function registerAccount(username, password) {
  return csrfMutation('/register', {
    method: 'POST',
    body: { username, password },
  })
}

export async function loginAccount(username, password) {
  return csrfMutation('/login', {
    method: 'POST',
    body: { username, password },
  })
}

export async function logoutAccount() {
  return csrfMutation('/logout', { method: 'POST', body: {} })
}

export async function getAccountDecks() {
  return accountFetch('/decks')
}

export async function replaceAccountDecks(decks, revision, { keepalive = false } = {}) {
  return csrfMutation('/decks', {
    method: 'PUT',
    body: { decks, revision },
    keepalive,
  })
}

async function csrfMutation(path, options) {
  if (!csrfToken) await getAccountSession()
  try {
    return await accountFetch(path, { ...options, csrf: true })
  } catch (error) {
    if (!(error instanceof AccountApiError) || error.code !== 'INVALID_CSRF_TOKEN') throw error
    csrfToken = null
    await getAccountSession()
    return accountFetch(path, { ...options, csrf: true })
  }
}

async function accountFetch(path, { method = 'GET', body, csrf = false, keepalive = false } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (csrf && csrfToken) headers['X-Rift-CSRF'] = csrfToken

  let response
  try {
    response = await fetch(`${ACCOUNT_API}${path}`, {
      method,
      headers,
      credentials: 'include',
      keepalive,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    throw new AccountApiError(
      'The account service is unavailable. Make sure the local host app is running.',
      { code: 'ACCOUNT_UNAVAILABLE', cause },
    )
  }

  const payload = await readResponsePayload(response)
  if (!response.ok || payload?.ok === false) {
    const serverError = payload?.error
    const retryHeader = Number(response.headers.get('retry-after'))
    throw new AccountApiError(
      serverError?.message || defaultErrorMessage(response.status),
      {
        status: response.status,
        code: serverError?.code || `HTTP_${response.status}`,
        retryAfter: Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null,
      },
    )
  }

  rememberCsrfToken(payload)
  return payload
}

async function readResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) return null
  try {
    return await response.json()
  } catch {
    throw new AccountApiError('The account service returned an invalid response.', {
      status: response.status,
      code: 'INVALID_ACCOUNT_RESPONSE',
    })
  }
}

function rememberCsrfToken(payload) {
  if (typeof payload?.csrfToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(payload.csrfToken)) {
    csrfToken = payload.csrfToken
  }
}

function defaultErrorMessage(status) {
  if (status === 401) return 'Sign in to access decks saved on this host.'
  if (status === 403) return 'This account action is not allowed from the current connection.'
  if (status === 409) return 'Your saved decks changed. Reload them before saving again.'
  if (status === 429) return 'Too many attempts. Wait a moment and try again.'
  return `The account request failed${status ? ` (${status})` : ''}.`
}
