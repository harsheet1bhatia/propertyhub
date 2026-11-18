import { useState, useEffect, useMemo } from 'react'

import './App.css'

import { supabase } from './supabase'

import { uploadToCloudinary } from './cloudinary'



/* ---------------------------------------------------------------

   Constants & helpers

---------------------------------------------------------------- */

const PROPERTY_TYPES = ['1RK', '1RK Studio', '1BHK', '2BHK', '3BHK', 'Other']



const emptyForm = {

  id: '', sector: '', location: '', type: '1RK', rent: '',

  caretaker: '', phone: '', map: '', details: ''

}



const emptyFilters = {

  search: '', type: 'All', sector: 'All', sort: 'default'

}



const params = new URLSearchParams(window.location.search)

const isPublic = params.get('public') === '1'
const companySlug = params.get('company') || 'fnf-properties'



function isVideo(url) {

  return /video\/upload/i.test(url) || /\.(mp4|mov|webm)(\?|$)/i.test(url)

}



function formatRent(rent) {

  return '₹' + Number(rent || 0).toLocaleString('en-IN')

}

function phoneHref(phone) {
  const cleaned = String(phone || '').trim().replace(/(?!^)\+/g, '').replace(/[^0-9+]/g, '')
  return cleaned ? `tel:${cleaned}` : undefined
}

