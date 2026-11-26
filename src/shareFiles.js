// Helpers for sharing photos/videos through the phone's share sheet.

function isVideoUrl(url) {
  return /video\/upload/i.test(url) || /\.(mp4|mov|webm)(\?|$)/i.test(url)
}

function safe(value) {
  return String(value || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'Property'
}

// Photos are shared as ordinary JPEG (smaller, and every app accepts it).
// HEIC / WebP / huge originals are a common reason WhatsApp drops the files.
function shareUrl(url) {
  if (!url || isVideoUrl(url)) return url
  if (!/res\.cloudinary\.com/.test(url) || !/\/upload\//.test(url)) return url
  if (/\/upload\/(?!v\d)[^/]+\//.test(url)) return url
  return url.replace('/upload/', '/upload/f_jpg,q_auto:good,w_2400,c_limit/')
}

export async function fetchShareFile(item) {
  const response = await fetch(shareUrl(item.url), { mode: 'cors' })
  if (!response.ok) throw new Error('File could not be loaded (HTTP ' + response.status + ').')
  const blob = await response.blob()
  const video = isVideoUrl(item.url)
  let mime = (blob.type || '').split(';')[0].toLowerCase()
  if (video) { if (!mime.startsWith('video/') || mime === 'video/quicktime') mime = 'video/mp4' }
  else if (!mime.startsWith('image/')) mime = 'image/jpeg'
  const sub = mime.split('/')[1] || 'jpeg'
  const ext = sub === 'jpeg' ? 'jpg' : (sub.replace(/[^a-z0-9]/g, '') || 'jpg')
  return { blob, mime, ext }
}

export function makeShareFile(prepared, item, propertyId, index) {
  const parts = ['Property-' + safe(propertyId)]
  if (item.folder && item.folder !== 'Photos & Videos') parts.push(safe(item.folder))
  parts.push(String(index + 1).padStart(2, '0'))
  if (item.label) parts.push(safe(item.label))
  return new File([prepared.blob], parts.join('_') + '.' + prepared.ext, { type: prepared.mime })
}

// Android Chrome accepts about 10 files and ~50 MB per share, so bigger sets go in parts.
// iPhone has no such limit, so everything goes in one go.
export function buildBatches(items, preparedMap, ios) {
  const MAX_FILES = 10
  const MAX_BYTES = 45 * 1024 * 1024
  const batches = []
  const skipped = []
  let current = []
  let bytes = 0
  for (const item of items) {
    const prepared = preparedMap.get(item.url)
    if (!prepared) { skipped.push(item); continue }
    const size = prepared.blob.size || 0
    if (!ios && size > MAX_BYTES) { skipped.push(item); continue }
    if (!ios && current.length && (current.length >= MAX_FILES || bytes + size > MAX_BYTES)) {
      batches.push(current); current = []; bytes = 0
    }
    current.push(item); bytes += size
  }
  if (current.length) batches.push(current)
  return { batches, skipped }
}
