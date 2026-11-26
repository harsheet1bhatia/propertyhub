/* PropertyHub service worker
   - Opens the app instantly from the saved copy (and updates it quietly in the background)
   - Keeps photos once seen, so galleries open fast
   - NEVER caches live data (properties / tours): the app handles that itself */
const VERSION = 'ph-v1'
const SHELL = VERSION + '-shell'
const ASSETS = VERSION + '-assets'
const IMAGES = VERSION + '-images'
const FONTS = VERSION + '-fonts'
const MAX_IMAGES = 400

// Save the build files (JS/CSS) that an index.html points to
async function cacheBuildFiles(html) {
  const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1])
  const cache = await caches.open(ASSETS)
  await Promise.all([...new Set(urls)].map(async url => {
    if (await cache.match(url)) return
    try { const res = await fetch(url); if (res.ok) await cache.put(url, res) } catch (e) { /* ignore */ }
  }))
}

// Fetch the latest index.html; save its files first, then the page itself (so they always match)
async function refreshShell() {
  const res = await fetch('/', { cache: 'no-store' })
  if (!res.ok) return
  const copy = res.clone()
  await cacheBuildFiles(await res.text())
  await (await caches.open(SHELL)).put('/', copy)
}

self.addEventListener('install', event => {
  event.waitUntil(refreshShell().catch(() => {}).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(n => !n.startsWith(VERSION)).map(n => caches.delete(n)))
    await self.clients.claim()
  })())
})

async function openShell(event) {
  const cached = await (await caches.open(SHELL)).match('/')
  if (cached) { event.waitUntil(refreshShell().catch(() => {})); return cached }
  try {
    const res = await fetch(event.request)
    event.waitUntil(refreshShell().catch(() => {}))
    return res
  } catch (e) {
    return new Response('You are offline. Please connect to the internet once.', { status: 503, headers: { 'Content-Type': 'text/plain' } })
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
  return res
}

async function trim(cache) {
  const keys = await cache.keys()
  if (keys.length > MAX_IMAGES) await Promise.all(keys.slice(0, keys.length - MAX_IMAGES).map(k => cache.delete(k)))
}

// Cloudinary links never change for a given photo, so saved copies are always right
async function cachedImage(event) {
  const cache = await caches.open(IMAGES)
  const url = event.request.url
  const hit = await cache.match(url)
  if (hit) return hit
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (res.ok) { await cache.put(url, res.clone()); event.waitUntil(trim(cache)) }
    return res
  } catch (e) {
    return fetch(event.request)
  }
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (req.headers.has('range') || req.destination === 'video' || req.destination === 'audio') return

  if (req.mode === 'navigate' && url.origin === self.location.origin) { event.respondWith(openShell(event)); return }
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req, ASSETS)); return }
  if (url.hostname === 'res.cloudinary.com' && req.destination === 'image') { event.respondWith(cachedImage(event)); return }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(cacheFirst(req, FONTS)); return }
})
