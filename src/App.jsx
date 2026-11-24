import { useState, useEffect, useMemo } from 'react'
import './App.css'
import { supabase } from './supabase'
import { uploadToCloudinary } from './cloudinary'

/* ---------------------------------------------------------------
   Constants & helpers
---------------------------------------------------------------- */
const PROPERTY_TYPES = ['1RK', '1RK Studio', '1BHK', '2BHK', '3BHK', 'Other']
const FOLDER_KINDS = ['Ground Floor', 'Basement', 'First Floor', 'Rooms', 'Terrace', 'Outside / Common', 'Other']
const PAGE_SIZES = [30, 60, 100]

const emptyForm = {
  id: '', sector: '', location: '', type: '1RK', rent: '',
  caretaker: '', phone: '', map: '', details: ''
}

const emptyFilters = {
  search: '', type: 'All', sector: 'All', sort: 'sector'
}

const params = new URLSearchParams(window.location.search)
const clientShareToken = params.get('client') || ''
const isClientShare = Boolean(clientShareToken)
const isPublic = params.get('public') === '1' || isClientShare
const companySlug = params.get('company') || 'fnf-properties'

function isVideo(url) {
  return /video\/upload/i.test(url) || /\.(mp4|mov|webm)(\?|$)/i.test(url)
}

