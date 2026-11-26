import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import './pwa.css'

/* ===============================================================
   2) Service worker (fast open + saved photos)
================================================================ */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

/* ===============================================================
   3) Small local storage helpers (instant open)
================================================================ */
export const lsGet = (key) => { try { return JSON.parse(window.localStorage.getItem(key)) } catch { return null } }
export const lsSet = (key, value) => {
  try {
    if (value == null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage full or blocked */ }
}

const DB_NAME = 'propertyhub-cache'
const STORE = 'kv'
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
export async function cacheGet(key) {
  try {
    const db = await openDb()
    return await new Promise(resolve => {
      const q = db.transaction(STORE).objectStore(STORE).get(key)
      q.onsuccess = () => resolve(q.result)
      q.onerror = () => resolve(undefined)
    })
  } catch { return undefined }
}
export async function cacheSet(key, value) {
  try {
    const db = await openDb()
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key)
  } catch { /* ignore */ }
}
// Called on logout so the next person on a shared phone never sees saved admin data
export async function cacheClear() {
  try {
    const db = await openDb()
    db.transaction(STORE, 'readwrite').objectStore(STORE).clear()
  } catch { /* ignore */ }
  try {
    Object.keys(window.localStorage).filter(k => k.startsWith('ph_role_') || k.startsWith('ph_company') || k === 'ph_companies' || k === 'ph_brand_admin').forEach(k => window.localStorage.removeItem(k))
  } catch { /* ignore */ }
}

/* ===============================================================
   3b) Each company gets its own app name + logo
   Viewer app: manifest comes from /api/manifest?c=<company slug>
   Admin app: same, with &a=1 (name gets " Admin"). Super admin = PropertyHub.
================================================================ */
export function logoIcon(url, size, pad) {
  if (!url) return ''
  if (/res\.cloudinary\.com/.test(url) && /\/upload\//.test(url)) {
    const t = pad
      ? 'c_fit,w_' + Math.round(size * 0.7) + ',h_' + Math.round(size * 0.7) + '/c_pad,w_' + size + ',h_' + size + ',b_white,f_png'
      : 'c_pad,w_' + size + ',h_' + size + ',b_white,f_png'
    return url.replace('/upload/', '/upload/' + t + '/')
  }
  return url
}

function setManifest(slug, mode) {
  let link = document.querySelector('link[rel="manifest"]')
  if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link) }
  const href = slug
    ? '/api/manifest?c=' + encodeURIComponent(slug) + (mode === 'admin' ? '&a=1' : '')
    : '/manifest.webmanifest'
  if (link.getAttribute('href') !== href) link.setAttribute('href', href)
}

function setHead(selector, create, attr, value) {
  let el = document.querySelector(selector)
  if (!el) { el = create(); document.head.appendChild(el) }
  el.setAttribute(attr, value)
}

try {
  const sp = new URLSearchParams(window.location.search)
  if (sp.get('client')) {
    /* client link: normal manifest */
  } else if (sp.get('public') === '1') {
    setManifest(sp.get('company') || 'fnf-properties', 'viewer')
    // iPhone: tell Safari this page is a full-screen app so the home-screen icon opens THIS viewer link
    setHead('meta[name="apple-mobile-web-app-capable"]', () => { const m = document.createElement('meta'); m.name = 'apple-mobile-web-app-capable'; return m }, 'content', 'yes')
    setHead('meta[name="mobile-web-app-capable"]', () => { const m = document.createElement('meta'); m.name = 'mobile-web-app-capable'; return m }, 'content', 'yes')
  } else {
    const savedBrand = lsGet('ph_brand_admin')
    if (savedBrand && savedBrand.slug) setManifest(savedBrand.slug, 'admin')
  }
} catch { /* ignore */ }

// Call from App: keeps manifest, iPhone home-screen name and icon in sync with the company
export function useBrand(info, mode) {
  const slug = info && info.slug
  const name = info && info.name
  const logo = info && info.logo_url
  useEffect(() => {
    if (!slug || !name) return
    if (mode === 'admin') { lsSet('ph_brand_admin', { slug }); setManifest(slug, 'admin') }
    else setManifest(slug, 'viewer')
    setHead('meta[name="apple-mobile-web-app-title"]', () => { const m = document.createElement('meta'); m.name = 'apple-mobile-web-app-title'; return m }, 'content', mode === 'admin' ? name + ' Admin' : name)
    if (logo) {
      setHead('link[rel="apple-touch-icon"]', () => { const l = document.createElement('link'); l.rel = 'apple-touch-icon'; return l }, 'href', logoIcon(logo, 180, false))
    }
  }, [slug, name, logo, mode])
}

/* ===============================================================
   4) Live updates
   - Admins: database change events (instant)
   - Everyone: a "changed" ping sent by the admin after every save
   - Also refreshes when the app is opened again / internet returns,
     plus a slow background check as a safety net.
================================================================ */
const channels = new Map()

