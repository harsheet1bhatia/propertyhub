// Fast sharing helpers (v7)
// - photos are shared as a compressed JPEG copy (Cloudinary), not the 3-8 MB original  -> 10x smaller, 10x faster
// - files download in parallel (6 at a time) and stay cached, so the next tap is instant
const done = new Map()      // url -> { blob } | { failed: true }
const inflight = new Map()  // url -> Promise
const CONCURRENCY = 6

export function isVideoUrl(url) {
  return /video\/upload/i.test(url) || /\.(mp4|mov|webm)(\?|$)/i.test(url)
}

// Small, share-friendly copy of a Cloudinary photo (JPEG works in every chat app). Videos stay original.
function shareUrl(url) {
  if (!url || isVideoUrl(url)) return url
  if (!/res\.cloudinary\.com/.test(url) || !/\/upload\//.test(url)) return url
  if (/\/upload\/(?!v\d)[^/]+\//.test(url)) return url // already transformed
  return url.replace('/upload/', '/upload/f_jpg,q_auto:good,w_1600/')
}

async function fetchBlob(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.blob()
}

function load(item) {
  const url = item.url
  if (done.has(url)) return Promise.resolve()
  if (inflight.has(url)) return inflight.get(url)
  const p = (async () => {
    const small = shareUrl(url)
    let blob
    try { blob = await fetchBlob(small) } catch (e) {
      if (small === url) throw e
      blob = await fetchBlob(url) // fallback: original file
    }
    done.set(url, { blob })
  })().catch(() => { done.set(url, { failed: true }) }).finally(() => { inflight.delete(url) })
  inflight.set(url, p)
  return p
}

export function isShareReady(item) {
  return done.has(item.url)
}

// Downloads all items, several at once. Resolves when every item is ready or failed.
export async function prepareShareItems(items, onProgress) {
  const queue = items.filter(i => !done.has(i.url))
  const pending = []
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()
      await load(item)
      onProgress?.()
    }
  }
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) pending.push(worker())
  // items already being loaded by another call
  items.forEach(i => { if (inflight.has(i.url)) pending.push(inflight.get(i.url).then(() => onProgress?.())) })
  await Promise.all(pending)
}

// Android Chrome accepts about 10 files / 50 MB per share; iPhone is more relaxed.
export function buildShareBatches(items, ios) {
  const maxCount = ios ? 40 : 10
  const maxBytes = ios ? 150 * 1024 * 1024 : 48 * 1024 * 1024
  const batches = []
  const skipped = []
  let cur = []
  let size = 0
  for (const item of items) {
    const entry = done.get(item.url)
    if (!entry || entry.failed) { skipped.push(item); continue }
    const bytes = entry.blob.size
    if (bytes > 250 * 1024 * 1024) { skipped.push(item); continue }
    if (cur.length && (cur.length >= maxCount || size + bytes > maxBytes)) { batches.push(cur); cur = []; size = 0 }
    cur.push(item)
    size += bytes
  }
  if (cur.length) batches.push(cur)
  return { batches, skipped }
}

function safe(value) {
  return String(value || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'Property'
}

export function makeShareFile(item, propertyId, index) {
  const blob = done.get(item.url).blob
  const mime = (blob.type || (isVideoUrl(item.url) ? 'video/mp4' : 'image/jpeg')).split(';')[0].toLowerCase()
  const sub = mime.split('/')[1] || 'jpg'
  const ext = (sub === 'jpeg' ? 'jpg' : sub === 'quicktime' ? 'mov' : sub).replace(/[^a-z0-9]/g, '') || 'jpg'
  const parts = [`Property-${safe(propertyId)}`]
  if (item.folder && item.folder !== 'Photos & Videos') parts.push(safe(item.folder))
  parts.push(String(index + 1).padStart(2, '0'))
  if (item.label) parts.push(safe(item.label))
  return new File([blob], `${parts.join('_')}.${ext}`, { type: mime })
}