// Cloudinary: serve a small, auto-format copy for thumbnails (much faster loading).
// Downloads / sharing still use the original file.
function thumb(url, width = 600) {
  if (!url || isVideo(url)) return url
  if (!/res\.cloudinary\.com/.test(url) || !/\/upload\//.test(url)) return url
  if (/\/upload\/(?!v\d)[^/]+\//.test(url)) return url // already transformed
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width}/`)
}

function formatRent(rent) {
  return '₹' + Number(rent || 0).toLocaleString('en-IN')
}

// A property can have several unit types, each with its own rent (e.g. 1RK + 1BHK).
// They are stored in the existing `special_videos` JSON column as { units: [...] }.
function getUnits(p) {
  return p.units && p.units.length ? p.units : [{ type: p.type, rent: p.rent }]
}
function typeLabel(p) {
  return getUnits(p).map(u => u.type).join(' + ')
}
function rentLabel(p) {
  const rents = getUnits(p).map(u => Number(u.rent) || 0)
  const lo = Math.min(...rents)
  const hi = Math.max(...rents)
  return lo === hi ? formatRent(lo) : `${formatRent(lo)} – ${formatRent(hi)}`
}
function cardRent(p) {
  return getUnits(p).length > 1 ? `From ${formatRent(Math.min(...getUnits(p).map(u => Number(u.rent) || 0)))}` : formatRent(p.rent)
}
function buildSpecial(legacy, units, sections) {
  return [...(legacy || []), ...(units && units.length > 1 ? [{ units }] : []), ...sections]
}

function phoneHref(phone) {
  const cleaned = String(phone || '').trim().replace(/(?!^)\+/g, '').replace(/[^0-9+]/g, '')
  return cleaned ? `tel:${cleaned}` : undefined
}

async function copyPropertyText(property) {
  const message = [
    `Sector: ${property.sector || 'N/A'}`,
    `Property: ${property.id || 'N/A'} (${typeLabel(property) || 'N/A'})`,
    `Rent: ${getUnits(property).length > 1 ? getUnits(property).map(u => `${u.type} ${formatRent(u.rent)}`).join(' | ') : formatRent(property.rent)}`,
    `📍 Location: ${property.location || 'N/A'}`,
    `🗺️ Map: ${property.map || 'Not available'}`,
    `📞 Caretaker: ${property.caretaker || 'N/A'} (${property.phone || 'N/A'})`
  ].join('\n')
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) await navigator.clipboard.writeText(message)
    else throw new Error('Clipboard API unavailable')
    alert('Property details copied. Paste them wherever you want.')
  } catch {
    const area = document.createElement('textarea')
    area.value = message
    area.style.position = 'fixed'; area.style.opacity = '0'
    document.body.appendChild(area); area.select()
    const copied = document.execCommand('copy')
    area.remove()
    if (copied) alert('Property details copied.')
    else window.prompt('Copy property details:', message)
  }
}

/* ---------- Photo folders (Ground / Basement / Rooms ...) ----------
   Folders are stored inside the existing `special_videos` JSON column as
   objects: { id, title, kind, items: [{ url, label }] }.
   `media_urls` still holds every file, so old properties keep working. */
function isSection(entry) {
  return !!entry && typeof entry === 'object' && Array.isArray(entry.items)
}

function folderTitle(kind, rooms, custom) {
  if (kind === 'Rooms') {
    const list = String(rooms || '').split(/[,\s]+/).filter(Boolean).join(', ')
    return list ? `Rooms ${list}` : 'Rooms'
  }
  if (kind === 'Other') return String(custom || '').trim() || 'Other'
  return kind
}

// Turn a file name into a room label shown to the viewer (e.g. "Room 4").
function fileLabel(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()
  if (!base) return ''
  if (/^\d{1,3}[a-z]?$/i.test(base)) return `Room ${base.toUpperCase()}`
  if (/room/i.test(base)) return base.length > 30 ? base.slice(0, 30) + '…' : base
  if (/^(img|image|dsc|dscn|pxl|photo|screenshot|vid|video|whatsapp|mvimg)/i.test(base) || /^\d{6,}/.test(base)) return ''
  return base.length > 30 ? base.slice(0, 30) + '…' : base
}

function getFolders(property) {
  const all = property.media_urls || []
  const present = new Set(all)
  const used = new Set()
  const folders = []
  for (const section of property.media_sections || []) {
    const items = (section.items || [])
      .filter(item => present.has(item.url) && !used.has(item.url))
      .map(item => ({ ...item, folder: section.title }))
    items.forEach(item => used.add(item.url))
    if (items.length) folders.push({ id: section.id || section.title, title: section.title, kind: section.kind, items })
  }
  const rest = all.filter(url => !used.has(url))
  if (rest.length) {
    const title = folders.length ? 'Other Photos & Videos' : 'Photos & Videos'
    folders.push({ id: '__general', title, kind: 'General', items: rest.map(url => ({ url, label: '', folder: title })) })
  }
  return folders
}

// Convert a database row into the object used by the UI
function mapRow(item) {
  const rawSpecial = Array.isArray(item.special_videos) ? item.special_videos : []
  return {
    rowId: item.id,
    id: String(item.property_number),
    sector: item.sector || '',
    location: item.location || '',
    type: item.property_type || '',
    rent: Number(item.rent) || 0,
    caretaker: item.caretaker_name || '',
    phone: item.caretaker_phone || '',
    map: item.map_link || '',
    details: item.details || '',
    createdAt: item.created_at || '',
    media_urls: item.media_urls || [],
    media_sections: rawSpecial.filter(isSection),
    units: (rawSpecial.find(entry => entry && !isSection(entry) && Array.isArray(entry.units))?.units) || [],
    special_videos: rawSpecial.filter(entry => !isSection(entry) && !(entry && Array.isArray(entry.units)))
  }
}

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function safeName(value) {
  return String(value || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'Property'
}

async function fetchMediaFile(item, propertyId, index) {
  const response = await fetch(item.url, { mode: 'cors' })
  if (!response.ok) throw new Error(`File ${index + 1} could not be loaded (HTTP ${response.status}).`)
  const blob = await response.blob()
  const mime = (blob.type || (isVideo(item.url) ? 'video/mp4' : 'image/jpeg')).split(';')[0].toLowerCase()
  const sub = mime.split('/')[1] || 'jpg'
  const ext = (sub === 'jpeg' ? 'jpg' : sub === 'quicktime' ? 'mov' : sub).replace(/[^a-z0-9]/g, '') || 'jpg'
  const parts = [`Property-${safeName(propertyId)}`]
  if (item.folder && item.folder !== 'Photos & Videos') parts.push(safeName(item.folder))
  parts.push(String(index + 1).padStart(2, '0'))
  if (item.label) parts.push(safeName(item.label))
  return new File([blob], `${parts.join('_')}.${ext}`, { type: mime })
}

function prepareFiles(items, propertyId) {
  return Promise.all(items.map((item, index) => fetchMediaFile(item, propertyId, index)))
}

async function downloadFiles(items, propertyId, onStatus) {
  let ok = 0
  const failed = []
  for (let i = 0; i < items.length; i++) {
    onStatus?.(`Downloading ${i + 1} of ${items.length}…`)
    try {
      const file = await fetchMediaFile(items[i], propertyId, i)
      const objectUrl = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = file.name
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
      ok++
      await new Promise(resolve => window.setTimeout(resolve, 500))
    } catch (error) {
      console.error('Download failed:', items[i]?.url, error)
      failed.push(i + 1)
    }
  }
  onStatus?.(failed.length
    ? `${ok} of ${items.length} downloaded. Could not download: ${failed.join(', ')}.`
    : `${ok} file(s) downloaded. Check your Downloads / Files app.`)
}

/* ---------------------------------------------------------------
   Small shared components (defined outside App so inputs keep focus)
---------------------------------------------------------------- */
function FilterBar({ filters, setFilter, onReset, sectors }) {
  return (
    <div className="search-box">
      <input
        value={filters.search}
        onChange={e => setFilter('search', e.target.value)}
        placeholder="Search by property number or caretaker name..."
      />

      <select value={filters.type} onChange={e => setFilter('type', e.target.value)}>
        <option value="All">All Types</option>
        {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <select value={filters.sector} onChange={e => setFilter('sector', e.target.value)}>
        <option value="All">All Sectors</option>
        {sectors.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <select value={filters.sort} onChange={e => setFilter('sort', e.target.value)}>
        <option value="sector">Sector (A-Z)</option>
        <option value="rent-low">Rent: Low to High</option>
        <option value="rent-high">Rent: High to Low</option>
        <option value="type">Property Type</option>
      </select>

      <button type="button" className="cancel-button" onClick={onReset}>Reset</button>
    </div>
  )
}

function Pagination({ currentPage, totalPages, setCurrentPage, itemsPerPage, setItemsPerPage, total }) {
  return (
    <div className="pagination">
      <button
        type="button"
        className="cancel-button"
        disabled={currentPage <= 1}
        onClick={() => setCurrentPage(p => p - 1)}
      >
        ← Previous
      </button>

      <span>Page {currentPage} of {totalPages || 1} · {total} properties</span>

      <button
        type="button"
        className="cancel-button"
        disabled={currentPage >= totalPages}
        onClick={() => setCurrentPage(p => p + 1)}
      >
        Next →
      </button>

      <select value={itemsPerPage} onChange={e => setItemsPerPage(Number(e.target.value))}>
        {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / page</option>)}
      </select>
    </div>
  )
}

function PropertyTable({ rows, onView, onEdit, onDuplicate, onShareClient, publicView, loadingList }) {
  const emptyText = loadingList ? 'Loading properties…' : 'No properties found.'
  if (publicView) {
    return (
      <div className="property-mobile-cards public-property-grid">
        {rows.map(property => {
          const allPhotos = (property.media_urls || []).filter(url => !isVideo(url))
          const photos = allPhotos.slice(0, 4)
          return (
            <article className="public-property-card" key={`public-${property.rowId || `${property.id}-${property.sector}-${property.location}`}`}>
              <button className={`property-photo-collage collage-count-${photos.length}`} onClick={() => onView(property)} aria-label={`Open property ${property.id} photos`}>
                {photos.length ? photos.map((url, index) => (
                  <span className="collage-photo" key={`${url}-${index}`}>
                    <img src={thumb(url, 500)} alt={`Property ${property.id} photo ${index + 1}`} loading="lazy" decoding="async" />
                    {index === 3 && allPhotos.length > 4 && <b>+{allPhotos.length - 4}</b>}
                  </span>
                )) : <span className="collage-empty">No photos available</span>}
              </button>
              <div className="public-property-card-content">
                <div className="public-property-card-title">
                  <div><small>{property.sector || 'Property'}</small><h3>#{property.id} · {typeLabel(property)}</h3></div>
                  <strong>{cardRent(property)}<small>/ month</small></strong>
                </div>
                <p>{property.location || 'Location not added'}</p>
                <div className="public-card-actions">
                  <button className="add-button" onClick={() => onView(property)}>View Property</button>
                  <button className="cancel-button" onClick={() => copyPropertyText(property)}>Copy Details</button>
                  <button type="button" className="client-share-button client-share-property-button" onClick={() => onShareClient?.(property.rowId)} disabled={!property.rowId} title={!property.rowId ? 'Property ID is not available yet' : 'Create a private client link'}>Share Property with Client</button>
                </div>
                {property.phone && <a className="public-call-link" href={phoneHref(property.phone)}>Call Caretaker · {property.phone}</a>}
              </div>
            </article>
          )
        })}
        {!rows.length && <p className="public-empty-state">{emptyText}</p>}
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>SECTOR</th><th>PROPERTY</th><th>LOCATION</th><th>TYPE</th><th>MONTHLY RENT</th><th>CARETAKER</th><th>PHONE</th><th>DETAILS</th></tr></thead>
        <tbody>
          {rows.map(property => (
            <tr key={property.rowId || `${property.id}-${property.sector}-${property.location}`}>
              <td>{property.sector}</td><td>{onEdit ? <button className="action-link" onClick={() => onView(property)}><strong>#{property.id}</strong></button> : <strong>#{property.id}</strong>}</td><td>{property.location || 'Not added'}</td><td>{typeLabel(property)}</td><td>{rentLabel(property)}</td><td>{property.caretaker || 'Not added'}</td>
              <td>{property.phone ? <a href={phoneHref(property.phone)}>{property.phone}</a> : 'Not added'}</td>
              <td>
                <div className="row-actions">
                  {onEdit
                    ? <button className="action-link" onClick={() => onEdit(property)}>Edit</button>
                    : <button className="action-link" onClick={() => onView(property)}>View</button>}
                  {onDuplicate && <button className="action-link" onClick={() => onDuplicate(property)}>Duplicate</button>}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="8">{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function DetailsModal({
  property, isAdmin, onClose, onEdit, onDelete, onDuplicate, onPreview,
  selectedMedia, setSelectedMedia, onRemoveOne, onRemoveSelected, onReplace
}) {
  const folders = useMemo(() => getFolders(property), [property])
  const [openFolder, setOpenFolder] = useState(null)
  const [selectMode, setSelectMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(null)
  const [notice, setNotice] = useState('')
  const copyPropertyDetails = () => copyPropertyText(property)

  const currentFolder = folders.find(f => f.id === openFolder) || (folders.length === 1 ? folders[0] : null)
  const showOverview = folders.length > 1 && !currentFolder
  const visibleItems = currentFolder ? currentFolder.items : folders.flatMap(f => f.items)
  const visibleUrls = new Set(visibleItems.map(i => i.url))
  const selectedVisible = selectedMedia.filter(url => visibleUrls.has(url))
  const actionItems = selectedVisible.length ? visibleItems.filter(i => selectedVisible.includes(i.url)) : visibleItems
  const sig = actionItems.map(i => i.url).join('|')
  const countLabel = selectedVisible.length ? `Selected (${actionItems.length})` : `All (${actionItems.length})`
  const readyNow = ready && ready.sig === sig
  const canShare = typeof navigator !== 'undefined' && !!navigator.share && !!navigator.canShare
  const totalFiles = (property.media_urls || []).length

  const openFolderById = (id) => { setOpenFolder(id); setSelectMode(false); setSelectedMedia([]); setReady(null); setNotice('') }
  const toggleSelectMode = () => { setSelectMode(v => !v); setSelectedMedia([]); setReady(null) }

  const handleDownload = async () => {
    if (!actionItems.length || busy) return
    setBusy(true)
    setNotice('')
    await downloadFiles(actionItems, property.id, setNotice)
    setBusy(false)
  }

  // Share opens the phone's share sheet (WhatsApp etc.) without saving files first.
  // iPhone needs the share to start straight from a tap, so files are prepared on the
  // first tap and shared on the next one. Android usually shares in one tap.
  const handleShare = async () => {
    if (!actionItems.length || busy) return
    setNotice('')

    if (readyNow) {
      try {
        await navigator.share({ files: ready.files })
        setReady(null)
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error('Share failed:', error)
          setNotice('Could not open share. Please tap Share again.')
        }
      }
      return
    }

    setBusy(true)
    let files
    try {
      files = await prepareFiles(actionItems, property.id)
    } catch (error) {
      console.error('Could not prepare files:', error)
      setNotice(error.message || 'Files could not be prepared. Please try again.')
      setBusy(false)
      return
    }
    setBusy(false)

    if (!navigator.canShare({ files })) {
      setNotice('This browser cannot share these files directly. Please use Download instead.')
      return
    }

    if (!isIOSDevice()) {
      try {
        await navigator.share({ files })
        return
      } catch (error) {
        if (error?.name === 'AbortError') return
      }
    }

    setReady({ sig, files })
    setNotice(`${files.length} file(s) are ready. Tap Share once more to choose WhatsApp or any app.`)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="details-modal" onClick={e => e.stopPropagation()}>
        <div className="form-heading">
          <div>
            <p className="eyebrow">PROPERTY DETAILS</p>
            <h2>#{property.id}</h2>
            <p>{property.sector} · {typeLabel(property)}</p>
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="details-grid">
          <div><small>Monthly Rent</small><strong>{getUnits(property).length > 1
            ? getUnits(property).map((u, i) => <span key={i} style={{ display: 'block' }}>{u.type} · {formatRent(u.rent)}</span>)
            : formatRent(property.rent)}</strong></div>
          <div><small>Caretaker</small><strong>{property.caretaker || 'Not added'}</strong></div>
          <div><small>Phone</small><strong>{property.phone ? <a href={phoneHref(property.phone)}>{property.phone} · Call</a> : 'Not added'}</strong></div>
        </div>

        {property.location && <p className="detail-line"><strong>Address:</strong> {property.location}</p>}
        {property.details && <p className="detail-line"><strong>Details:</strong> {property.details}</p>}

        <div className="gallery-heading">
          <div>
            <h3>{currentFolder && folders.length > 1 ? currentFolder.title : 'Photos & Videos'}</h3>
            <p>{currentFolder ? `${currentFolder.items.length} files` : `${totalFiles} files in ${folders.length} folders`}</p>
          </div>
          {currentFolder && folders.length > 1 && (
            <button className="cancel-button" onClick={() => openFolderById(null)}>← All folders</button>
          )}
        </div>

        {visibleItems.length > 0 && (
          <div className="gallery-actions">
            {!showOverview && (
              <button className="cancel-button" onClick={toggleSelectMode}>{selectMode ? 'Done' : 'Select'}</button>
            )}
            {selectMode && !showOverview && (
              <>
                <button className="cancel-button" onClick={() => setSelectedMedia(selectedVisible.length === visibleItems.length ? [] : visibleItems.map(i => i.url))}>
                  Select All / None
                </button>
                <span>{selectedVisible.length} selected</span>
              </>
            )}
            <button className="add-button" onClick={handleDownload} disabled={busy}>⬇ Download {countLabel}</button>
            {canShare && (
              <button className="add-button" onClick={handleShare} disabled={busy}>
                {busy ? 'Please wait…' : readyNow ? `↗ Tap to Share (${actionItems.length})` : `↗ Share ${countLabel}`}
              </button>
            )}
            {isAdmin && selectMode && !showOverview && (
              <button className="cancel-button" onClick={onRemoveSelected} disabled={!selectedVisible.length}>Delete Selected</button>
            )}
          </div>
        )}
        {notice && <p className="detail-line" role="status">{notice}</p>}

        {showOverview ? (
          <div className="folder-grid">
            {folders.map(folder => {
              const cover = folder.items.find(i => !isVideo(i.url))
              return (
                <button key={folder.id} className="folder-card" onClick={() => openFolderById(folder.id)}>
                  <span className="folder-cover">
                    {cover ? <img src={thumb(cover.url, 420)} alt={folder.title} loading="lazy" decoding="async" /> : <span className="folder-icon">🎬</span>}
                    <b>{folder.items.length}</b>
                  </span>
                  <span className="folder-name">{folder.title}</span>
                  <small>{folder.items.length} files</small>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="media-gallery">
            {visibleItems.map(item => {
              const checked = selectedMedia.includes(item.url)
              const photoItems = visibleItems.filter(i => !isVideo(i.url))
              return (
                <div className={`gallery-item ${selectMode && checked ? 'is-selected' : ''}`} key={item.url}>
                  {selectMode && (
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedMedia(prev => prev.includes(item.url) ? prev.filter(x => x !== item.url) : [...prev, item.url])}
                      />
                      Select
                    </label>
                  )}

                  {isVideo(item.url)
                    ? <video src={item.url} controls preload="metadata" />
                    : (
                      <button
                        className="gallery-image-button"
                        onClick={() => onPreview(
                          photoItems.map(i => ({ url: i.url, propertyId: property.id, label: i.label, folder: i.folder })),
                          photoItems.findIndex(i => i.url === item.url)
                        )}
                      >
                        <img src={thumb(item.url, 420)} alt={item.label || 'Property photo'} loading="lazy" decoding="async" />
                        <span>View photo</span>
                      </button>
                    )}

                  {item.label && <p className="media-caption">{item.label}</p>}

                  {isAdmin && (
                    <div className="media-management-actions">
                      <label className="replace-media-button">
                        Replace
                        <input
                          type="file"
                          accept="image/*,video/*"
                          hidden
                          onChange={e => {
                            onReplace(item.url, e.target.files?.[0])
                            e.target.value = ''
                          }}
                        />
                      </label>
                      <button className="media-delete-button" onClick={() => onRemoveOne(item.url)}>Delete</button>
                    </div>
                  )}

                  <a className="media-download" href={item.url} target="_blank" rel="noreferrer">Open</a>
                </div>
              )
            })}
          </div>
        )}

        <div className="details-actions">
          <button className="add-button" onClick={copyPropertyDetails}>Copy Details</button>

          {isAdmin && (
            <>
              <button className="add-button" onClick={() => onEdit(property)}>Edit Property</button>
              <button className="cancel-button" onClick={() => onDuplicate(property)}>Duplicate</button>
              <button className="cancel-button" onClick={() => onDelete(property)}>Delete Property</button>
            </>
          )}

          {property.phone && <a className="add-button" href={phoneHref(property.phone)}>Call Caretaker</a>}

          {property.map && <a className="action-link" href={property.map} target="_blank" rel="noreferrer">Open Map ↗</a>}

          <button className="cancel-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function ImagePreview({ images, initialIndex = 0, onClose }) {
  const [index, setIndex] = useState(initialIndex)
  const touchStartX = useState(null)
  const current = images[index]
  const move = (direction) => setIndex(prev => Math.max(0, Math.min(images.length - 1, prev + direction)))
  const handleTouchStart = (event) => { touchStartX[1](event.touches?.[0]?.clientX ?? null) }
  const handleTouchEnd = (event) => {
    if (touchStartX[0] == null) return
    const endX = event.changedTouches?.[0]?.clientX
    const delta = typeof endX === 'number' ? endX - touchStartX[0] : 0
    if (Math.abs(delta) >= 35) move(delta < 0 ? 1 : -1)
    touchStartX[1](null)
  }
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') move(1)
      if (event.key === 'ArrowLeft') move(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [images.length])

  if (!current) return null
  const caption = [`Property #${current.propertyId}`, current.folder && current.folder !== 'Photos & Videos' ? current.folder : '', current.label].filter(Boolean).join(' · ')
  return (
    <div className="image-preview-overlay" onClick={onClose} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <button className="preview-close" onClick={onClose}>×</button>
      <button className="preview-nav preview-prev" onClick={e => { e.stopPropagation(); move(-1) }} disabled={index === 0}>‹</button>
      <div className="preview-content" onClick={e => e.stopPropagation()} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <img src={thumb(current.url, 1600)} alt={`Property ${current.propertyId} photo ${index + 1}`} />
        <p>{caption} · {index + 1} / {images.length}</p>
      </div>
      <button className="preview-nav preview-next" onClick={e => { e.stopPropagation(); move(1) }} disabled={index === images.length - 1}>›</button>
    </div>
  )
}

function PropertyToursPanel({ tours, isAdmin, onUpload, onDelete, uploading }) {
  const [propertyNumber, setPropertyNumber] = useState('')
  const [sector, setSector] = useState('')
  const [files, setFiles] = useState([])
  const [busyShare, setBusyShare] = useState('')
  const [readyShare, setReadyShare] = useState(null)
  const [tourSearch, setTourSearch] = useState('')
  const filteredTours = tours.filter(tour => `${tour.property_number || ''} ${tour.sector || ''}`.toLowerCase().includes(tourSearch.trim().toLowerCase()))

  const downloadOne = async (url, propertyNumber, index) => {
    try {
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) throw new Error('Download unavailable')
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `Property-${safeName(propertyNumber)}-Tour-${index + 1}.mp4`
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
    } catch (error) {
      alert('Could not download this video directly. Opening it so you can save it from the video menu.')
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const shareOne = async (url, title, propertyNumber, index) => {
    const shareKey = `${propertyNumber}-${index}`

    // Second tap: call the native share sheet immediately inside the tap event.
    // This is more reliable on iOS Safari, which can lose user activation while a
    // video is being fetched.
    if (readyShare?.key === shareKey) {
      try {
        if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: [readyShare.file] })) {
          alert('This browser cannot share video files directly. Please use Download and attach the video manually.')
          return
        }
        await navigator.share({ files: [readyShare.file], title: readyShare.title })
        setReadyShare(null)
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error('Video share failed:', error)
          alert('Could not share the video file. Please try again or use Download.')
        }
      }
      return
    }

    try {
      if (!navigator.share || !navigator.canShare) {
        alert('This browser does not support sharing video files. Please use Download and attach the video in your sharing app.')
        return
      }

      setBusyShare(shareKey)
      setReadyShare(null)
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) throw new Error('Video could not be fetched')
      const blob = await response.blob()
      const mimeType = blob.type && blob.type.startsWith('video/') ? blob.type : 'video/mp4'
      const videoFile = new File([blob], `Property-${safeName(propertyNumber)}-Tour-${index + 1}.mp4`, { type: mimeType })

      if (!navigator.canShare({ files: [videoFile] })) {
        alert('Your browser or device cannot share this video file directly. Please use Download and attach the video manually.')
        return
      }

      setReadyShare({ key: shareKey, file: videoFile, title })
      alert('Video is ready. Tap Share Video once more to open the iPhone/phone share menu.')
    } catch (error) {
      console.error('Video preparation failed:', error)
      alert('Could not prepare this video for sharing. Please try Download and share the saved video.')
    } finally {
      setBusyShare('')
    }
  }

  return (
    <div className="property-section property-tours-section">
      <div className="section-heading">
        <div><h2>Property Tours</h2><p>Watch, download or share property tour videos.</p></div>
        <span className="count">{tours.length} property tours</span>
      </div>

      <div className="tour-search-wrap">
        <input className="tour-search-input" type="search" value={tourSearch} onChange={e => setTourSearch(e.target.value)} placeholder="Search by sector or property number..." aria-label="Search tours by sector or property number" />
      </div>

      {isAdmin && (
        <form className="tour-upload-form" onSubmit={async e => {
          e.preventDefault()
          if (!propertyNumber.trim() || !sector.trim() || !files.length) return alert('Enter property number, sector and select at least one video.')
          await onUpload({ propertyNumber: propertyNumber.trim(), sector: sector.trim(), files })
          setPropertyNumber(''); setSector(''); setFiles([])
          e.target.reset()
        }}>
          <div className="tour-upload-heading"><strong>Upload New Tour</strong><small>Only property number, sector and video files are required.</small></div>
          <div className="tour-upload-fields">
            <label>Property Number<input value={propertyNumber} onChange={e => setPropertyNumber(e.target.value)} placeholder="e.g. 204" required /></label>
            <label>Sector<input value={sector} onChange={e => setSector(e.target.value)} placeholder="e.g. Sector 39" required /></label>
            <label className="tour-file-field">Tour Videos<input type="file" accept="video/*" multiple onChange={e => setFiles(Array.from(e.target.files || []))} required /><small>{files.length} video(s) selected</small></label>
          </div>
          <button className="add-button" type="submit" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload Property Tour'}</button>
        </form>
      )}

      {filteredTours.length ? <div className="property-tour-grid">
        {filteredTours.map(tour => <article className="property-tour-card" key={tour.id}>
          <div className="property-tour-title"><span>{tour.sector || 'Sector'}</span><h3>Property #{tour.property_number}</h3></div>
          <div className="property-tour-videos">
            {(tour.media_urls || []).map((url, index) => <div className="property-tour-video" key={`${url}-${index}`}>
              <video src={url} controls playsInline preload="metadata" />
              <div className="property-tour-actions">
                <button className="cancel-button" type="button" onClick={() => downloadOne(url, tour.property_number, index)}>Download</button>
                <button className="cancel-button" type="button" disabled={busyShare === `${tour.property_number}-${index}`} onClick={() => shareOne(url, `Property ${tour.property_number} - ${tour.sector}`, tour.property_number, index)}>{busyShare === `${tour.property_number}-${index}` ? 'Preparing…' : readyShare?.key === `${tour.property_number}-${index}` ? 'Tap again to Share' : 'Share Video'}</button>
              </div>
            </div>)}
          </div>
          {isAdmin && <button className="tour-delete-button" type="button" onClick={() => onDelete(tour)}>Delete Tour</button>}
        </article>)}
      </div> : <div className="tour-empty-state">{tours.length ? 'No tours match your search.' : 'No property tours uploaded yet.'}</div>}
      <p className="tour-download-note">Videos can be downloaded or shared one at a time. Bulk download is not available.</p>
    </div>
  )
}