export function announceChange(key) {
  if (!key) return
  try { channels.get(key)?.send({ type: 'broadcast', event: 'changed', payload: { t: Date.now() } }) } catch { /* ignore */ }
}

export function useLiveRefresh({ key, onChange, dbEvents = false, enabled = true, pollMs = 60000 }) {
  const latest = useRef(onChange)
  latest.current = onChange

  useEffect(() => {
    if (!enabled) return undefined
    let timer
    const fire = () => { clearTimeout(timer); timer = setTimeout(() => latest.current?.(), 500) }

    let channel
    if (key) {
      channel = supabase.channel('ph-live-' + key)
      channel.on('broadcast', { event: 'changed' }, fire)
      if (dbEvents) {
        ;['properties', 'property_tours'].forEach(table =>
          channel.on('postgres_changes', { event: '*', schema: 'public', table }, fire))
      }
      channel.subscribe()
      channels.set(key, channel)
    }

    const onVisible = () => { if (document.visibilityState === 'visible') fire() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', fire)
    const poll = setInterval(() => { if (document.visibilityState === 'visible') latest.current?.() }, pollMs)

    return () => {
      clearTimeout(timer)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', fire)
      if (channel) { supabase.removeChannel(channel); channels.delete(key) }
    }
  }, [key, enabled, dbEvents, pollMs])
}

/* ===============================================================
   5) Install button (top-right)
================================================================ */
let deferredPrompt = null
const listeners = new Set()
const emit = () => listeners.forEach(fn => fn())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredPrompt = event; emit() })
  window.addEventListener('appinstalled', () => { deferredPrompt = null; emit() })
}

const isStandalone = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function InstallButton() {
  const [, force] = useState(0)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    const fn = () => force(n => n + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])

  if (isStandalone()) return null
  const ios = isIOS()
  if (!deferredPrompt && !ios) return null

  const onClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      try { await deferredPrompt.userChoice } catch { /* ignore */ }
      deferredPrompt = null
      emit()
    } else {
      setHelp(true)
    }
  }

  return (
    <>
      <button type="button" className="pwa-install-btn" onClick={onClick}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 11l5 5 5-5M5 21h14" /></svg>
        Install App
      </button>
      {help && (
        <div className="pwa-sheet-overlay" onClick={() => setHelp(false)}>
          <div className="pwa-sheet" onClick={e => e.stopPropagation()}>
            <h3>Install PropertyHub</h3>
            <ol className="pwa-steps">
              <li>Neeche (ya upar) <b>Share</b> button dabao <span aria-hidden="true">⬆️</span></li>
              <li><b>Add to Home Screen</b> chuno</li>
              <li>Top-right mein <b>Add</b> dabao. Bas, app icon home screen par aa jayega.</li>
            </ol>
            <p className="pwa-note">iPhone par ye Safari se hi hota hai.</p>
            <button type="button" className="pwa-sheet-close" onClick={() => setHelp(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  )
}

/* ===============================================================
   6) Bottom navigation (shows ONLY inside the installed app on phones)
================================================================ */
const ICONS = {
  home: <path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  video: <><rect x="2" y="5" width="14" height="14" rx="2" /><path d="M22 7l-6 5 6 5z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  settings: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  share: <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14" />,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
}
function Icon({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>
}

export function BottomNav({ items, moreItems = [], moreActive = false }) {
  const [more, setMore] = useState(false)

  const renderItem = (item, index) => {
    const content = (
      <>
        <span className="pwa-nav-ico"><Icon name={item.icon} /></span>
        <span className="pwa-nav-label">{item.label}</span>
      </>
    )
    const cls = `pwa-nav-item${item.active ? ' active' : ''}${item.primary ? ' primary' : ''}`
    return item.href
      ? <a key={index} className={cls} href={item.href}>{content}</a>
      : <button key={index} type="button" className={cls} onClick={() => { setMore(false); item.onClick?.() }}>{content}</button>
  }

  return (
    <>
      {more && (
        <div className="pwa-sheet-overlay" onClick={() => setMore(false)}>
          <div className="pwa-sheet" onClick={e => e.stopPropagation()}>
            {moreItems.map((item, i) => (
              <button
                key={i}
                type="button"
                className={`pwa-sheet-row${item.danger ? ' danger' : ''}`}
                onClick={() => { setMore(false); item.onClick?.() }}
              >{item.label}</button>
            ))}
          </div>
        </div>
      )}
      <nav className="pwa-bottom-nav" aria-label="App navigation">
        {items.map(renderItem)}
        {moreItems.length > 0 && (
          <button type="button" className={`pwa-nav-item${moreActive || more ? ' active' : ''}`} onClick={() => setMore(v => !v)}>
            <span className="pwa-nav-ico"><Icon name="more" /></span>
            <span className="pwa-nav-label">More</span>
          </button>
        )}
      </nav>
    </>
  )
}
