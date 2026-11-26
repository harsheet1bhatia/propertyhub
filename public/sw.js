// PropertyHub service worker v6
// - pages: always network first (so a new version is picked up immediately)
// - /assets/*: cached (file names change on every build)
// - Cloudinary photos shown in the page: cached for fast opening
// - everything else (share/download fetches, Supabase, /api/manifest, videos) goes straight to the network
const VERSION = 'ph-v6'
const PAGES = VERSION + '-pages'
const ASSETS = VERSION + '-assets'
const IMAGES = VERSION + '-images'
const MAX_IMAGES = 300

self.addEventListener('install', () => { self.skipWaiting() })

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    const old = keys.filter(k => !k.startsWith(VERSION))
    await Promise.all(old.map(k => caches.delete(k)))
    await self.clients.claim()
    // Upgrading from an older version: reload open pages once so they run the new app
    if (old.length) {
      const windows = await self.clients.matchAll({ type: 'window' })
      windows.forEach(client => { try { client.navigate(client.url) } catch (e) { /* ignore */ } })
    }
  })())
})

async function trim(cache, max) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i])
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = new URL(req.url)

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req)
        if (res.ok && url.origin === self.location.origin) {
          const cache = await caches.open(PAGES)
          cache.put('/__shell', res.clone())
        }
        return res
      } catch (e) {
        const cache = await caches.open(PAGES)
        return (await cache.match('/__shell')) || Response.error()
      }
    })())
    return
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) cache.put(req, res.clone())
      return res
    })())
    return
  }

  if (req.destination === 'image' && url.hostname === 'res.cloudinary.com') {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGES)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(req, res.clone()).then(() => trim(cache, MAX_IMAGES)).catch(() => {})
      }
      return res
    })())
  }
})
