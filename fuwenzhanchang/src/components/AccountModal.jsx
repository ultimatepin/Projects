import { useEffect, useId, useRef, useState } from 'react'
import { HardDrive, LogIn, LogOut, ShieldCheck, UserPlus, WifiOff, X } from 'lucide-react'

export default function AccountModal({
  session,
  busy = false,
  error = null,
  onRegister,
  onLogin,
  onLogout,
  onClose,
}) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [validationError, setValidationError] = useState('')
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef(null)
  const signedIn = Boolean(session?.signedIn && session?.user)
  const message = validationError || accountErrorMessage(error)

  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    const focusable = dialog?.querySelector('button:not([disabled]), input:not([disabled])')
    focusable?.focus()

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const controls = [...dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )]
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [onClose])

  function changeMode(nextMode) {
    setMode(nextMode)
    setPassword('')
    setConfirmation('')
    setValidationError('')
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setValidationError('')
    if (mode === 'register' && password !== confirmation) {
      setValidationError('Passwords do not match.')
      return
    }
    try {
      if (mode === 'register') await onRegister(username, password)
      else await onLogin(username, password)
    } catch (submissionError) {
      setValidationError(accountErrorMessage(submissionError) || 'The account request failed.')
    }
  }

  async function logout() {
    if (busy) return
    setValidationError('')
    try {
      await onLogout()
    } catch (submissionError) {
      setValidationError(accountErrorMessage(submissionError) || 'Could not sign out.')
    }
  }

  return (
    <div
      className="account-modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        ref={dialogRef}
        className="account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <button className="account-modal-close" type="button" onClick={onClose} aria-label="Close account dialog">
          <X aria-hidden="true" />
        </button>

        <div className="account-modal-heading">
          <span className="account-modal-icon"><ShieldCheck aria-hidden="true" /></span>
          <div>
            <span className="account-modal-eyebrow">Local account</span>
            <h2 id={titleId}>{signedIn ? `Signed in as ${session.user.username}` : 'Save decks on this host'}</h2>
          </div>
        </div>

        <p id={descriptionId} className="account-modal-description">
          Accounts and saved decks live only on this host computer. They are not cloud accounts and do not sync between hosts.
        </p>

        <div className="account-modal-network-note">
          <WifiOff aria-hidden="true" />
          <span><strong>LAN security:</strong> Remote sign-in is unavailable over plain HTTP. Sign in from the installed host app, or configure HTTPS.</span>
        </div>

        {signedIn ? (
          <div className="account-modal-session">
            <div className="account-modal-user">
              <HardDrive aria-hidden="true" />
              <div>
                <strong>{session.user.username}</strong>
                <span>Your account decks are stored on this device.</span>
              </div>
            </div>
            {message && <p className="account-modal-error" role="alert">{message}</p>}
            <div className="account-modal-actions">
              <button className="account-modal-secondary" type="button" onClick={onClose}>Done</button>
              <button className="account-modal-danger" type="button" onClick={logout} disabled={busy}>
                <LogOut aria-hidden="true" /> {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="account-modal-tabs" role="tablist" aria-label="Account action">
              <button
                className={mode === 'login' ? 'account-modal-tab-active' : 'account-modal-tab'}
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => changeMode('login')}
                disabled={busy}
              >
                <LogIn aria-hidden="true" /> Sign in
              </button>
              <button
                className={mode === 'register' ? 'account-modal-tab-active' : 'account-modal-tab'}
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => changeMode('register')}
                disabled={busy}
              >
                <UserPlus aria-hidden="true" /> Create account
              </button>
            </div>

            <form className="account-modal-form" onSubmit={submit} noValidate>
              <label className="account-modal-field">
                <span>Username</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  minLength={3}
                  maxLength={32}
                  required
                  disabled={busy}
                />
              </label>
              <label className="account-modal-field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  minLength={12}
                  required
                  disabled={busy}
                />
              </label>
              {mode === 'register' && (
                <label className="account-modal-field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="new-password"
                    minLength={12}
                    required
                    disabled={busy}
                  />
                </label>
              )}
              {mode === 'register' && <p className="account-modal-hint">Use at least 12 characters. Passwords cannot be recovered.</p>}
              {message && <p className="account-modal-error" role="alert">{message}</p>}
              <button className="account-modal-submit" type="submit" disabled={busy || !username || !password}>
                {mode === 'register' ? <UserPlus aria-hidden="true" /> : <LogIn aria-hidden="true" />}
                {busy ? 'Please wait…' : mode === 'register' ? 'Create local account' : 'Sign in'}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

function accountErrorMessage(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (typeof error.message === 'string') return error.message
  if (typeof error.error?.message === 'string') return error.error.message
  return ''
}
