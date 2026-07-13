export function readStorage(storage, key, fallback = null) {
  try {
    const value = storage?.getItem(key)
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

export function writeStorage(storage, key, value) {
  try {
    storage?.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStorage(storage, key) {
  try {
    storage?.removeItem(key)
    return true
  } catch {
    return false
  }
}

export async function copyText(value) {
  const text = String(value)
  if (window.riftDesktop?.copyText) {
    await window.riftDesktop.copyText(text)
    return true
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Clipboard permissions commonly fail on plain HTTP LAN pages; use the selection fallback below.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, text.length)
  let copied = false
  try { copied = document.execCommand('copy') } catch { copied = false }
  textarea.remove()
  if (!copied) throw new Error('Copy is unavailable in this browser')
  return true
}

export function parseInvite(value) {
  const input = String(value || '').trim()
  try {
    const url = new URL(input)
    const code = (url.searchParams.get('join') || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()
    if (!/^https?:$/.test(url.protocol) || !code) return null
    return { code, origin: url.origin }
  } catch {
    return null
  }
}
