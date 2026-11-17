import { useState, useEffect, useMemo } from 'react'
import JSZip from 'jszip'
import './App.css'
import { supabase } from './supabase'
import { uploadToCloudinary } from './cloudinary'

/* ---------------------------------------------------------------
   Constants & helpers
---------------------------------------------------------------- */
const PROPERTY_TYPES = ['1RK', '1RK Studio', '1BHK', '2BHK', '3BHK', 'Other']
// Sections for the Video Tour (add or rename sections here)
const VIDEO_SECTIONS = ['Ground Floor', 'Basement', 'Terrace', 'Parking', 'Other']

const emptyForm = {
  id: '', sector: '', location: '', type: '1RK', rent: '',
  caretaker: '', phone: '', map: '', details: ''
}

const emptyFilters = {
  search: '', type: 'All', sector: 'All', sort: 'default'
}

const params = new URLSearchParams(window.location.search)
const isPublic = params.get('public') === '1'

function isVideo(url) {
  return /\/video\/upload\//i.test(url) || /\.(mp4|mov|webm)(\?|$)/i.test(url)
}

function formatRent(rent) {
  return '₹' + Number(rent || 0).toLocaleString('en-IN')
}

// Convert a database row into the object used by the UI
function mapRow(item) {
  return {
    id: String(item.property_number),
    sector: item.sector || '',
    location: item.location || '',
    type: item.property_type || '',
    rent: Number(item.rent) || 0,
    caretaker: item.caretaker_name || '',
    phone: item.caretaker_phone || '',
    map: item.map_link || '',
    details: item.details || '',
    media_urls: item.media_urls || [],
    special_videos: Array.isArray(item.special_videos) ? item.special_videos : []
  }
}

