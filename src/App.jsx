
import { useState, useEffect } from 'react'
import JSZip from 'jszip'
import './App.css'
import { supabase } from './supabase'
import { uploadToCloudinary } from './cloudinary'

const initialProperties = [
  { id: '1125', sector: 'Sector 39', type: '1RK Studio', rent: 18000, caretaker: 'Rahul', phone: '9876543210', status: 'Available', location: '', map: '', details: '', media_urls: [] },
  { id: '582P', sector: 'Sector 43', type: '1BHK', rent: 40000, caretaker: 'Amit', phone: '9876543211', status: 'Available', location: '', map: '', details: '', media_urls: [] },
  { id: '513', sector: 'Sector 52', type: '1RK', rent: 16000, caretaker: 'Vikas', phone: '9876543212', status: 'Available', location: '', map: '', details: '', media_urls: [] },
  { id: '1191C', sector: 'Sector 43', type: '1RK', rent: 15000, caretaker: 'Rohit', phone: '9876543213', status: 'Occupied', location: '', map: '', details: '', media_urls: [] },
]

const emptyForm = {
  id: '',
  sector: '',
  location: '',
  type: '1RK',
  rent: '',
  caretaker: '',
  phone: '',
  map: '',
  details: '',
  status: 'Available',
}

function isVideo(url) {
  return /\/video\/upload\//i.test(url) || /\.(mp4|mov|webm)(\?|$)/i.test(url)
}