/* ---------------------------------------------------------------
   Main App
---------------------------------------------------------------- */
function App() {
  // Auth
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [companyId, setCompanyId] = useState(null)
  const [companyInfo, setCompanyInfo] = useState(null)
  const [companies, setCompanies] = useState([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [newCompany, setNewCompany] = useState({ name: '', slug: '' })
  const [companySettings, setCompanySettings] = useState({ name: '', logo_url: '', theme_color: '#b08d57', text_color: '#ffffff' })
  const [companySearch, setCompanySearch] = useState('')
  const [adminSearch, setAdminSearch] = useState('')
  const [roleChecked, setRoleChecked] = useState(false)
  const [loading, setLoading] = useState(!isPublic || isClientShare)
  const [listLoading, setListLoading] = useState(true)
  const [email, setEmail] = useState('')

  // Data
  const [properties, setProperties] = useState([])
  const [propertyTours, setPropertyTours] = useState([])
  const [clientShareProperties, setClientShareProperties] = useState([])
  const [clientShareError, setClientShareError] = useState('')
  const [brokerDisplayName, setBrokerDisplayName] = useState(() => {
    try { return window.localStorage.getItem('propertyhub_broker_display_name') || '' } catch { return '' }
  })
  const [tourUploading, setTourUploading] = useState(false)
  const [admins, setAdmins] = useState([])
  const [adminEmail, setAdminEmail] = useState('')

  // List controls
  const [filters, setFilters] = useState(emptyFilters)
  const [itemsPerPage, setItemsPerPage] = useState(PAGE_SIZES[0])
  const [currentPage, setCurrentPage] = useState(1)
  const [activeTab, setActiveTab] = useState('All Properties')

  // Form & modals
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [media, setMedia] = useState([])
  const [uploadGroups, setUploadGroups] = useState([])
  const [copyQuery, setCopyQuery] = useState('')
  const [units, setUnits] = useState([{ type: '1RK', rent: '' }])
  const [editingExistingMedia, setEditingExistingMedia] = useState([])
  const [saving, setSaving] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState(null)
  const [previewMedia, setPreviewMedia] = useState(null)
  const [editingProperty, setEditingProperty] = useState(false)
  const [editingOriginalId, setEditingOriginalId] = useState(null)
  const [selectedMedia, setSelectedMedia] = useState([])

  const isAdmin = role === 'admin' || role === 'super_admin'
  const isSuperAdmin = role === 'super_admin'
  const activeCompanyId = isSuperAdmin ? selectedCompanyId : companyId
  const userId = session?.user?.id

  const setFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }))
  const resetFilters = () => setFilters(emptyFilters)

  /* ---------- Auth session ---------- */
  useEffect(() => {
    if (isPublic) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => setSession(newSession)
    )

    return () => listener.subscription.unsubscribe()
  }, [])

  /* ---------- Load role ---------- */
  useEffect(() => {
    if (!userId) {
      setRole(null)
      setCompanyId(null)
      setRoleChecked(false)
      return
    }

    let active = true

    async function loadRole() {
      const { data, error } = await supabase
        .from('propertyhub_admins')
        .select('role,company_id,is_active')
        .eq('user_id', userId)
        .maybeSingle()

      if (!active) return

      setRole(error || !data || data.is_active === false ? null : data.role)
      setCompanyId(data?.company_id || null)
      setRoleChecked(true)
    }

    loadRole()
    return () => { active = false }
  }, [userId])

  /* ---------- Load company workspace ---------- */
  useEffect(() => {
    let active = true
    async function loadCompanies() {
      if (isPublic) {
        if (isClientShare) {
          const { data, error } = await supabase.rpc('get_client_shared_properties', { p_token: clientShareToken })
          if (!active) return
          if (error) {
            console.error('Client share could not be loaded:', error)
            setClientShareError('This property link is invalid or unavailable.')
            setClientShareProperties([])
          } else {
            setClientShareProperties(data || [])
            if (!(data || []).length) setClientShareError('No properties are available on this link.')
          }
          setLoading(false)
          setListLoading(false)
          return
        }
        if (!companySlug) { setLoading(false); setListLoading(false); return }
        // Company info and property list load at the same time (faster first paint)
        const [companyRes, propertiesRes, toursRes] = await Promise.all([
          supabase.rpc('get_public_company_by_slug', { company_slug: companySlug }),
          supabase.rpc('get_public_company_properties', { company_slug: companySlug }),
          supabase.rpc('get_public_company_tours', { p_company_slug: companySlug })
        ])
        if (!active) return
        if (companyRes.error || !companyRes.data) { console.error(companyRes.error); setProperties([]); setLoading(false); setListLoading(false); return }
        setCompanyInfo(companyRes.data)
        if (propertiesRes.error) console.error(propertiesRes.error)
        if (toursRes.error) console.error(toursRes.error)
        setProperties((propertiesRes.data || []).map(mapRow))
        setPropertyTours(toursRes.data || [])
        setLoading(false)
        setListLoading(false)
        return
      }
      if (!role) return
      if (isSuperAdmin) {
        const { data, error } = await supabase.from('companies').select('*').order('created_at', { ascending: true })
        if (!active) return
        if (error) { console.error(error); return }
        setCompanies(data || [])
        setSelectedCompanyId(prev => prev || data?.[0]?.id || '')
        if (!data?.length) setListLoading(false)
      } else if (companyId) {
        const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).single()
        if (!active) return
        if (error) console.error(error)
        setCompanyInfo(data || null)
        if (data) setCompanySettings({ name: data.name || '', logo_url: data.logo_url || '', theme_color: data.theme_color || '#b08d57', text_color: data.text_color || '#ffffff' })
      }
    }
    loadCompanies()
    return () => { active = false }
  }, [role, companyId, isSuperAdmin, isPublic, companySlug])

  /* ---------- Load properties for the active company ---------- */
  useEffect(() => {
    if (isPublic) return
    if (!role || !activeCompanyId) { setProperties([]); return }
    let active = true
    async function loadProperties() {
      setListLoading(true)
      const { data, error } = await supabase.from('properties').select('*').eq('company_id', activeCompanyId).order('created_at', { ascending: false })
      if (!active) return
      setListLoading(false)
      if (error) { console.error(error); return }
      setProperties((data || []).map(mapRow))
    }
    loadProperties()
    return () => { active = false }
  }, [role, activeCompanyId, isPublic])

  /* ---------- Load property tours for the active company ---------- */
  useEffect(() => {
    if (isPublic || !role || !activeCompanyId) return
    let active = true
    supabase.from('property_tours').select('*').eq('company_id', activeCompanyId).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return
        if (error) console.error('Could not load property tours:', error)
        else setPropertyTours(data || [])
      })
    return () => { active = false }
  }, [role, activeCompanyId, isPublic])

  /* ---------- Load admins for the active company ---------- */
  useEffect(() => {
    if (!isAdmin || !activeCompanyId) { setAdmins([]); return }
    let active = true
    async function loadAdmins() {
      const { data, error } = await supabase
        .from('propertyhub_admins')
        .select('user_id,email,role,company_id,created_at,is_active')
        .eq('company_id', activeCompanyId)
        .order('created_at', { ascending: true })
      if (!active) return
      if (error) console.error(error)
      else setAdmins(data || [])
    }
    loadAdmins()
    return () => { active = false }
  }, [isAdmin, activeCompanyId])

  useEffect(() => {
    if (!isSuperAdmin || !selectedCompanyId) return
    const selected = companies.find(c => c.id === selectedCompanyId)
    if (selected) setCompanySettings({ name: selected.name || '', logo_url: selected.logo_url || '', theme_color: selected.theme_color || '#b08d57', text_color: selected.text_color || '#ffffff' })
  }, [selectedCompanyId, companies, isSuperAdmin])

  /* ---------- Go back to page 1 when filters change ---------- */
  useEffect(() => {
    setCurrentPage(1)
  }, [filters, itemsPerPage])

  /* ---------- Filtering, sorting, pagination ---------- */
  const sectors = useMemo(
    () => [...new Set(properties.map(p => p.sector).filter(Boolean))].sort(),
    [properties]
  )

  const sorted = useMemo(() => {
    const q = filters.search.trim().toLowerCase()

    const filtered = properties.filter(p => {
      const matchesSearch = !q || [p.id, p.caretaker].some(value => String(value || '').toLowerCase().includes(q))

      return matchesSearch &&
        (filters.type === 'All' || getUnits(p).some(u => u.type === filters.type)) &&
        (filters.sector === 'All' || p.sector === filters.sector)
    })

    return [...filtered].sort((a, b) => {
      // "Newest First" really is newest first now; Sector (A-Z) is its own option.
      if (filters.sort === 'default') return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      if (filters.sort === 'sector') return String(a.sector || '').localeCompare(String(b.sector || ''), undefined, { numeric: true, sensitivity: 'base' })
      if (filters.sort === 'rent-low') return a.rent - b.rent
      if (filters.sort === 'rent-high') return b.rent - a.rent
      if (filters.sort === 'type') {
        const ai = PROPERTY_TYPES.indexOf(getUnits(a)[0].type)
        const bi = PROPERTY_TYPES.indexOf(getUnits(b)[0].type)
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      }
      return 0
    })
  }, [properties, filters])

  const totalPages = Math.max(1, Math.ceil(sorted.length / itemsPerPage))
  const safePage = Math.min(currentPage, totalPages)

  const paginatedProperties = sorted.slice(
    (safePage - 1) * itemsPerPage,
    safePage * itemsPerPage
  )

  const recentProperties = properties.slice(0, 5)

  /* ---------- Auth actions ---------- */
  const login = async (e) => {
    e.preventDefault()

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin }
    })

    if (error) return alert('Could not send login link: ' + error.message)

    alert('Login link sent! Check your email and click the link.')
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setRole(null)
    setRoleChecked(false)
    setProperties([])
    setActiveTab('All Properties')
  }

  /* ---------- Admin management ---------- */
  const refreshAdmins = async () => {
    if (!isAdmin || !activeCompanyId) return
    const { data, error } = await supabase
      .from('propertyhub_admins')
      .select('user_id,email,role,company_id,created_at,is_active')
      .eq('company_id', activeCompanyId)
      .order('created_at', { ascending: true })

    if (error) return console.error(error)
    setAdmins(data || [])
  }

  const addAdmin = async (e) => {
    e.preventDefault()

    const inviteEmail = adminEmail.trim()
    if (!inviteEmail) return
    const selectedCompany = isSuperAdmin
      ? companies.find(c => c.id === activeCompanyId)
      : companyInfo
    if (!activeCompanyId || selectedCompany?.is_active === false) return alert('Select an active company before adding an admin.')

    const { data: { session: currentSession } } = await supabase.auth.getSession()

    if (!currentSession) return alert('Please login again.')

    const { data, error } = await supabase.functions.invoke('smooth-function', {
      body: { email: inviteEmail, company_id: activeCompanyId }
    })

    if (error || data?.error) {
      return alert('Could not send invitation: ' + (data?.error || error.message))
    }

    alert('Invitation sent successfully to ' + inviteEmail)
    setAdminEmail('')
    refreshAdmins()
  }

  const toggleCompanyAccess = async (company) => {
    if (!isSuperAdmin) return
    const nextActive = company.is_active === false
    const verb = nextActive ? 'restore' : 'put on hold'
    if (!window.confirm(`Are you sure you want to ${verb} ${company.name}? ${nextActive ? '' : 'Neither company admins nor public viewers will be able to access this company while it is on hold.'}`)) return
    const { data, error } = await supabase.from('companies').update({ is_active: nextActive }).eq('id', company.id).select('*').single()
    if (error) return alert('Could not update company status: ' + error.message)
    setCompanies(prev => prev.map(item => item.id === company.id ? data : item))
    if (company.id === selectedCompanyId && !nextActive) setProperties([])
    alert(nextActive ? 'Company access restored.' : 'Company put on hold. Admins and public viewers are blocked.')
  }

  // Permanently delete a company with its properties and admins (super admin only).
  const deleteCompany = async (company) => {
    if (!isSuperAdmin) return
    const typed = window.prompt(
      `This will PERMANENTLY delete "${company.name}" together with ALL its properties and admins. This cannot be undone.\n\nType the company name to confirm:`
    )
    if (typed === null) return
    if (typed.trim().toLowerCase() !== String(company.name || '').trim().toLowerCase()) {
      return alert('Name did not match. Company was not deleted.')
    }

    const { error: propertiesError } = await supabase.from('properties').delete().eq('company_id', company.id)
    if (propertiesError) return alert('Could not delete properties: ' + propertiesError.message)

    const { error: adminsError } = await supabase
      .from('propertyhub_admins')
      .delete()
      .eq('company_id', company.id)
      .neq('role', 'super_admin')
    if (adminsError) return alert('Could not delete company admins: ' + adminsError.message)

    const { data: removed, error: companyError } = await supabase
      .from('companies')
      .delete()
      .eq('id', company.id)
      .select('id')
    if (companyError) return alert('Could not delete company: ' + companyError.message)
    if (!removed?.length) return alert('Company was not deleted. The database blocked it (check the delete permission for super admin).')

    const remaining = companies.filter(c => c.id !== company.id)
    setCompanies(remaining)
    if (selectedCompanyId === company.id) {
      setSelectedCompanyId(remaining[0]?.id || '')
      setProperties([])
    }
    alert('Company deleted.')
  }

  const toggleAdminAccess = async (admin) => {
    if (!isAdmin || admin.role === 'super_admin' || admin.user_id === userId) return
    const nextActive = admin.is_active === false
    const action = nextActive ? 'restore access for' : 'put on hold'
    if (!window.confirm(`Are you sure you want to ${action} ${admin.email}?`)) return
    const { error } = await supabase.from('propertyhub_admins')
      .update({ is_active: nextActive })
      .eq('user_id', admin.user_id)
      .eq('company_id', activeCompanyId)
    if (error) return alert('Could not update admin access: ' + error.message)
    setAdmins(prev => prev.map(item => item.user_id === admin.user_id ? { ...item, is_active: nextActive } : item))
    alert(nextActive ? 'Admin access restored.' : 'Admin access put on hold.')
  }

  const removeAdmin = async (admin) => {
    if (!isAdmin || admin.role === 'super_admin' || admin.user_id === userId) return
    if (!window.confirm(`Are you sure you want to remove ${admin.email}?`)) return

    const { error } = await supabase
      .from('propertyhub_admins')
      .delete()
      .eq('user_id', admin.user_id)
      .eq('company_id', activeCompanyId)

    if (error) return alert('Could not remove admin: ' + error.message)

    setAdmins(prev => prev.filter(item => item.user_id !== admin.user_id))
    alert('Admin removed successfully.')
  }

  /* ---------- Client-safe property sharing ---------- */
  const shareClientLink = async (propertyId = null) => {
    const slug = companyInfo?.slug || (isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.slug : '')
    if (!slug) return alert('Company link is not ready. Please refresh and try again.')
    try {
      const displayName = brokerDisplayName.trim()
      if (!displayName) return alert('Please enter your name in the top-right field before sharing.')
      try { window.localStorage.setItem('propertyhub_broker_display_name', displayName) } catch {}
      const { data: token, error } = await supabase.rpc('create_client_property_share', {
        p_company_slug: slug,
        p_property_id: propertyId || null,
        p_broker_name: displayName
      })
      if (error) throw error
      if (!token) throw new Error('No share token was returned.')
      const link = `${window.location.origin}/?client=${encodeURIComponent(token)}`
      if (navigator.share) {
        try {
          await navigator.share({ title: propertyId ? 'Property Details' : 'Available Properties', text: 'View property photos, videos, sector and rent.', url: link })
          return
        } catch (shareError) {
          if (shareError?.name === 'AbortError') return
        }
      }
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(link)
        alert('Client-safe share link copied. Only photos, videos, sector and rent are visible on this link.')
      } else {
        window.prompt('Copy this client-safe share link:', link)
      }
    } catch (error) {
      console.error('Could not create client share link:', error)
      alert('Could not create share link: ' + (error?.message || 'Please try again.'))
    }
  }

  /* ---------- Property form ---------- */
  const sharePublicLink = async () => {
    const slug = (isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.slug : companyInfo?.slug)
    if (!slug) return alert('Select a company first.')
    const link = `${window.location.origin}/?public=1&company=${encodeURIComponent(slug)}`

    try {
      await navigator.clipboard.writeText(link)
      alert('Public link copied: ' + link)
    } catch {
      window.prompt('Copy this public link:', link)
    }
  }

  const updateForm = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const resetFormState = () => {
    setMedia([])
    setUploadGroups([])
    setCopyQuery('')
    setUnits([{ type: '1RK', rent: '' }])
    setEditingExistingMedia([])
  }

  const openAddForm = () => {
    setForm(emptyForm)
    resetFormState()
    setEditingProperty(false)
    setEditingOriginalId(null)
    setShowForm(true)
  }

  // New listing pre-filled from an existing one (property number and photos stay empty)
  const openDuplicateForm = (property) => {
    setForm({
      ...emptyForm,
      sector: property.sector || '',
      location: property.location || '',
      type: property.type || '1RK',
      rent: property.rent || '',
      caretaker: property.caretaker || '',
      phone: property.phone || '',
      map: property.map || '',
      details: property.details || ''
    })
    resetFormState()
    setUnits(getUnits(property).map(u => ({ type: u.type, rent: u.rent })))
    setEditingProperty(false)
    setEditingOriginalId(null)
    setSelectedProperty(null)
    setSelectedMedia([])
    setShowForm(true)
  }

  const copyFromProperty = (value) => {
    setCopyQuery(value)
    const source = properties.find(p => `${p.id} · ${p.sector} · ${p.type}` === value)
    if (!source) return
    setUnits(getUnits(source).map(u => ({ type: u.type, rent: u.rent })))
    setForm(prev => ({
      ...prev,
      sector: source.sector || '',
      location: source.location || '',
      type: source.type || '1RK',
      rent: source.rent || '',
      caretaker: source.caretaker || '',
      phone: source.phone || '',
      map: source.map || '',
      details: source.details || ''
    }))
  }

  const openEditForm = (property) => {
    setForm({
      id: property.id,
      rowId: property.rowId,
      sector: property.sector || '',
      location: property.location || '',
      type: property.type || '1RK',
      rent: property.rent || '',
      caretaker: property.caretaker || '',
      phone: property.phone || '',
      map: property.map || '',
      details: property.details || ''
    })

    resetFormState()
    setUnits(getUnits(property).map(u => ({ type: u.type, rent: u.rent })))
    setEditingOriginalId(property.rowId)
    setEditingProperty(true)
    setEditingExistingMedia(property.media_urls || [])
    setSelectedProperty(null)
    setSelectedMedia([])
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingProperty(false)
    setEditingOriginalId(null)
    setForm(emptyForm)
    resetFormState()
  }

  const addUploadGroup = (kind) => setUploadGroups(prev => [...prev, { key: `g${Date.now()}${prev.length}`, kind, rooms: '', custom: '', files: [] }])
  const patchUploadGroup = (key, patch) => setUploadGroups(prev => prev.map(g => g.key === key ? { ...g, ...patch } : g))
  const removeUploadGroup = (key) => setUploadGroups(prev => prev.filter(g => g.key !== key))

  const viewProperty = (property) => {
    setSelectedMedia([])
    setSelectedProperty(property)
  }

  const closeDetails = () => {
    setSelectedProperty(null)
    setSelectedMedia([])
  }

  const addProperty = async (e) => {
    e.preventDefault()
    if (!isAdmin || saving) return
    if (!activeCompanyId) return alert('Select a company before adding a property.')
    const newId = form.id.trim()
    if (!newId) return alert('Property number is required.')
    if (!units.length || units.some(u => String(u.rent).trim() === '' || Number.isNaN(Number(u.rent)))) return alert('Enter the rent for every property type.')
    const cleanUnits = units.map(u => ({ type: u.type, rent: Number(u.rent) }))

    setSaving(true)

    try {
      const existing = editingProperty
        ? properties.find(p => p.rowId === editingOriginalId)
        : null

      const uploadGroupFiles = (group) => Promise.all(
        group.files.map(async file => ({ url: await uploadToCloudinary(file), label: fileLabel(file.name) }))
      )

      const [uploadedGeneral, groupResults] = await Promise.all([
        Promise.all(media.map(file => uploadToCloudinary(file))),
        Promise.all(uploadGroups.filter(g => g.files.length).map(async group => ({ group, items: await uploadGroupFiles(group) })))
      ])

      // Merge new photos into the folders this property already has (same folder name = same folder)
      const keepUrls = new Set(editingExistingMedia)
      const sections = (existing?.media_sections || [])
        .map(s => ({ ...s, items: (s.items || []).filter(item => keepUrls.has(item.url)) }))
        .filter(s => s.items.length)
      for (const { group, items } of groupResults) {
        const title = folderTitle(group.kind, group.rooms, group.custom)
        let section = sections.find(s => String(s.title).toLowerCase() === title.toLowerCase())
        if (!section) {
          section = { id: `f${Date.now()}${sections.length}`, title, kind: group.kind, items: [] }
          sections.push(section)
        }
        section.items.push(...items)
      }
      const order = (s) => { const i = FOLDER_KINDS.indexOf(s.kind); return i === -1 ? 99 : i }
      sections.sort((a, b) => order(a) - order(b))

      const allMediaUrls = [
        ...(editingProperty ? editingExistingMedia : []),
        ...uploadedGeneral,
        ...groupResults.flatMap(r => r.items.map(i => i.url))
      ]

      const legacySpecial = existing?.special_videos || []

      const propertyData = {
        company_id: activeCompanyId,
        property_number: newId,
        sector: form.sector.trim(),
        location: form.location,
        property_type: cleanUnits.map(u => u.type).join(' + '),
        rent: Math.min(...cleanUnits.map(u => u.rent)),
        caretaker_name: form.caretaker,
        caretaker_phone: form.phone,
        map_link: form.map,
        details: form.details,
        media_urls: allMediaUrls,
        special_videos: buildSpecial(legacySpecial, cleanUnits, sections),
        ...(editingProperty ? {} : { status: 'Available' })
      }

      const uiRow = {
        id: newId,
        rowId: existing?.rowId,
        createdAt: existing?.createdAt || new Date().toISOString(),
        sector: propertyData.sector,
        location: form.location,
        type: cleanUnits.map(u => u.type).join(' + '),
        rent: Math.min(...cleanUnits.map(u => u.rent)),
        units: cleanUnits.length > 1 ? cleanUnits : [],
        caretaker: form.caretaker,
        phone: form.phone,
        map: form.map,
        details: form.details,
        media_urls: allMediaUrls,
        media_sections: sections,
        special_videos: legacySpecial
      }

      if (editingProperty) {
        const { error } = await supabase
          .from('properties')
          .update(propertyData)
          .eq('id', editingOriginalId)

        if (error) throw error

        setProperties(prev => prev.map(p => p.rowId === editingOriginalId ? uiRow : p))
        alert('Property updated successfully!')
      } else {
        const { data: inserted, error } = await supabase
          .from('properties')
          .insert([propertyData])
          .select('id')
          .single()

        if (error) throw error

        setProperties(prev => [{ ...uiRow, rowId: inserted.id }, ...prev])
        alert('Property saved successfully!')
      }

      closeForm()
      setActiveTab('All Properties')
    } catch (error) {
      alert('Error: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteProperty = async (property) => {
    if (!isAdmin) return
    if (!window.confirm(`Delete property ${property.id}?`)) return

    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', property.rowId)

    if (error) return alert('Delete failed: ' + error.message)

    setProperties(prev => prev.filter(p => p.rowId !== property.rowId))
    closeDetails()
    if (editingOriginalId === property.rowId) closeForm()
    alert('Property deleted.')
  }

  /* ---------- Gallery management ---------- */
  // Keeps the folders in sync when files are removed or replaced.
  const saveGallery = async (property, newUrls, replaced = {}) => {
    if (!isAdmin) return

    const keep = new Set(newUrls)
    const sections = (property.media_sections || [])
      .map(s => ({
        ...s,
        items: (s.items || [])
          .map(item => replaced[item.url] ? { ...item, url: replaced[item.url] } : item)
          .filter(item => keep.has(item.url))
      }))
      .filter(s => s.items.length)

    const { error } = await supabase
      .from('properties')
      .update({ media_urls: newUrls, special_videos: buildSpecial(property.special_videos, property.units, sections) })
      .eq('id', property.rowId)

    if (error) throw error

    const updated = { ...property, media_urls: newUrls, media_sections: sections }

    setProperties(prev => prev.map(p => p.rowId === property.rowId ? updated : p))
    setSelectedProperty(updated)
    setSelectedMedia([])
  }

  const removeOneMedia = async (url) => {
    if (!isAdmin || !selectedProperty) return
    if (!window.confirm('Remove this file from gallery?')) return

    try {
      await saveGallery(selectedProperty, selectedProperty.media_urls.filter(item => item !== url))
    } catch (error) {
      alert('Could not remove file: ' + error.message)
    }
  }

  const removeSelectedMedia = async () => {
    if (!isAdmin || !selectedProperty || !selectedMedia.length) return
    if (!window.confirm(`Remove ${selectedMedia.length} selected files?`)) return

    try {
      await saveGallery(
        selectedProperty,
        selectedProperty.media_urls.filter(url => !selectedMedia.includes(url))
      )
    } catch (error) {
      alert('Could not update gallery: ' + error.message)
    }
  }

  const replaceMedia = async (oldUrl, file) => {
    if (!isAdmin || !file || !selectedProperty) return
    if (!window.confirm('Replace this photo/video?')) return

    try {
      const newUrl = await uploadToCloudinary(file)
      const newUrls = selectedProperty.media_urls.map(url => url === oldUrl ? newUrl : url)
      await saveGallery(selectedProperty, newUrls, { [oldUrl]: newUrl })
      alert('Media replaced.')
    } catch (error) {
      alert('Replace failed: ' + error.message)
    }
  }

  /* ---------- Property tours ---------- */
  const uploadPropertyTour = async ({ propertyNumber, sector, files }) => {
    if (!isAdmin || !activeCompanyId || tourUploading) return
    setTourUploading(true)
    try {
      const mediaUrls = await Promise.all(files.map(file => uploadToCloudinary(file)))
      const { data, error } = await supabase.from('property_tours').insert({
        company_id: activeCompanyId,
        property_number: propertyNumber,
        sector,
        media_urls: mediaUrls
      }).select('*').single()
      if (error) throw error
      setPropertyTours(prev => [data, ...prev])
      alert('Property tour uploaded successfully.')
    } catch (error) {
      alert('Tour upload failed: ' + error.message)
    } finally {
      setTourUploading(false)
    }
  }

  const deletePropertyTour = async (tour) => {
    if (!isAdmin || !window.confirm(`Delete the tour for Property #${tour.property_number}?`)) return
    const { error } = await supabase.from('property_tours').delete().eq('id', tour.id)
    if (error) return alert('Could not delete tour: ' + error.message)
    setPropertyTours(prev => prev.filter(item => item.id !== tour.id))
  }

  /* ---------- Shared modal props ---------- */
  const detailsModal = selectedProperty && (
    <DetailsModal
      key={selectedProperty.rowId || selectedProperty.id}
      property={selectedProperty}
      isAdmin={isAdmin && !isPublic}
      onClose={closeDetails}
      onEdit={openEditForm}
      onDelete={deleteProperty}
      onDuplicate={openDuplicateForm}
      onPreview={(images, index) => setPreviewMedia({ images, index: Math.max(0, index) })}
      selectedMedia={selectedMedia}
      setSelectedMedia={setSelectedMedia}
      onRemoveOne={removeOneMedia}
      onRemoveSelected={removeSelectedMedia}
      onReplace={replaceMedia}
    />
  )

  const previewModal = previewMedia && (
    <ImagePreview images={previewMedia.images} initialIndex={previewMedia.index} onClose={() => setPreviewMedia(null)} />
  )

  const pagination = (
    <Pagination
      currentPage={safePage}
      totalPages={totalPages}
      setCurrentPage={setCurrentPage}
      itemsPerPage={itemsPerPage}
      setItemsPerPage={setItemsPerPage}
      total={sorted.length}
    />
  )

  /* ===============================================================
     Screens
  ================================================================ */

  // Loading (also covers the moment while the admin role is being checked)
  if (loading || (session && !roleChecked && !isPublic)) {
    return <div className="login-screen"><div className="lux-loader"><span className="lux-loader-ring" /><h2>PropertyHub</h2><p>Preparing your workspace…</p></div></div>
  }

  // Client-facing share page: the RPC returns only sector, rent and media URLs.
  if (isClientShare) {
    return (
      <div className="client-share-page">
        <main className="client-share-content">
          <div className="client-share-heading"><h1>{clientShareProperties.length === 1 ? 'Property by' : 'Properties by'} {clientShareProperties[0]?.broker_name || 'Broker'}</h1></div>
          {loading ? <p className="client-share-message">Loading properties…</p> : clientShareError ? <p className="client-share-message">{clientShareError}</p> : (
            <div className="client-share-grid">
              {clientShareProperties.map((property, index) => {
                const mediaItems = Array.isArray(property.media_urls) ? property.media_urls : []
                return (
                  <article className="client-share-card" key={`${property.sector || 'sector'}-${index}`}>
                    <div className="client-share-card-heading"><div><span>SECTOR</span><h2>{property.sector || 'Not specified'}</h2></div><strong>{formatRent(property.rent)}<small>/ month</small></strong></div>
                    {mediaItems.length ? <div className="client-share-media-grid">{mediaItems.map((url, mediaIndex) => isVideo(url)
                      ? <video key={`${url}-${mediaIndex}`} src={url} controls playsInline preload="metadata" />
                      : <img key={`${url}-${mediaIndex}`} src={thumb(url, 900)} alt={`Property photo ${mediaIndex + 1}`} loading="lazy" />
                    )}</div> : <p className="client-share-no-media">Photos and videos are not available.</p>}
                  </article>
                )
              })}
            </div>
          )}
        </main>
      </div>
    )
  }

  // Public read-only page
  if (isPublic) {
    return (
      <div className="app public-viewer-app" style={{ "--company-accent": companyInfo?.theme_color || "#b08d57", "--company-text": companyInfo?.text_color || "#ffffff" }}>
        <aside className="sidebar public-viewer-sidebar">
          <p className="menu-label">VIEWER</p>
          {['All Properties', 'Property Tours'].map(item => <button key={item} className={`nav-item ${activeTab === item ? 'active' : ''}`} onClick={() => setActiveTab(item)}>{item}</button>)}
        </aside>
        <main className="main" style={{ width: '100%' }}>
          <section className="content">
            <div className="public-client-share-toolbar">
              <div className="broker-share-name-field"><label htmlFor="broker-display-name">Your Name</label><input id="broker-display-name" type="text" value={brokerDisplayName} onChange={e => setBrokerDisplayName(e.target.value)} placeholder="Enter your name" maxLength={60} /></div>
              <button type="button" className="client-share-button client-share-all-button" onClick={() => shareClientLink(null)}>Share All Properties</button>
            </div>
            {activeTab === 'Property Tours' ? <>
              <div className="public-company-header">
                <div className="public-brand-lockup">{companyInfo?.logo_url ? <img src={companyInfo.logo_url} alt="Company logo" /> : <span className="public-brand-monogram">{(companyInfo?.name || 'P').slice(0,1)}</span>}<div className="public-brand-text"><h1>{companyInfo?.name || 'PROPERTY LISTINGS'}</h1></div></div>
                <span className="count">{properties.length} properties · {propertyTours.length} property tours</span>
              </div>
              <PropertyToursPanel tours={propertyTours} isAdmin={false} />
            </> : <>
            <div className="public-company-header">
              <div className="public-brand-lockup">{companyInfo?.logo_url ? <img src={companyInfo.logo_url} alt="Company logo" /> : <span className="public-brand-monogram">{(companyInfo?.name || 'P').slice(0,1)}</span>}<div className="public-brand-text"><h1>{companyInfo?.name || 'PROPERTY LISTINGS'}</h1></div></div>
              <div className="public-header-actions"><span className="count">{properties.length} properties</span></div>
            </div>

            <div className="property-section">
              <FilterBar filters={filters} setFilter={setFilter} onReset={resetFilters} sectors={sectors} />
              <PropertyTable rows={paginatedProperties} onView={viewProperty} onShareClient={shareClientLink} publicView loadingList={listLoading} />
              {pagination}
            </div>
            </>}

            {detailsModal}
            {previewModal}
            <footer className="app-footer">Contact Harsheet for Any Update · <a href="tel:7717463674">7717463674</a></footer>
          </section>
        </main>
      </div>
    )
  }

  // Login screen
  if (!session) {
    return (
      <div className="login-screen">
        <form className="property-form" onSubmit={login}>
          <div className="brand">
            <div className="brand-icon">P</div>
            <span>Property<span className="green">Hub</span></span>
          </div>

          <p className="eyebrow">PRIVATE ACCESS</p>
          <h2>Admin Login</h2>
          <p>Enter your admin email. We will send you a login link.</p>

          <label>Email Address
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </label>

          <button className="add-button" type="submit">Send Login Link</button>
        </form>
      </div>
    )
  }

  // Logged in but not an admin
  if (!role) {
    return (
      <div className="login-screen">
        <div className="property-form">
          <h2>Access not authorized</h2>
          <p>This account is not registered as a PropertyHub admin.</p>
          <button className="cancel-button" onClick={logout}>Logout</button>
        </div>
      </div>
    )
  }

  // Admin app
  const tabs = ['All Properties', 'Property Tours', 'Company Settings', ...(isSuperAdmin ? ['Manage Companies'] : []), 'Manage Admins']
  const editingFolders = editingProperty
    ? getFolders({ media_urls: editingExistingMedia, media_sections: properties.find(p => p.rowId === editingOriginalId)?.media_sections || [] })
    : []
  const pendingCount = media.length + uploadGroups.reduce((sum, g) => sum + g.files.length, 0)
  const removeExistingMedia = (url) => setEditingExistingMedia(prev => prev.filter(u => u !== url))

  return (
    <div className="app" style={{ "--company-accent": (isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.theme_color : companyInfo?.theme_color) || "#b08d57", "--company-text": (isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.text_color : companyInfo?.text_color) || "#ffffff" }}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">P</div>
          <span>Property<span className="green">Hub</span></span>
        </div>

        <p className="menu-label">WORKSPACE</p>

        {tabs.map(item => (
          <button
            key={item}
            className={`nav-item ${activeTab === item ? 'active' : ''}`}
            onClick={() => setActiveTab(item)}
          >
            {item}
          </button>
        ))}

        <div className="sidebar-bottom">
          <div className="company-card">
            {(isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.logo_url : companyInfo?.logo_url) ? <img className="company-logo" src={isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.logo_url : companyInfo?.logo_url} alt="Company logo" /> : <div className="company-icon">{((isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.name : companyInfo?.name) || 'P').slice(0, 1)}</div>}
            <div>
              <strong>{(isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.name : companyInfo?.name) || 'PropertyHub'}</strong>
              <small>{isSuperAdmin ? 'Super Admin' : 'Admin'}</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><span className="breadcrumb">Workspace / </span><strong>{activeTab}</strong></div>
          <div className="profile">
            <div className="avatar">{session.user.email?.[0]?.toUpperCase()}</div>
            <div><strong>{session.user.email}</strong><small>{role}</small></div>
            <button className="cancel-button" onClick={logout}>Logout</button>
          </div>
        </header>

        <section className="content">
          {activeTab === 'Property Tours' ? (
            <PropertyToursPanel tours={propertyTours} isAdmin={isAdmin} onUpload={uploadPropertyTour} onDelete={deletePropertyTour} uploading={tourUploading} />
          ) : activeTab === 'Manage Companies' && isSuperAdmin ? (
            <div className="property-section">
              <div className="section-heading"><div><h2>Manage Companies</h2><p>Create a separate workspace for each company.</p></div></div>
              <form className="search-box company-create-form" onSubmit={async e => { e.preventDefault(); const slug = newCompany.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); if (!slug) return alert('Enter a valid URL slug.'); const { data, error } = await supabase.from('companies').insert({ name: newCompany.name.trim(), slug }).select('*').single(); if (error) return alert('Could not create company: ' + error.message); setCompanies(prev => [...prev, data]); setSelectedCompanyId(data.id); setNewCompany({ name: '', slug: '' }); alert('Company created.'); }}>
                <input placeholder="Company name" value={newCompany.name} onChange={e => setNewCompany(p => ({ ...p, name: e.target.value }))} required />
                <input placeholder="Public URL slug (e.g. fnf-properties)" value={newCompany.slug} onChange={e => setNewCompany(p => ({ ...p, slug: e.target.value }))} required />
                <button className="add-button">+ Create Company</button>
              </form>
              <input className="company-search-input" value={companySearch} onChange={e => setCompanySearch(e.target.value)} placeholder="Search company by name or URL slug..." />
              <div className="table-wrap"><table><thead><tr><th>COMPANY</th><th>STATUS</th><th>PUBLIC LISTING</th><th>OPEN WORKSPACE</th><th>ACTION</th></tr></thead><tbody>{companies.filter(c => `${c.name} ${c.slug}`.toLowerCase().includes(companySearch.toLowerCase())).map(c => <tr key={c.id}><td>{c.name}</td><td><span className={`status-badge ${c.is_active === false ? 'status-on-hold' : 'status-available'}`}>{c.is_active === false ? 'On Hold' : 'Active'}</span></td><td>{c.is_active === false ? 'Unavailable while on hold' : <a href={`/?public=1&company=${c.slug}`} target="_blank" rel="noreferrer">Open listing ↗</a>}</td><td><button className="action-link" onClick={() => { setSelectedCompanyId(c.id); setActiveTab('All Properties'); }}>Manage</button></td><td><div className="admin-actions"><button className="cancel-button" onClick={() => toggleCompanyAccess(c)}>{c.is_active === false ? 'Restore Company' : 'Hold Company'}</button><button className="cancel-button danger-button" onClick={() => deleteCompany(c)}>Delete Company</button></div></td></tr>)}{!companies.some(c => `${c.name} ${c.slug}`.toLowerCase().includes(companySearch.toLowerCase())) && <tr><td colSpan="5">No company found.</td></tr>}</tbody></table></div>
            </div>
          ) : activeTab === 'Company Settings' ? (
            <div className="property-section company-settings">
              <div className="section-heading"><div><h2>Company Settings</h2><p>Update your company identity and public listing appearance.</p></div></div>
              <form className="property-form settings-form" onSubmit={async e => { e.preventDefault(); const targetId = isSuperAdmin ? activeCompanyId : companyId; if (!targetId) return alert('Select a company first.'); const { data, error } = await supabase.from('companies').update(companySettings).eq('id', targetId).select('*').single(); if (error) return alert('Update failed: ' + error.message); setCompanyInfo(data); if (isSuperAdmin) setCompanies(prev => prev.map(c => c.id === data.id ? data : c)); alert('Company settings updated.'); }}>
                {isSuperAdmin && <label>Select Company<select value={activeCompanyId || ''} onChange={e => { setSelectedCompanyId(e.target.value); const c = companies.find(x => x.id === e.target.value); if (c) setCompanySettings({ name: c.name, logo_url: c.logo_url || '', theme_color: c.theme_color || '#b08d57', text_color: c.text_color || '#ffffff' }); }}>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
                <label>Company Name<input value={companySettings.name} onChange={e => setCompanySettings(p => ({ ...p, name: e.target.value }))} required /></label>
                <label>Logo URL<input type="url" value={companySettings.logo_url} onChange={e => setCompanySettings(p => ({ ...p, logo_url: e.target.value }))} placeholder="https://..." /></label>
                <div className="settings-colour-row"><label>Brand / Accent Colour<input type="color" value={companySettings.theme_color} onChange={e => setCompanySettings(p => ({ ...p, theme_color: e.target.value }))} /><small>Buttons, highlights and brand elements</small></label><label>Accent Text Colour<input type="color" value={companySettings.text_color} onChange={e => setCompanySettings(p => ({ ...p, text_color: e.target.value }))} /><small>Text on accent surfaces</small></label></div>
                <button className="add-button">Save Company Settings</button>
              </form>
            </div>
          ) : activeTab === 'Manage Admins' && isAdmin ? (
            <div className="property-section">
              <div className="section-heading">
                <div><h2>Manage Admins</h2><p>{isSuperAdmin ? 'Admins are shown only for the selected company.' : 'Manage admin access for your company.'}</p></div>
              </div>

              {isSuperAdmin && <div className="admin-company-filter"><label>Selected Company<select value={selectedCompanyId} onChange={e => setSelectedCompanyId(e.target.value)}>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>}
              <form className="search-box" onSubmit={addAdmin}>
                <input
                  type="email"
                  placeholder="Enter new admin email address"
                  value={adminEmail}
                  onChange={e => setAdminEmail(e.target.value)}
                  required
                />
                <button className="add-button" type="submit">+ Add Admin</button>
              </form>

              <input className="company-search-input admin-search-input" value={adminSearch} onChange={e => setAdminSearch(e.target.value)} placeholder="Search admin by email..." />

              <p className="subheading">
                An invitation will be sent by email. The admin logs in with the link, no password needed.
              </p>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>EMAIL</th><th>ROLE</th><th>ACCESS</th><th>ACTION</th></tr></thead>
                  <tbody>
                    {admins.filter(admin => (admin.email || '').toLowerCase().includes(adminSearch.toLowerCase())).map(admin => (
                      <tr key={admin.user_id}>
                        <td>{admin.email}</td>
                        <td>{admin.role}</td>
                        <td><span className={`status-badge ${admin.is_active === false ? 'status-on-hold' : 'status-available'}`}>{admin.is_active === false ? 'On Hold' : 'Active'}</span></td>
                        <td>
                          {admin.role !== 'super_admin' && (
                            <div className="admin-actions">
                              {admin.user_id !== userId && <>
                                <button className="cancel-button" onClick={() => toggleAdminAccess(admin)}>{admin.is_active === false ? 'Restore' : 'Hold Access'}</button>
                                <button className="cancel-button" onClick={() => removeAdmin(admin)}>Remove</button>
                              </>}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!admins.filter(admin => (admin.email || '').toLowerCase().includes(adminSearch.toLowerCase())).length && <tr><td colSpan="4">No admins found for this company.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="welcome">
                <div>
                  <p className="eyebrow">{(isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.name : companyInfo?.name) || 'PROPERTY MANAGEMENT'}</p>
                  <h1>{activeTab}</h1>
                  <p className="subheading">Manage your properties from one place.</p>
                </div>

                <div>
                  <button className="cancel-button" onClick={sharePublicLink}>Copy Public Link</button>
                  <button className="add-button" onClick={openAddForm}>+ Add Property</button>
                </div>
              </div>

              <div className="stats">
                <div className="stat-card"><span>Total Properties</span><strong>{properties.length}</strong></div>
                <div className="stat-card"><span>Total Sectors</span><strong>{sectors.length}</strong></div>
              </div>

              <div className="property-section">
                <div className="section-heading">
                  <div>
                    <h2>Property Directory</h2>
                    <p>Search by property number or caretaker name.</p>
                  </div>
                  <span className="count">{sorted.length} shown</span>
                </div>

                <FilterBar filters={filters} setFilter={setFilter} onReset={resetFilters} sectors={sectors} />
                <PropertyTable rows={paginatedProperties} onView={viewProperty} onEdit={openEditForm} onDuplicate={openDuplicateForm} loadingList={listLoading} />
                {pagination}
              </div>
            </>
          )}
          <footer className="app-footer">Contact Harsheet · <a href="tel:7717463674">7717463674</a></footer>
        </section>
      </main>

      {showForm && isAdmin && (
        <div className="modal-overlay">
          <form className="property-form" onSubmit={addProperty}>
            <div className="form-heading">
              <div>
                <p className="eyebrow">{editingProperty ? 'UPDATE LISTING' : 'NEW LISTING'}</p>
                <h2>{editingProperty ? 'Edit Property' : 'Add Property'}</h2>
              </div>
              <button type="button" className="close-button" onClick={closeForm}>×</button>
            </div>

            {!editingProperty && properties.length > 0 && (
              <div className="copy-from">
                <label>Copy details from an existing property
                  <input
                    list="copy-from-list"
                    value={copyQuery}
                    onChange={e => copyFromProperty(e.target.value)}
                    placeholder="Type or pick a property number…"
                  />
                </label>
                <datalist id="copy-from-list">
                  {properties.map(p => <option key={p.rowId} value={`${p.id} · ${p.sector} · ${p.type}`} />)}
                </datalist>
                <small>Fills sector, location, type, rent, caretaker, phone, map and details. Property number and photos stay empty.</small>
              </div>
            )}

            <div className="form-grid">
              <label>Property Number *
                <input name="id" value={form.id} onChange={updateForm} required />
              </label>
              <label>Sector *
                <input name="sector" value={form.sector} onChange={updateForm} required />
              </label>
              <label className="full-field">Full Location
                <input name="location" value={form.location} onChange={updateForm} />
              </label>
              <div className="full-field units-block">
                <strong>Property Type & Monthly Rent *</strong>
                {units.map((unit, i) => (
                  <div className="unit-row" key={i}>
                    <select value={unit.type} onChange={e => setUnits(prev => prev.map((u, j) => j === i ? { ...u, type: e.target.value } : u))}>
                      {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input
                      type="number"
                      min="0"
                      placeholder="Monthly rent (₹)"
                      value={unit.rent}
                      onChange={e => setUnits(prev => prev.map((u, j) => j === i ? { ...u, rent: e.target.value } : u))}
                      required
                    />
                    {units.length > 1 && (
                      <button type="button" className="cancel-button" onClick={() => setUnits(prev => prev.filter((_, j) => j !== i))}>Remove</button>
                    )}
                  </div>
                ))}
                <button type="button" className="cancel-button" onClick={() => setUnits(prev => [...prev, { type: '1BHK', rent: '' }])}>+ Add another type (e.g. 1RK + 1BHK)</button>
                <small>If the property has more than one type, add each type with its own rent.</small>
              </div>
              <label>Caretaker Name
                <input name="caretaker" value={form.caretaker} onChange={updateForm} />
              </label>
              <label>Caretaker Phone
                <input name="phone" type="tel" value={form.phone} onChange={updateForm} />
              </label>
              <label className="full-field">Google Maps Link
                <input name="map" type="url" value={form.map} onChange={updateForm} />
              </label>
              <label className="full-field">Special Details
                <textarea name="details" value={form.details} onChange={updateForm} rows="3" />
              </label>

              {editingProperty && (
                <div className="full-field upload-status">
                  <strong>Photo Status</strong>
                  <div className="upload-status-counts">
                    <span className="badge-done">✓ Uploaded: {editingExistingMedia.length}</span>
                    <span className="badge-pending">⏳ Pending upload: {pendingCount}</span>
                  </div>
                  {editingFolders.length === 0 && <small>No photos uploaded yet.</small>}
                  {editingFolders.map(folder => (
                    <div className="uploaded-folder" key={folder.id}>
                      <div className="uploaded-folder-title">{folder.title} <span>({folder.items.length})</span></div>
                      <div className="uploaded-thumbs">
                        {folder.items.map(item => (
                          <div className="uploaded-thumb" key={item.url}>
                            {isVideo(item.url)
                              ? <span className="uploaded-video">🎬</span>
                              : <img src={thumb(item.url, 160)} alt={item.label || 'Uploaded photo'} loading="lazy" decoding="async" />}
                            {item.label && <small>{item.label}</small>}
                            <button type="button" aria-label="Remove file" onClick={() => removeExistingMedia(item.url)}>×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {editingFolders.length > 0 && <small>Removing a file here takes effect when you press Update Property.</small>}
                </div>
              )}

              <div className="full-field folder-uploads">
                <strong>Photo Folders</strong>
                <small>Add Ground Floor, Basement or a group of similar rooms (e.g. Rooms 1, 4, 7). Viewers see each as a folder. A file named like "Room 4.jpg" or "4.jpg" shows as "Room 4".</small>

                {editingFolders.length > 0 && (
                  <small className="folder-existing">Use the same folder name as an uploaded folder to add more photos to it.</small>
                )}

                {uploadGroups.map(group => (
                  <div className="folder-upload-row" key={group.key}>
                    <select value={group.kind} onChange={e => patchUploadGroup(group.key, { kind: e.target.value })}>
                      {FOLDER_KINDS.map(k => <option key={k} value={k}>{k === 'Rooms' ? 'Rooms (same type)' : k}</option>)}
                    </select>
                    {group.kind === 'Rooms' && (
                      <input placeholder="Room numbers, e.g. 1, 4, 7" value={group.rooms} onChange={e => patchUploadGroup(group.key, { rooms: e.target.value })} />
                    )}
                    {group.kind === 'Other' && (
                      <input placeholder="Folder name" value={group.custom} onChange={e => patchUploadGroup(group.key, { custom: e.target.value })} />
                    )}
                    <input type="file" accept="image/*,video/*" multiple onChange={e => patchUploadGroup(group.key, { files: Array.from(e.target.files || []) })} />
                    <span className="folder-file-count">{group.files.length} file(s)</span>
                    <button type="button" className="cancel-button" onClick={() => removeUploadGroup(group.key)}>Remove</button>
                    {group.files.length > 0 && (
                      <div className="pending-files">
                        {group.files.map((file, i) => <span key={`${file.name}-${i}`}>⏳ {file.name}{fileLabel(file.name) ? ` → ${fileLabel(file.name)}` : ''}</span>)}
                      </div>
                    )}
                  </div>
                ))}

                <div className="folder-quick-add">
                  <button type="button" className="cancel-button" onClick={() => addUploadGroup('Ground Floor')}>+ Ground Floor</button>
                  <button type="button" className="cancel-button" onClick={() => addUploadGroup('Basement')}>+ Basement</button>
                  <button type="button" className="cancel-button" onClick={() => addUploadGroup('Rooms')}>+ Rooms Group</button>
                  <button type="button" className="cancel-button" onClick={() => addUploadGroup('Other')}>+ Other Folder</button>
                </div>
              </div>

              <label className="full-field">Other Photos & Videos (no folder)
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={e => setMedia(Array.from(e.target.files || []))}
                />
                <small>{media.length} new file(s) selected.</small>
                {media.length > 0 && (
                  <div className="pending-files">
                    {media.map((file, i) => <span key={`${file.name}-${i}`}>⏳ {file.name}</span>)}
                  </div>
                )}
              </label>
            </div>

            <div className="form-actions">
              {editingProperty && (
                <button
                  type="button"
                  className="cancel-button danger-button"
                  disabled={saving}
                  onClick={() => { const p = properties.find(x => x.rowId === editingOriginalId); if (p) deleteProperty(p) }}
                >
                  Delete Property
                </button>
              )}
              <button type="button" className="cancel-button" onClick={closeForm} disabled={saving}>Cancel</button>
              <button type="submit" className="add-button" disabled={saving}>
                {saving ? 'Uploading & Saving...' : editingProperty ? 'Update Property' : 'Save Property'}
              </button>
            </div>
          </form>
        </div>
      )}

      {detailsModal}
      {previewModal}
    </div>
  )
}

export default App