async function copyPropertyText(property) {
  const message = [
    `Sector: ${property.sector || 'N/A'}`,
    `Property: ${property.id || 'N/A'} (${property.type || 'N/A'})`,
    `Rent: ${formatRent(property.rent)}`,
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



async function downloadMediaFiles(urls, propertyId) {
  const files = (urls || []).filter(url => url && !isVideo(url))
  if (!files.length) return alert('No photos available to download.')

  let downloaded = 0
  for (let i = 0; i < files.length; i++) {
    try {
      const response = await fetch(files[i])
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const ext = (blob.type.split('/')[1] || files[i].split('.').pop().split('?')[0] || 'jpg').split(';')[0]
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `Property-${propertyId}-Photo-${i + 1}.${ext}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000)
      downloaded++
      // A small gap helps browsers process each individual download.
      await new Promise(resolve => window.setTimeout(resolve, 250))
    } catch (error) {
      console.error('Photo download failed:', files[i], error)
    }
  }
  if (downloaded < files.length) alert(`${downloaded} of ${files.length} photos downloaded. If your browser blocked multiple downloads, allow downloads for this site and try again.`)
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
  if (publicView) {
    return (
      <div className="property-mobile-cards public-property-grid">
        {rows.map(property => {
          const allPhotos = (property.media_urls || []).filter(url => !isVideo(url))
          const photos = allPhotos.slice(0, 4)
          return (
            <article className="public-property-card" key={`public-${property.id}`}>
              <button className={`property-photo-collage collage-count-${photos.length}`} onClick={() => onView(property)} aria-label={`Open property ${property.id} photos`}>
                {photos.length ? photos.map((url, index) => (
                  <span className="collage-photo" key={`${url}-${index}`}>
                    <img src={url} alt={`Property ${property.id} photo ${index + 1}`} loading="lazy" />
                    {index === 3 && allPhotos.length > 4 && <b>+{allPhotos.length - 4}</b>}
                  </span>
                )) : <span className="collage-empty">No photos available</span>}
              </button>
              <div className="public-property-card-content">
                <div className="public-property-card-title">
                  <div><small>{property.sector || 'Property'}</small><h3>#{property.id} · {property.type}</h3></div>
                  <strong>{formatRent(property.rent)}<small>/ month</small></strong>
                </div>
                <p>{property.location || 'Location not added'}</p>
                <div className="public-card-actions">
                  <button className="add-button" onClick={() => onView(property)}>View Property</button>
                  <button className="cancel-button" onClick={() => copyPropertyText(property)}>Copy Details</button>
                </div>
                {property.phone && <a className="public-call-link" href={phoneHref(property.phone)}>Call Caretaker · {property.phone}</a>}
              </div>
            </article>
          )
        })}
        {!rows.length && <p className="public-empty-state">No properties found.</p>}
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>SECTOR</th><th>PROPERTY</th><th>LOCATION</th><th>TYPE</th><th>MONTHLY RENT</th><th>CARETAKER</th><th>PHONE</th><th>DETAILS</th></tr></thead>
        <tbody>
          {rows.map(property => (
            <tr key={property.id}>
              <td>{property.sector}</td><td><strong>#{property.id}</strong></td><td>{property.location || 'Not added'}</td><td>{property.type}</td><td>{formatRent(property.rent)}</td><td>{property.caretaker || 'Not added'}</td>
              <td>{property.phone ? <a href={phoneHref(property.phone)}>{property.phone}</a> : 'Not added'}</td>
              <td><button className="action-link" onClick={() => onView(property)}>View</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="8">No properties found.</td></tr>}
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
  const photoUrls = urls.filter(url => !isVideo(url))
  const copyPropertyDetails = () => copyPropertyText(property)




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

          <div><small>Phone</small><strong>{property.phone ? <a href={phoneHref(property.phone)}>{property.phone} · Call</a> : 'Not added'}</strong></div>

        </div>



        {property.location && <p className="detail-line"><strong>Address:</strong> {property.location}</p>}

        {property.details && <p className="detail-line"><strong>Details:</strong> {property.details}</p>}



        <div className="gallery-heading">

          <div><h3>Photos & Videos</h3><p>{urls.length} files</p></div>

          {photoUrls.length > 0 && (
            <button className="add-button" onClick={() => downloadMediaFiles(photoUrls, property.id)}>
              Download All Photos
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

            <button className="cancel-button" onClick={() => downloadMediaFiles(selectedMedia, property.id)} disabled={!selectedMedia.some(url => !isVideo(url))}>
              Download Selected
            </button>

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



              <a className="media-download" href={url} target="\_blank" rel="noreferrer">

                Open / Download

              </a>

            </div>

          ))}

        </div>



        <div className="details-actions">
          <button className="add-button" onClick={copyPropertyDetails}>Copy Details</button>

          {isAdmin && (

            <>

              <button className="add-button" onClick={() => onEdit(property)}>Edit Property</button>

              <button className="cancel-button" onClick={() => onDelete(property)}>Delete Property</button>

            </>

          )}

          {property.phone && <a className="add-button" href={phoneHref(property.phone)}>Call Caretaker</a>}

          {property.map && <a className="action-link" href={property.map} target="\_blank" rel="noreferrer">Open Map ↗</a>}

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
  return (
    <div className="image-preview-overlay" onClick={onClose} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <button className="preview-close" onClick={onClose}>×</button>
      <button className="preview-nav preview-prev" onClick={e => { e.stopPropagation(); move(-1) }} disabled={index === 0}>‹</button>
      <div className="preview-content" onClick={e => e.stopPropagation()} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <img src={current.url} alt={`Property ${current.propertyId} photo ${index + 1}`} />
        <p>Property #{current.propertyId} · {index + 1} / {images.length}</p>
      </div>
      <button className="preview-nav preview-next" onClick={e => { e.stopPropagation(); move(1) }} disabled={index === images.length - 1}>›</button>
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
  const [companySettings, setCompanySettings] = useState({ name: '', logo_url: '', theme_color: '#b9955b', text_color: '#ffffff', theme_preset: 'ivory-gold' })
  const [companySearch, setCompanySearch] = useState('')
  const [adminSearch, setAdminSearch] = useState('')

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

  const [activeTab, setActiveTab] = useState('All Properties')



  // Form & modals

  const [showForm, setShowForm] = useState(false)

  const [form, setForm] = useState(emptyForm)

  const [media, setMedia] = useState([])
  const [editingExistingMedia, setEditingExistingMedia] = useState([])

  const [specialFiles, setSpecialFiles] = useState({})

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
        if (!companySlug) { setLoading(false); return }
        const { data: companyData, error: companyError } = await supabase.rpc('get_public_company_by_slug', { company_slug: companySlug })
        if (!active) return
        if (companyError || !companyData) { console.error(companyError); setProperties([]); setLoading(false); return }
        setCompanyInfo(companyData)
        const { data, error } = await supabase.rpc('get_public_company_properties', { company_slug: companySlug })
        if (!active) return
        if (error) console.error(error)
        setProperties((data || []).map(mapRow))
        setLoading(false)
        return
      }
      if (!role) return
      if (isSuperAdmin) {
        const { data, error } = await supabase.from('companies').select('*').order('created_at', { ascending: true })
        if (!active) return
        if (error) { console.error(error); return }
        setCompanies(data || [])
        setSelectedCompanyId(prev => prev || data?.[0]?.id || '')
      } else if (companyId) {
        const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).single()
        if (!active) return
        if (error) console.error(error)
        setCompanyInfo(data || null)
        if (data) setCompanySettings({ name: data.name || '', logo_url: data.logo_url || '', theme_color: data.theme_color || '#b9955b', text_color: data.text_color || '#ffffff', theme_preset: data.theme_preset || 'ivory-gold' })
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
      const { data, error } = await supabase.from('properties').select('*').eq('company_id', activeCompanyId).order('created_at', { ascending: false })
      if (!active) return
      if (error) { console.error(error); return }
      setProperties((data || []).map(mapRow))
    }
    loadProperties()
    return () => { active = false }
  }, [role, activeCompanyId, isPublic])

  /* ---------- Load admins (Super Admin only) ---------- */

  useEffect(() => {
    if (!isSuperAdmin || !selectedCompanyId) { setAdmins([]); return }
    let active = true
    async function loadAdmins() {
      const { data, error } = await supabase
        .from('propertyhub_admins')
        .select('user_id,email,role,company_id,created_at,is_active')
        .eq('company_id', selectedCompanyId)
        .order('created_at', { ascending: true })
      if (!active) return
      if (error) console.error(error)
      else setAdmins(data || [])
    }
    loadAdmins()
    return () => { active = false }
  }, [isSuperAdmin, selectedCompanyId])



  useEffect(() => {
    if (!isSuperAdmin || !selectedCompanyId) return
    const selected = companies.find(c => c.id === selectedCompanyId)
    if (selected) setCompanySettings({ name: selected.name || '', logo_url: selected.logo_url || '', theme_color: selected.theme_color || '#b9955b', text_color: selected.text_color || '#ffffff', theme_preset: selected.theme_preset || 'ivory-gold' })
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

      const matchesSearch = !q || [

        p.id, p.sector, p.location, p.type, p.rent,

        p.caretaker, p.phone, p.details

      ].some(value => String(value).toLowerCase().includes(q))



      return matchesSearch &&

        (filters.type === 'All' || p.type === filters.type) &&

        (filters.sector === 'All' || p.sector === filters.sector)

    })



    return [...filtered].sort((a, b) => {

      if (filters.sort === 'sector' || filters.sort === 'default') return String(a.sector || '').localeCompare(String(b.sector || ''), undefined, { numeric: true, sensitivity: 'base' })

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

    setActiveTab('All Properties')

  }



  /* ---------- Admin management ---------- */

  const refreshAdmins = async () => {

    const { data } = await supabase

      .from('propertyhub_admins')

      .select('user_id,email,role,company_id,created_at,is_active')

      .eq('company_id', selectedCompanyId)

      .order('created_at', { ascending: true })



    setAdmins(data || [])

  }



  const addAdmin = async (e) => {

    e.preventDefault()



    const inviteEmail = adminEmail.trim()

    if (!inviteEmail) return
    const selectedCompany = companies.find(c => c.id === selectedCompanyId)
    if (!selectedCompanyId || selectedCompany?.is_active === false) return alert('Select an active company before adding an admin.')



    const { data: { session: currentSession } } = await supabase.auth.getSession()



    if (!currentSession) return alert('Please login again.')



    const { data, error } = await supabase.functions.invoke('smooth-function', {

      body: { email: inviteEmail, company_id: selectedCompanyId || null }

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

  const toggleAdminAccess = async (admin) => {
    if (!isSuperAdmin || admin.role === 'super_admin') return
    const nextActive = admin.is_active === false
    const action = nextActive ? 'restore access for' : 'put on hold'
    if (!window.confirm(`Are you sure you want to ${action} ${admin.email}?`)) return
    const { error } = await supabase.from('propertyhub_admins')
      .update({ is_active: nextActive })
      .eq('user_id', admin.user_id)
      .eq('company_id', selectedCompanyId)
    if (error) return alert('Could not update admin access: ' + error.message)
    setAdmins(prev => prev.map(item => item.user_id === admin.user_id ? { ...item, is_active: nextActive } : item))
    alert(nextActive ? 'Admin access restored.' : 'Admin access put on hold.')
  }

  const removeAdmin = async (admin) => {

    if (!isSuperAdmin || admin.role === 'super_admin') return

    if (!window.confirm(`Are you sure you want to remove ${admin.email}?`)) return



    const { error } = await supabase

      .from('propertyhub_admins')

      .delete()

      .eq('user_id', admin.user_id)
      .eq('company_id', selectedCompanyId)



    if (error) return alert('Could not remove admin: ' + error.message)



    setAdmins(prev => prev.filter(item => item.user_id !== admin.user_id))

    alert('Admin removed successfully.')

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



  const openAddForm = () => {

    setForm(emptyForm)

    setMedia([])
    setEditingExistingMedia([])

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

    setEditingExistingMedia(property.media_urls || [])

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
    setEditingExistingMedia([])

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
    if (!activeCompanyId) return alert('Select a company before adding a property.')

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



      const allMediaUrls = [...(editingProperty ? editingExistingMedia : []), ...uploadedUrls]



      const newSpecial = []



      const allSpecialVideos = [...(existing?.special_videos || []), ...newSpecial]



      const propertyData = {

        company_id: activeCompanyId,
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

      onPreview={(url) => {
        const images = properties.flatMap(item => (item.media_urls || []).filter(mediaUrl => !isVideo(mediaUrl)).map(mediaUrl => ({ url: mediaUrl, propertyId: item.id })))
        const index = Math.max(0, images.findIndex(item => item.url === url))
        setPreviewMedia({ images, index })
      }}

      selectedMedia={selectedMedia}

      setSelectedMedia={setSelectedMedia}

      onRemoveOne={removeOneMedia}

      onRemoveSelected={removeSelectedMedia}

      onReplace={replaceMedia}

      onRemoveSpecial={removeSpecialVideo}

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

    return <div className="login-screen"><h2>Loading PropertyHub...</h2></div>

  }



  // Public read-only page

  if (isPublic) {

    return (

      <div className="app" data-theme={companyInfo?.theme_preset || 'ivory-gold'} style={{ "--company-accent": companyInfo?.theme_color || "#b9955b", "--company-text": companyInfo?.text_color || "#ffffff" }}>

        <main className="main" style={{ marginLeft: 0, width: '100%' }}>

          <section className="content">

            <div className="public-company-header">
              <div className="public-brand-lockup">{companyInfo?.logo_url ? <img src={companyInfo.logo_url} alt="Company logo" /> : <span className="public-brand-monogram">{(companyInfo?.name || 'P').slice(0,1)}</span>}<h1>{companyInfo?.name || 'PROPERTY LISTINGS'}</h1></div>
              <span className="count">{properties.length} properties</span>
            </div>



            <div className="property-section">

              <FilterBar filters={filters} setFilter={setFilter} onReset={resetFilters} sectors={sectors} />

              <PropertyTable rows={paginatedProperties} onView={viewProperty} publicView />

              {pagination}

            </div>



            {detailsModal}

            {previewModal}
            <footer className="app-footer">Contact Harsheet · <a href="tel:7717463674">7717463674</a></footer>

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

  const tabs = ['All Properties', 'Company Settings', ...(isSuperAdmin ? ['Manage Companies', 'Manage Admins'] : [])]



  return (

    <div className="app" data-theme={(isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.theme_preset : companyInfo?.theme_preset) || 'ivory-gold'} style={{ "--company-accent": (isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.theme_color : companyInfo?.theme_color) || "#b9955b", "--company-text": (isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.text_color : companyInfo?.text_color) || "#ffffff" }}>

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

          {activeTab === 'Manage Companies' && isSuperAdmin ? (
            <div className="property-section">
              <div className="section-heading"><div><h2>Manage Companies</h2><p>Create a separate workspace for each company.</p></div></div>
              <form className="search-box company-create-form" onSubmit={async e => { e.preventDefault(); const slug = newCompany.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); if (!slug) return alert('Enter a valid URL slug.'); const { data, error } = await supabase.from('companies').insert({ name: newCompany.name.trim(), slug }).select('*').single(); if (error) return alert('Could not create company: ' + error.message); setCompanies(prev => [...prev, data]); setSelectedCompanyId(data.id); setNewCompany({ name: '', slug: '' }); alert('Company created.'); }}>
                <input placeholder="Company name" value={newCompany.name} onChange={e => setNewCompany(p => ({ ...p, name: e.target.value }))} required />
                <input placeholder="Public URL slug (e.g. fnf-properties)" value={newCompany.slug} onChange={e => setNewCompany(p => ({ ...p, slug: e.target.value }))} required />
                <button className="add-button">+ Create Company</button>
              </form>
              <input className="company-search-input" value={companySearch} onChange={e => setCompanySearch(e.target.value)} placeholder="Search company by name or URL slug..." />
              <div className="table-wrap"><table><thead><tr><th>COMPANY</th><th>STATUS</th><th>PUBLIC LISTING</th><th>OPEN WORKSPACE</th><th>ACTION</th></tr></thead><tbody>{companies.filter(c => `${c.name} ${c.slug}`.toLowerCase().includes(companySearch.toLowerCase())).map(c => <tr key={c.id}><td>{c.name}</td><td><span className={`status-badge ${c.is_active === false ? 'status-on-hold' : 'status-available'}`}>{c.is_active === false ? 'On Hold' : 'Active'}</span></td><td>{c.is_active === false ? 'Unavailable while on hold' : <a href={`/?public=1&company=${c.slug}`} target="_blank" rel="noreferrer">Open listing ↗</a>}</td><td><button className="action-link" onClick={() => { setSelectedCompanyId(c.id); setActiveTab('All Properties'); }}>Manage</button></td><td><button className="cancel-button" onClick={() => toggleCompanyAccess(c)}>{c.is_active === false ? 'Restore Company' : 'Hold Company'}</button></td></tr>)}{!companies.some(c => `${c.name} ${c.slug}`.toLowerCase().includes(companySearch.toLowerCase())) && <tr><td colSpan="5">No company found.</td></tr>}</tbody></table></div>
            </div>
          ) : activeTab === 'Company Settings' ? (
            <div className="property-section company-settings">
              <div className="section-heading"><div><h2>Company Settings</h2><p>Update your company identity and public listing appearance.</p></div></div>
              <form className="property-form settings-form" onSubmit={async e => { e.preventDefault(); const targetId = isSuperAdmin ? activeCompanyId : companyId; if (!targetId) return alert('Select a company first.'); const { data, error } = await supabase.from('companies').update(companySettings).eq('id', targetId).select('*').single(); if (error) return alert('Update failed: ' + error.message); setCompanyInfo(data); if (isSuperAdmin) setCompanies(prev => prev.map(c => c.id === data.id ? data : c)); alert('Company settings updated.'); }}>
                {isSuperAdmin && <label>Select Company<select value={activeCompanyId || ''} onChange={e => { setSelectedCompanyId(e.target.value); const c = companies.find(x => x.id === e.target.value); if (c) setCompanySettings({ name: c.name, logo_url: c.logo_url || '', theme_color: c.theme_color || '#b9955b', text_color: c.text_color || '#ffffff', theme_preset: c.theme_preset || 'ivory-gold' }); }}>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
                <label>Company Name<input value={companySettings.name} onChange={e => setCompanySettings(p => ({ ...p, name: e.target.value }))} required /></label>
                <label>Logo URL<input type="url" value={companySettings.logo_url} onChange={e => setCompanySettings(p => ({ ...p, logo_url: e.target.value }))} placeholder="https://..." /></label>
                <label className="theme-choice-label">Website Theme<select value={companySettings.theme_preset || 'ivory-gold'} onChange={e => setCompanySettings(p => ({ ...p, theme_preset: e.target.value }))}><option value="ivory-gold">Ivory & Champagne — Signature Luxury</option><option value="charcoal-gold">Charcoal & Champagne — Modern Luxe</option><option value="warm-beige">Warm Beige — Contemporary</option><option value="forest-stone">Forest & Stone — Estate Classic</option></select><small>This theme applies across Viewer, Admin and Super Admin workspace for this company.</small></label>
                <div className="settings-colour-row"><label>Accent Colour<input type="color" value={companySettings.theme_color} onChange={e => setCompanySettings(p => ({ ...p, theme_color: e.target.value }))} /><small>Custom accent override</small></label><label>Accent Text Colour<input type="color" value={companySettings.text_color} onChange={e => setCompanySettings(p => ({ ...p, text_color: e.target.value }))} /><small>Text on accent surfaces</small></label></div>
                <button className="add-button">Save Company Settings</button>
              </form>
            </div>
          ) : activeTab === 'Manage Admins' && isSuperAdmin ? (

            <div className="property-section">

              <div className="section-heading">

                <div><h2>Manage Admins</h2><p>Admins are shown only for the selected company.</p></div>

              </div>



              <div className="admin-company-filter"><label>Selected Company<select value={selectedCompanyId} onChange={e => setSelectedCompanyId(e.target.value)}>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
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
                              <button className="cancel-button" onClick={() => toggleAdminAccess(admin)}>{admin.is_active === false ? 'Restore' : 'Hold Access'}</button>
                              <button className="cancel-button" onClick={() => removeAdmin(admin)}>Remove</button>
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



              {false ? (

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