async function downloadGalleryAsZip(property) {
  const urls = property.media_urls || []

  if (!urls.length) {
    alert('No photos or videos available.')
    return
  }

  try {
    const zip = new JSZip()
    const folder = zip.folder(`Property-${property.id}`)

    for (let i = 0; i < urls.length; i++) {
      const response = await fetch(urls[i])

      if (!response.ok) {
        throw new Error(`Could not download file ${i + 1}`)
      }

      const blob = await response.blob()
      const extension = blob.type.split('/')[1]?.split(';')[0] || 'file'

      folder.file(`Media-${i + 1}.${extension}`, blob)
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const downloadUrl = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')

    link.href = downloadUrl
    link.download = `Property-${property.id}.zip`
    document.body.appendChild(link)
    link.click()
    link.remove()

    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
  } catch (error) {
    console.error(error)
    alert('Download failed: ' + error.message)
  }
}

function App() {
  const [properties, setProperties] = useState(initialProperties)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('Dashboard')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [media, setMedia] = useState([])
  const [saving, setSaving] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState(null)
  const [previewMedia, setPreviewMedia] = useState(null)
  const [editingProperty, setEditingProperty] = useState(false)
  const [editingOriginalId, setEditingOriginalId] = useState(null)
  const [selectedMedia, setSelectedMedia] = useState([])

  useEffect(() => {
    const fetchProperties = async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error loading properties:', error)
        return
      }

      if (data) {
        setProperties(data.map(item => ({
          id: item.property_number,
          sector: item.sector || '',
          location: item.location || '',
          type: item.property_type || '',
          rent: Number(item.rent) || 0,
          caretaker: item.caretaker_name || '',
          phone: item.caretaker_phone || '',
          map: item.map_link || '',
          details: item.details || '',
          status: item.status || 'Available',
          media_urls: item.media_urls || [],
        })))
      }
    }

    fetchProperties()
  }, [])

  const filtered = properties.filter(property =>
    Object.values(property).some(value =>
      String(value).toLowerCase().includes(search.toLowerCase())
    )
  )

  const updateForm = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
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
      details: property.details || '',
      status: property.status || 'Available',
    })

    setEditingOriginalId(property.id)
    setEditingProperty(true)
    setMedia([])
    setSelectedProperty(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingProperty(false)
    setEditingOriginalId(null)
    setForm(emptyForm)
    setMedia([])
  }

  const addProperty = async (e) => {
    e.preventDefault()

    if (saving) return

    const newId = form.id.trim()

    if (!newId) {
      alert('Property number is required.')
      return
    }

    const duplicate = properties.some(p =>
      p.id.toLowerCase() === newId.toLowerCase() &&
      (!editingProperty || p.id !== editingOriginalId)
    )

    if (duplicate) {
      alert('This Property Number already exists.')
      return
    }

    setSaving(true)

    try {
      const uploadedUrls = await Promise.all(
        media.map(file => uploadToCloudinary(file))
      )

      const existingProperty = editingProperty
        ? properties.find(p => p.id === editingOriginalId)
        : null

      const allMediaUrls = [
        ...(existingProperty?.media_urls || []),
        ...uploadedUrls,
      ]

      const propertyData = {
        property_number: newId,
        sector: form.sector,
        location: form.location,
        property_type: form.type,
        rent: Number(form.rent),
        caretaker_name: form.caretaker,
        caretaker_phone: form.phone,
        map_link: form.map,
        details: form.details,
        status: form.status,
        media_urls: allMediaUrls,
      }

      if (editingProperty) {
        const { error } = await supabase
          .from('properties')
          .update(propertyData)
          .eq('property_number', editingOriginalId)

        if (error) throw error

        setProperties(prev => prev.map(p =>
          p.id === editingOriginalId
            ? {
                id: newId,
                sector: form.sector,
                location: form.location,
                type: form.type,
                rent: Number(form.rent),
                caretaker: form.caretaker,
                phone: form.phone,
                map: form.map,
                details: form.details,
                status: form.status,
                media_urls: allMediaUrls,
              }
            : p
        ))

        alert('Property updated successfully!')
      } else {
        const { error } = await supabase
          .from('properties')
          .insert([propertyData])

        if (error) throw error

        setProperties(prev => [
          {
            id: newId,
            sector: form.sector,
            location: form.location,
            type: form.type,
            rent: Number(form.rent),
            caretaker: form.caretaker,
            phone: form.phone,
            map: form.map,
            details: form.details,
            status: form.status,
            media_urls: allMediaUrls,
          },
          ...prev,
        ])

        alert('Property saved successfully!')
      }

      closeForm()
      setActiveTab('All Properties')
    } catch (error) {
      console.error(error)
      alert('Error: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteProperty = async (property) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete property ${property.id}? This cannot be undone.`
    )

    if (!confirmed) return

    try {
      const { error } = await supabase
        .from('properties')
        .delete()
        .eq('property_number', property.id)

      if (error) throw error

      setProperties(prev => prev.filter(p => p.id !== property.id))
      setSelectedProperty(null)

      alert('Property deleted successfully!')
    } catch (error) {
      console.error(error)
      alert('Delete failed: ' + error.message)
    }
  }

  // Save updated gallery URLs to Supabase and the screen
  const saveGallery = async (property, newUrls) => {
    const { error } = await supabase
      .from('properties')
      .update({ media_urls: newUrls })
      .eq('property_number', property.id)

    if (error) throw error

    const updatedProperty = {
      ...property,
      media_urls: newUrls,
    }

    setProperties(prev =>
      prev.map(p => p.id === property.id ? updatedProperty : p)
    )

    setSelectedProperty(updatedProperty)
    setSelectedMedia([])
  }

  // Remove one or multiple selected gallery files
  const removeSelectedMedia = async () => {
    if (!selectedProperty || selectedMedia.length === 0) return

    const confirmed = window.confirm(
      `Remove ${selectedMedia.length} selected file(s) from this property gallery?`
    )

    if (!confirmed) return

    try {
      const newUrls = selectedProperty.media_urls.filter(
        url => !selectedMedia.includes(url)
      )

      await saveGallery(selectedProperty, newUrls)
      alert('Selected media removed from gallery.')
    } catch (error) {
      console.error(error)
      alert('Could not update gallery: ' + error.message)
    }
  }

  // Remove one file
  const removeOneMedia = async (url) => {
    const confirmed = window.confirm('Remove this file from the gallery?')
    if (!confirmed) return

    try {
      const newUrls = selectedProperty.media_urls.filter(
        item => item !== url
      )

      await saveGallery(selectedProperty, newUrls)
      alert('File removed from gallery.')
    } catch (error) {
      console.error(error)
      alert('Could not remove file: ' + error.message)
    }
  }

  // Replace one image or video with a newly uploaded file
  const replaceMedia = async (oldUrl, file) => {
    if (!file) return

    const confirmed = window.confirm('Replace this photo/video with the selected file?')
    if (!confirmed) return

    try {
      const newUrl = await uploadToCloudinary(file)

      const newUrls = selectedProperty.media_urls.map(url =>
        url === oldUrl ? newUrl : url
      )

      await saveGallery(selectedProperty, newUrls)
      alert('Media replaced successfully!')
    } catch (error) {
      console.error(error)
      alert('Replace failed: ' + error.message)
    }
  }

  const toggleMediaSelection = (url) => {
    setSelectedMedia(prev =>
      prev.includes(url)
        ? prev.filter(item => item !== url)
        : [...prev, url]
    )
  }

  const toggleSelectAll = () => {
    const urls = selectedProperty?.media_urls || []

    if (selectedMedia.length === urls.length) {
      setSelectedMedia([])
    } else {
      setSelectedMedia([...urls])
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">P</div>
          <span>Property<span className="green">Hub</span></span>
        </div>

        <p className="menu-label">WORKSPACE</p>

        {['Dashboard', 'All Properties', 'Location Assistant'].map(item => (
          <button
            key={item}
            className={`nav-item ${activeTab === item ? 'active' : ''}`}
            onClick={() => setActiveTab(item)}
          >
            <span>
              {item === 'Dashboard' ? '▦' :
                item === 'All Properties' ? '⌂' : '◎'}
            </span>
            {item}
          </button>
        ))}

        <div className="sidebar-bottom">
          <div className="company-card">
            <div className="company-icon">F</div>
            <div>
              <strong>FNF Properties</strong>
              <small>Company workspace</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace /</span>
            <strong>{activeTab}</strong>
          </div>

          <div className="profile">
            <div className="avatar">A</div>
            <div>
              <strong>Admin</strong>
              <small>Administrator</small>
            </div>
          </div>
        </header>

        <section className="content">
          <div className="welcome">
            <div>
              <p className="eyebrow">PROPERTY MANAGEMENT</p>
              <h1>
                {activeTab === 'Dashboard' ? 'Good day, Admin 👋' : activeTab}
              </h1>
              <p className="subheading">
                Manage your properties from one place.
              </p>
            </div>

            <button
              className="add-button"
              onClick={() => {
                setEditingProperty(false)
                setEditingOriginalId(null)
                setForm(emptyForm)
                setMedia([])
                setShowForm(true)
              }}
            >
              + Add Property
            </button>
          </div>

          <div className="stats">
            <div className="stat-card">
              <span>Total Properties</span>
              <strong>{properties.length}</strong>
              <small>Added to this workspace</small>
            </div>

            <div className="stat-card">
              <span>Available</span>
              <strong className="green">
                {properties.filter(p => p.status === 'Available').length}
              </strong>
              <small>Ready for occupancy</small>
            </div>

            <div className="stat-card">
              <span>Occupied</span>
              <strong>
                {properties.filter(p => p.status === 'Occupied').length}
              </strong>
              <small>Currently rented</small>
            </div>

            <div className="stat-card">
              <span>Locations</span>
              <strong>
                {new Set(properties.map(p => p.sector).filter(Boolean)).size}
              </strong>
              <small>Unique sectors</small>
            </div>
          </div>

          <div className="property-section">
            <div className="section-heading">
              <div>
                <h2>Property Directory</h2>
                <p>Search by property number, sector, caretaker, rent or type.</p>
              </div>
              <span className="count">{filtered.length} shown</span>
            </div>

            <div className="search-box">
              <span>⌕</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search any property detail..."
              />
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>PROPERTY</th>
                    <th>LOCATION</th>
                    <th>TYPE</th>
                    <th>MONTHLY RENT</th>
                    <th>CARETAKER</th>
                    <th>STATUS</th>
                    <th>MEDIA</th>
                    <th>ACTION</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map(property => (
                    <tr key={property.id}>
                      <td><strong>#{property.id}</strong></td>
                      <td>{property.sector}</td>
                      <td>{property.type}</td>
                      <td>₹{Number(property.rent).toLocaleString('en-IN')}</td>
                      <td>{property.caretaker}</td>
                      <td>
                        <span className={`status ${property.status === 'Available' ? 'available' : 'occupied'}`}>
                          {property.status}
                        </span>
                      </td>
                      <td>
                        {property.media_urls?.length
                          ? `${property.media_urls.length} files`
                          : 'No media'}
                      </td>
                      <td>
                        <button
                          className="action-link view-button"
                          onClick={() => {
                            setSelectedProperty(property)
                            setSelectedMedia([])
                          }}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan="8" className="empty">
                        No matching properties found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="footer-note">
            PropertyHub · Smart Property Management
          </p>
        </section>
      </main>

      {showForm && (
        <div className="modal-overlay">
          <form className="property-form" onSubmit={addProperty}>
            <div className="form-heading">
              <div>
                <p className="eyebrow">
                  {editingProperty ? 'UPDATE LISTING' : 'NEW LISTING'}
                </p>
                <h2>{editingProperty ? 'Edit Property' : 'Add Property'}</h2>
              </div>

              <button type="button" className="close-button" onClick={closeForm}>
                ×
              </button>
            </div>

            <div className="form-grid">
              <label>
                Property Number *
                <input name="id" value={form.id} onChange={updateForm} required />
              </label>

              <label>
                Sector *
                <input name="sector" value={form.sector} onChange={updateForm} required />
              </label>

              <label className="full-field">
                Full Location / Address
                <input name="location" value={form.location} onChange={updateForm} />
              </label>

              <label>
                Property Type *
                <select name="type" value={form.type} onChange={updateForm}>
                  {['1RK', '1RK Studio', '1BHK', '2BHK', '3BHK', 'Other'].map(type => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label>
                Monthly Rent (₹) *
                <input name="rent" type="number" min="0" value={form.rent} onChange={updateForm} required />
              </label>

              <label>
                Caretaker Name
                <input name="caretaker" value={form.caretaker} onChange={updateForm} />
              </label>

              <label>
                Caretaker Phone
                <input name="phone" type="tel" value={form.phone} onChange={updateForm} />
              </label>

              <label className="full-field">
                Google Maps Link
                <input name="map" type="url" value={form.map} onChange={updateForm} />
              </label>

              <label>
                Status
                <select name="status" value={form.status} onChange={updateForm}>
                  <option>Available</option>
                  <option>Occupied</option>
                  <option>On Hold</option>
                </select>
              </label>

              <label className="full-field">
                Special Details
                <textarea name="details" value={form.details} onChange={updateForm} rows="3" />
              </label>

              <label className="full-field">
                Add More Photos & Videos
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
              <button type="button" className="cancel-button" onClick={closeForm} disabled={saving}>
                Cancel
              </button>

              <button type="submit" className="add-button" disabled={saving}>
                {saving ? 'Uploading & Saving...' : editingProperty ? 'Update Property' : 'Save Property'}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedProperty && (
        <div className="modal-overlay" onClick={() => setSelectedProperty(null)}>
          <div className="details-modal" onClick={e => e.stopPropagation()}>
            <div className="form-heading">
              <div>
                <p className="eyebrow">PROPERTY DETAILS</p>
                <h2>#{selectedProperty.id}</h2>
                <p className="subheading">
                  {selectedProperty.sector} · {selectedProperty.type}
                </p>
              </div>

              <button className="close-button" onClick={() => setSelectedProperty(null)}>
                ×
              </button>
            </div>

            <div className="details-grid">
              <div>
                <small>Monthly Rent</small>
                <strong>₹{Number(selectedProperty.rent).toLocaleString('en-IN')}</strong>
              </div>
              <div>
                <small>Status</small>
                <strong>{selectedProperty.status}</strong>
              </div>
              <div>
                <small>Caretaker</small>
                <strong>{selectedProperty.caretaker || 'Not added'}</strong>
              </div>
              <div>
                <small>Phone</small>
                <strong>{selectedProperty.phone || 'Not added'}</strong>
              </div>
            </div>

            {selectedProperty.location && (
              <p className="detail-line">
                <strong>Address:</strong> {selectedProperty.location}
              </p>
            )}

            {selectedProperty.details && (
              <p className="detail-line">
                <strong>Special Details:</strong> {selectedProperty.details}
              </p>
            )}

            <div className="gallery-heading">
              <div>
                <h3>Photos & Videos</h3>
                <p>{selectedProperty.media_urls?.length || 0} media files</p>
              </div>

              {selectedProperty.media_urls?.length > 0 && (
                <button
                  className="add-button"
                  onClick={() => downloadGalleryAsZip(selectedProperty)}
                >
                  Download All ZIP
                </button>
              )}
            </div>

            {selectedProperty.media_urls?.length > 0 ? (
              <>
                <div className="gallery-tools">
                  <label className="select-all-label">
                    <input
                      type="checkbox"
                      checked={
                        selectedProperty.media_urls.length > 0 &&
                        selectedMedia.length === selectedProperty.media_urls.length
                      }
                      onChange={toggleSelectAll}
                    />
                    Select All
                  </label>

                  <span>{selectedMedia.length} selected</span>

                  <button
                    className="cancel-button"
                    onClick={removeSelectedMedia}
                    disabled={selectedMedia.length === 0}
                  >
                    Delete Selected
                  </button>
                </div>

                <div className="media-gallery">
                  {selectedProperty.media_urls.map((url, index) => (
                    <div className="gallery-item" key={url}>
                      <label className="media-select-label">
                        <input
                          type="checkbox"
                          checked={selectedMedia.includes(url)}
                          onChange={() => toggleMediaSelection(url)}
                        />
                        Select
                      </label>

                      {isVideo(url) ? (
                        <video src={url} controls preload="metadata" />
                      ) : (
                        <button
                          className="gallery-image-button"
                          onClick={() => setPreviewMedia(url)}
                        >
                          <img
                            src={url}
                            alt={`Property ${selectedProperty.id} ${index + 1}`}
                          />
                          <span>View photo</span>
                        </button>
                      )}

                      <div className="media-management-actions">
                        <label className="replace-media-button">
                          Replace
                          <input
                            type="file"
                            accept="image/*,video/*"
                            hidden
                            onChange={e => {
                              replaceMedia(url, e.target.files?.[0])
                              e.target.value = ''
                            }}
                          />
                        </label>

                        <button
                          className="media-delete-button"
                          onClick={() => removeOneMedia(url)}
                        >
                          Delete
                        </button>
                      </div>

                      <a
                        className="media-download"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open / Download
                      </a>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="no-media">
                No photos or videos uploaded for this property yet.
              </div>
            )}

            <div className="details-actions">
              <button
                className="add-button"
                onClick={() => openEditForm(selectedProperty)}
              >
                Edit Property
              </button>

              <button
                className="cancel-button"
                onClick={() => deleteProperty(selectedProperty)}
              >
                Delete Property
              </button>

              {selectedProperty.phone && (
                <a className="add-button" href={`tel:${selectedProperty.phone}`}>
                  Call Caretaker
                </a>
              )}

              {selectedProperty.map && (
                <a className="action-link" href={selectedProperty.map} target="_blank" rel="noreferrer">
                  Open Map ↗
                </a>
              )}

              <button
                className="cancel-button"
                onClick={() => setSelectedProperty(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {previewMedia && (
        <div
          className="image-preview-overlay"
          onClick={() => setPreviewMedia(null)}
        >
          <button
            className="preview-close"
            onClick={() => setPreviewMedia(null)}
          >
            ×
          </button>

          <img
            src={previewMedia}
            alt="Property full preview"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

export default App
