import { Check, Download, Laptop, PackageCheck, RefreshCw, ShieldCheck, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'

const STATUS_COPY = {
  idle: 'Ready to check',
  checking: 'Checking for updates…',
  available: 'A new version is available',
  downloading: 'Downloading update…',
  downloaded: 'Update ready to install',
  current: 'You are up to date',
  disabled: 'No release channel configured',
  error: 'Update check failed',
}

export default function UpdatesView({ onToast }) {
  const desktop = window.riftDesktop
  const [info, setInfo] = useState(null)
  const [update, setUpdate] = useState({ status: desktop ? 'idle' : 'disabled', progress: 0 })

  useEffect(() => {
    if (!desktop) return undefined
    desktop.getAppInfo().then(setInfo).catch(() => setUpdate({ status: 'error', message: 'Could not read desktop app information.' }))
    return desktop.onUpdateState((next) => setUpdate(next))
  }, [desktop])

  async function check() {
    setUpdate((current) => ({ ...current, status: 'checking', message: '' }))
    try {
      const result = await desktop.checkForUpdates()
      if (result) setUpdate(result)
    } catch (error) {
      setUpdate({ status: 'error', message: error.message })
    }
  }

  async function download() {
    try { await desktop.downloadUpdate() } catch (error) { setUpdate({ status: 'error', message: error.message }) }
  }

  async function install() {
    try { await desktop.installUpdate() } catch (error) { onToast?.(error.message, 'error') }
  }

  return (
    <div className="updates-page">
      <section className="updates-hero">
        <span className="eyebrow"><PackageCheck size={14} /> Desktop package</span>
        <h1>Keep Rift Local<br /><em>battle-ready.</em></h1>
        <p>Check the trusted release channel, download in the background, and install with one click. Active matches are never restarted automatically.</p>
      </section>

      <section className="update-card">
        <div className="update-card-head">
          <span className="update-app-icon"><span /></span>
          <div><small>Installed version</small><h2>Rift Local {info?.version ? `v${info.version}` : ''}</h2><p>{info?.packaged ? 'Windows desktop app' : desktop ? 'Desktop development build' : 'Web companion'}</p></div>
          <span className={`update-status status-${update.status}`}><i />{STATUS_COPY[update.status] || update.status}</span>
        </div>

        {update.status === 'downloading' && <div className="download-progress"><span style={{ width: `${Math.max(2, update.progress || 0)}%` }} /><small>{Math.round(update.progress || 0)}%</small></div>}
        {update.message && <p className={`update-message ${update.status === 'error' ? 'error' : ''}`}>{update.message}</p>}

        <div className="update-actions">
          {!desktop && <button className="primary-btn" disabled><Laptop size={17} /> Open on the host computer</button>}
          {desktop && !['available', 'downloading', 'downloaded'].includes(update.status) && <button className="primary-btn" onClick={check} disabled={update.status === 'checking'}><RefreshCw size={17} className={update.status === 'checking' ? 'spin' : ''} /> Check for updates</button>}
          {desktop && update.status === 'available' && <button className="primary-btn" onClick={download}><Download size={17} /> Download update</button>}
          {desktop && update.status === 'downloading' && <button className="primary-btn" disabled><Download size={17} /> Downloading…</button>}
          {desktop && update.status === 'downloaded' && <button className="primary-btn" onClick={install}><RefreshCw size={17} /> Install & restart</button>}
        </div>

        {!info?.updateConfigured && desktop && <div className="update-config-note"><ShieldCheck /><div><strong>Release channel not embedded in this build</strong><span>Package release builds with <code>UPDATE_BASE_URL</code> to enable trusted one-click updates. The URL is fixed at build time to prevent update-feed hijacking.</span></div></div>}
      </section>

      <div className="update-info-grid">
        <section><Wifi /><div><strong>LAN host</strong><p>{info?.localUrls?.find((url) => !url.includes('localhost') && !url.includes('127.0.0.1')) || 'Available when the desktop host is running'}</p></div></section>
        <section><ShieldCheck /><div><strong>Safe installation</strong><p>Updates are verified by the packaged updater before installation.</p></div></section>
        <section><Check /><div><strong>Your data stays</strong><p>Decks and preferences remain in the app data folder across upgrades.</p></div></section>
      </div>
    </div>
  )
}