async function downloadGalleryAsZip(property) {
  if (!property.media_urls?.length) return alert('No media available.')

  try {
    const zip = new JSZip()
    const folder = zip.folder(`Property-${property.id}`)

    for (let i = 0; i < property.media_urls.length; i++) {
      const response = await fetch(property.media_urls[i])
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const ext = blob.type.split('/')[1]?.split(';')[0] || 'file'
      folder.file(`Media-${i + 1}.${ext}`, blob)
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Property-${property.id}.zip`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    alert('ZIP download failed: ' + error.message)
  }
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
        placeholder="Search by property number, sector, caretaker, rent or type..."
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
        <option value="default">Newest First</option>
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
        {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
      </select>
    </div>
  )
}

function PropertyTable({ rows, onView, publicView }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SECTOR</th>
            <th>PROPERTY</th>
            <th>LOCATION</th>
            <th>TYPE</th>
            <th>{publicView ? 'RENT' : 'MONTHLY RENT'}</th>
            <th>CARETAKER</th>
            <th>PHONE</th>
            <th>DETAILS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(property => (
            <tr key={property.id}>
              <td>{property.sector}</td>
              <td><strong>#{property.id}</strong></td>
              <td>{property.location || 'Not added'}</td>
              <td>{property.type}</td>
              <td>{formatRent(property.rent)}</td>
              <td>{property.caretaker || 'Not added'}</td>
              <td>
                {property.phone
                  ? <a href={`tel:${property.phone}`}>{property.phone}</a>
                  : 'Not added'}
              </td>
              <td>
                <button className="action-link" onClick={() => onView(property)}>View</button>
              </td>
            </tr>
          ))}

          {!rows.length && (
            <tr><td colSpan="8">No properties found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function DetailsModal({
  property, isAdmin, onClose, onEdit, onDelete, onPreview,
  selectedMedia, setSelectedMedia, onRemoveOne, onRemoveSelected, onReplace, onRemoveSpecial
}) {
  const urls = property.media_urls || []
  const specialVideos = property.special_videos || []
  const sectionsWithVideos = VIDEO_SECTIONS.filter(s => specialVideos.some(v => v.category === s))
  const [activeSection, setActiveSection] = useState(sectionsWithVideos[0] || null)
  const currentSection = sectionsWithVideos.includes(activeSection) ? activeSection : sectionsWithVideos[0]
  const sectionVideos = specialVideos.filter(v => v.category === currentSection)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="details-modal" onClick={e => e.stopPropagation()}>
        <div className="form-heading">
          <div>
            <p className="eyebrow">PROPERTY DETAILS</p>
            <h2>#{property.id}</h2>
            <p>{property.sector} · {property.type}</p>
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="details-grid">
          <div><small>Monthly Rent</small><strong>{formatRent(property.rent)}</strong></div>
          <div><small>Caretaker</small><strong>{property.caretaker || 'Not added'}</strong></div>
          <div><small>Phone</small><strong>{property.phone || 'Not added'}</strong></div>
        </div>

        {property.location && <p className="detail-line"><strong>Address:</strong> {property.location}</p>}
        {property.details && <p className="detail-line"><strong>Details:</strong> {property.details}</p>}

        {sectionsWithVideos.length > 0 && (
          <div className="video-tour">
            <h3>Video Tour</h3>
            <div className="video-tour-body">
              <div className="video-tour-menu">
                {sectionsWithVideos.map(section => (
                  <button
                    key={section}
                    type="button"
                    className={`video-tour-tab ${section === currentSection ? 'active' : ''}`}
                    onClick={() => setActiveSection(section)}
                  >
                    {section}
                    <span>{specialVideos.filter(v => v.category === section).length}</span>
                  </button>
                ))}
              </div>

              <div className="video-tour-videos">
                {sectionVideos.map(video => (
                  <div className="video-tour-item" key={video.url}>
                    <video src={video.url} controls preload="metadata" />
                    {isAdmin && (
                      <button
                        type="button"
                        className="media-delete-button"
                        onClick={() => onRemoveSpecial(video.url)}
                      >
                        Delete video
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="gallery-heading">
          <div><h3>Photos & Videos</h3><p>{urls.length} files</p></div>
          {urls.length > 0 && (
            <button className="add-button" onClick={() => downloadGalleryAsZip(property)}>
              Download All ZIP
            </button>
          )}
        </div>

        {isAdmin && urls.length > 0 && (
          <div className="gallery-tools">
            <button
              className="cancel-button"
              onClick={() => setSelectedMedia(selectedMedia.length === urls.length ? [] : [...urls])}
            >
              Select All / None
            </button>
            <span>{selectedMedia.length} selected</span>
            <button
              className="cancel-button"
              onClick={onRemoveSelected}
              disabled={!selectedMedia.length}
            >
              Delete Selected
            </button>
          </div>
        )}

        <div className="media-gallery">
          {urls.map((url, index) => (
            <div className="gallery-item" key={url}>
              {isAdmin && (
                <label>
                  <input
                    type="checkbox"
                    checked={selectedMedia.includes(url)}
                    onChange={() => setSelectedMedia(prev =>
                      prev.includes(url) ? prev.filter(x => x !== url) : [...prev, url]
                    )}
                  />
                  Select
                </label>
              )}

              {isVideo(url)
                ? <video src={url} controls preload="metadata" />
                : (
                  <button className="gallery-image-button" onClick={() => onPreview(url)}>
                    <img src={url} alt={`Property ${index + 1}`} />
                    <span>View photo</span>
                  </button>
                )}

              {isAdmin && (
                <div className="media-management-actions">
                  <label className="replace-media-button">
                    Replace
                    <input
                      type="file"
                      accept="image/*,video/*"
                      hidden
                      onChange={e => {
                        onReplace(url, e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <button className="media-delete-button" onClick={() => onRemoveOne(url)}>Delete</button>
                </div>
              )}

              <a className="media-download" href={url} target="_blank" rel="noreferrer">
                Open / Download
              </a>
            </div>
          ))}
        </div>

        <div className="details-actions">
          {isAdmin && (
            <>
              <button className="add-button" onClick={() => onEdit(property)}>Edit Property</button>
              <button className="cancel-button" onClick={() => onDelete(property)}>Delete Property</button>
            </>
          )}
          {property.phone && <a className="add-button" href={`tel:${property.phone}`}>Call Caretaker</a>}
          {property.map && <a className="action-link" href={property.map} target="_blank" rel="noreferrer">Open Map ↗</a>}
          <button className="cancel-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function ImagePreview({ url, onClose }) {
  return (
    <div className="image-preview-overlay" onClick={onClose}>
      <button className="preview-close" onClick={onClose}>×</button>
      <img src={url} alt="Property full preview" />
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
  const [roleChecked, setRoleChecked] = useState(false)
  const [loading, setLoading] = useState(!isPublic)
  const [email, setEmail] = useState('')

  // Data
  const [properties, setProperties] = useState([])
  const [admins, setAdmins] = useState([])
  const [adminEmail, setAdminEmail] = useState('')

  // List controls
  const [filters, setFilters] = useState(emptyFilters)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [activeTab, setActiveTab] = useState('Dashboard')

  // Form & modals
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [media, setMedia] = useState([])
  const [specialFiles, setSpecialFiles] = useState({})
  const [saving, setSaving] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState(null)
  const [previewMedia, setPreviewMedia] = useState(null)
  const [editingProperty, setEditingProperty] = useState(false)
  const [editingOriginalId, setEditingOriginalId] = useState(null)
  const [selectedMedia, setSelectedMedia] = useState([])

  const isAdmin = role === 'admin' || role === 'super_admin'
  const isSuperAdmin = role === 'super_admin'
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
      setRoleChecked(false)
      return
    }

    let active = true

    async function loadRole() {
      const { data, error } = await supabase
        .from('propertyhub_admins')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle()

      if (!active) return

      setRole(error || !data ? null : data.role)
      setRoleChecked(true)
    }

    loadRole()
    return () => { active = false }
  }, [userId])

  /* ---------- Load properties ---------- */
  useEffect(() => {
    if (!isPublic && !role) return

    async function loadProperties() {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error(error)
        return
      }

      setProperties((data || []).map(mapRow))
    }

    loadProperties()
  }, [role])

  /* ---------- Load admins (Super Admin only) ---------- */
  useEffect(() => {
    if (!isSuperAdmin) return

    async function loadAdmins() {
      const { data, error } = await supabase
        .from('propertyhub_admins')
        .select('user_id,email,role,created_at')
        .order('created_at', { ascending: true })

      if (error) console.error(error)
      else setAdmins(data || [])
    }

    loadAdmins()
  }, [isSuperAdmin])

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
      const matchesSearch = !q || [
        p.id, p.sector, p.location, p.type, p.rent,
        p.caretaker, p.phone, p.details
      ].some(value => String(value).toLowerCase().includes(q))

      return matchesSearch &&
        (filters.type === 'All' || p.type === filters.type) &&
        (filters.sector === 'All' || p.sector === filters.sector)
    })

    return [...filtered].sort((a, b) => {
      if (filters.sort === 'sector') return a.sector.localeCompare(b.sector)
      if (filters.sort === 'rent-low') return a.rent - b.rent
      if (filters.sort === 'rent-high') return b.rent - a.rent
      if (filters.sort === 'type') {
        const ai = PROPERTY_TYPES.indexOf(a.type)
        const bi = PROPERTY_TYPES.indexOf(b.type)
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
    setActiveTab('Dashboard')
  }

  /* ---------- Admin management ---------- */
  const refreshAdmins = async () => {
    const { data } = await supabase
      .from('propertyhub_admins')
      .select('user_id,email,role,created_at')
      .order('created_at', { ascending: true })

    setAdmins(data || [])
  }

  const addAdmin = async (e) => {
    e.preventDefault()

    const inviteEmail = adminEmail.trim()
    if (!inviteEmail) return

    const { data: { session: currentSession } } = await supabase.auth.getSession()

    if (!currentSession) return alert('Please login again.')

    const { data, error } = await supabase.functions.invoke('smooth-function', {
      body: { email: inviteEmail }
    })

    if (error || data?.error) {
      return alert('Could not send invitation: ' + (data?.error || error.message))
    }

    alert('Invitation sent successfully to ' + inviteEmail)
    setAdminEmail('')
    refreshAdmins()
  }

  const removeAdmin = async (admin) => {
    if (!isSuperAdmin || admin.role === 'super_admin') return
    if (!window.confirm(`Are you sure you want to remove ${admin.email}?`)) return

    const { error } = await supabase
      .from('propertyhub_admins')
      .delete()
      .eq('user_id', admin.user_id)

    if (error) return alert('Could not remove admin: ' + error.message)

    setAdmins(prev => prev.filter(item => item.user_id !== admin.user_id))
    alert('Admin removed successfully.')
  }

  /* ---------- Property form ---------- */
  const sharePublicLink = async () => {
    const link = `${window.location.origin}/?public=1`

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

  const openAddForm = () => {
    setForm(emptyForm)
    setMedia([])
    setSpecialFiles({})
    setEditingProperty(false)
    setEditingOriginalId(null)
    setShowForm(true)
  }

  const openEditForm = (property) => {
    setForm({
      id: property.id,
      sector: property.sector || '',
      location: property.location || '',
      type: property.type || '1RK',
      rent: property.rent || '',
      caretaker: property.caretaker || '',
      phone: property.phone || '',
      map: property.map || '',
      details: property.details || ''
    })

    setEditingOriginalId(property.id)
    setEditingProperty(true)
    setMedia([])
    setSpecialFiles({})
    setSelectedProperty(null)
    setSelectedMedia([])
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingProperty(false)
    setEditingOriginalId(null)
    setForm(emptyForm)
    setMedia([])
    setSpecialFiles({})
  }

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

    const newId = form.id.trim()
    if (!newId) return alert('Property number is required.')

    const duplicate = properties.some(p =>
      p.id.toLowerCase() === newId.toLowerCase() &&
      (!editingProperty || p.id !== editingOriginalId)
    )

    if (duplicate) return alert('Property number already exists.')

    setSaving(true)

    try {
      const uploadedUrls = await Promise.all(media.map(file => uploadToCloudinary(file)))

      const existing = editingProperty
        ? properties.find(p => p.id === editingOriginalId)
        : null

      const allMediaUrls = [...(existing?.media_urls || []), ...uploadedUrls]

      const newSpecial = await Promise.all(
        VIDEO_SECTIONS.flatMap(category =>
          (specialFiles[category] || []).map(async file => ({
            category,
            url: await uploadToCloudinary(file)
          }))
        )
      )

      const allSpecialVideos = [...(existing?.special_videos || []), ...newSpecial]

      const propertyData = {
        property_number: newId,
        sector: form.sector.trim(),
        location: form.location,
        property_type: form.type,
        rent: Number(form.rent),
        caretaker_name: form.caretaker,
        caretaker_phone: form.phone,
        map_link: form.map,
        details: form.details,
        media_urls: allMediaUrls,
        special_videos: allSpecialVideos,
        ...(editingProperty ? {} : { status: 'Available' })
      }

      const uiRow = {
        id: newId,
        sector: propertyData.sector,
        location: form.location,
        type: form.type,
        rent: Number(form.rent),
        caretaker: form.caretaker,
        phone: form.phone,
        map: form.map,
        details: form.details,
        media_urls: allMediaUrls,
        special_videos: allSpecialVideos
      }

      if (editingProperty) {
        const { error } = await supabase
          .from('properties')
          .update(propertyData)
          .eq('property_number', editingOriginalId)

        if (error) throw error

        setProperties(prev => prev.map(p => p.id === editingOriginalId ? uiRow : p))
        alert('Property updated successfully!')
      } else {
        const { error } = await supabase.from('properties').insert([propertyData])

        if (error) throw error

        setProperties(prev => [uiRow, ...prev])
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
      .eq('property_number', property.id)

    if (error) return alert('Delete failed: ' + error.message)

    setProperties(prev => prev.filter(p => p.id !== property.id))
    closeDetails()
    alert('Property deleted.')
  }

  /* ---------- Gallery management ---------- */
  const saveGallery = async (property, newUrls) => {
    if (!isAdmin) return

    const { error } = await supabase
      .from('properties')
      .update({ media_urls: newUrls })
      .eq('property_number', property.id)

    if (error) throw error

    const updated = { ...property, media_urls: newUrls }

    setProperties(prev => prev.map(p => p.id === property.id ? updated : p))
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

  const removeSpecialVideo = async (url) => {
    if (!isAdmin || !selectedProperty) return
    if (!window.confirm('Remove this video?')) return

    const newVideos = (selectedProperty.special_videos || []).filter(v => v.url !== url)

    const { error } = await supabase
      .from('properties')
      .update({ special_videos: newVideos })
      .eq('property_number', selectedProperty.id)

    if (error) return alert('Could not remove video: ' + error.message)

    const updated = { ...selectedProperty, special_videos: newVideos }
    setProperties(prev => prev.map(p => p.id === updated.id ? updated : p))
    setSelectedProperty(updated)
  }

  const replaceMedia = async (oldUrl, file) => {
    if (!isAdmin || !file || !selectedProperty) return
    if (!window.confirm('Replace this photo/video?')) return

    try {
      const newUrl = await uploadToCloudinary(file)
      const newUrls = selectedProperty.media_urls.map(url => url === oldUrl ? newUrl : url)
      await saveGallery(selectedProperty, newUrls)
      alert('Media replaced.')
    } catch (error) {
      alert('Replace failed: ' + error.message)
    }
  }

  /* ---------- Shared modal props ---------- */
  const detailsModal = selectedProperty && (
    <DetailsModal
      key={selectedProperty.id}
      property={selectedProperty}
      isAdmin={isAdmin && !isPublic}
      onClose={closeDetails}
      onEdit={openEditForm}
      onDelete={deleteProperty}
      onPreview={setPreviewMedia}
      selectedMedia={selectedMedia}
      setSelectedMedia={setSelectedMedia}
      onRemoveOne={removeOneMedia}
      onRemoveSelected={removeSelectedMedia}
      onReplace={replaceMedia}
      onRemoveSpecial={removeSpecialVideo}
    />
  )

  const previewModal = previewMedia && (
    <ImagePreview url={previewMedia} onClose={() => setPreviewMedia(null)} />
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
    return <div className="login-screen"><h2>Loading PropertyHub...</h2></div>
  }

  // Public read-only page
  if (isPublic) {
    return (
      <div className="app">
        <main className="main" style={{ marginLeft: 0, width: '100%' }}>
          <section className="content">
            <div className="welcome">
              <div>
                <p className="eyebrow">FNF PROPERTIES</p>
                <h1>Property Listings</h1>
                <p className="subheading">Explore available properties.</p>
              </div>
              <span className="count">{properties.length} properties</span>
            </div>

            <div className="property-section">
              <FilterBar filters={filters} setFilter={setFilter} onReset={resetFilters} sectors={sectors} />
              <PropertyTable rows={paginatedProperties} onView={viewProperty} publicView />
              {pagination}
            </div>

            {detailsModal}
            {previewModal}
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
  const tabs = ['Dashboard', 'All Properties', ...(isSuperAdmin ? ['Manage Admins'] : [])]

  return (
    <div className="app">
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
            <div className="company-icon">F</div>
            <div>
              <strong>FNF Properties</strong>
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
          {activeTab === 'Manage Admins' && isSuperAdmin ? (
            <div className="property-section">
              <div className="section-heading">
                <div><h2>Manage Admins</h2><p>Add or remove PropertyHub administrators.</p></div>
              </div>

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

              <p className="subheading">
                An invitation will be sent by email. The admin logs in with the link, no password needed.
              </p>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>EMAIL</th><th>ROLE</th><th>ACTION</th></tr></thead>
                  <tbody>
                    {admins.map(admin => (
                      <tr key={admin.user_id}>
                        <td>{admin.email}</td>
                        <td>{admin.role}</td>
                        <td>
                          {admin.role !== 'super_admin' && (
                            <button className="cancel-button" onClick={() => removeAdmin(admin)}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!admins.length && <tr><td colSpan="3">No admins found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="welcome">
                <div>
                  <p className="eyebrow">PROPERTY MANAGEMENT</p>
                  <h1>{activeTab === 'Dashboard' ? 'Good day 👋' : activeTab}</h1>
                  <p className="subheading">Manage your properties from one place.</p>
                </div>

                <div>
                  <button className="cancel-button" onClick={sharePublicLink}>Copy Public Link</button>
                  <button className="add-button" onClick={openAddForm}>+ Add Property</button>
                </div>
              </div>

              <div className="stats">
                <div className="stat-card"><span>Total Properties</span><strong>{properties.length}</strong></div>
                <div className="stat-card"><span>With Video Tour</span><strong className="green">{properties.filter(p => p.special_videos?.length > 0).length}</strong></div>
                <div className="stat-card"><span>Sectors</span><strong>{sectors.length}</strong></div>
              </div>

              {activeTab === 'Dashboard' ? (
                <div className="property-section">
                  <div className="section-heading">
                    <div><h2>Recently Added</h2><p>Your latest 5 listings.</p></div>
                    <button className="cancel-button" onClick={() => setActiveTab('All Properties')}>
                      View all properties
                    </button>
                  </div>

                  <PropertyTable rows={recentProperties} onView={viewProperty} />
                </div>
              ) : (
                <div className="property-section">
                  <div className="section-heading">
                    <div>
                      <h2>Property Directory</h2>
                      <p>Search by property number, sector, caretaker, rent or type.</p>
                    </div>
                    <span className="count">{sorted.length} shown</span>
                  </div>

                  <FilterBar filters={filters} setFilter={setFilter} onReset={resetFilters} sectors={sectors} />
                  <PropertyTable rows={paginatedProperties} onView={viewProperty} />
                  {pagination}
                </div>
              )}
            </>
          )}
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
              <label>Property Type
                <select name="type" value={form.type} onChange={updateForm}>
                  {PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label>Monthly Rent *
                <input name="rent" type="number" min="0" value={form.rent} onChange={updateForm} required />
              </label>
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
              <label className="full-field">Add Photos & Videos
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={e => setMedia(Array.from(e.target.files || []))}
                />
                <small>{media.length} new file(s) selected.</small>
              </label>

              <div className="full-field special-video-fields">
                <strong>Video Tour (section-wise videos)</strong>
                <small>Add videos for each section. Viewers will see these in a menu on the left.</small>
                <div className="special-video-grid">
                  {VIDEO_SECTIONS.map(section => (
                    <label key={section}>{section}
                      <input
                        type="file"
                        accept="video/*"
                        multiple
                        onChange={e => setSpecialFiles(prev => ({
                          ...prev,
                          [section]: Array.from(e.target.files || [])
                        }))}
                      />
                      <small>{(specialFiles[section] || []).length} new video(s) selected.</small>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-actions">
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
