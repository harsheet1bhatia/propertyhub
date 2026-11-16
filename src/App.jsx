
import { useState, useEffect } from 'react'
import JSZip from 'jszip'
import './App.css'
import { supabase } from './supabase'
import { uploadToCloudinary } from './cloudinary'

const emptyForm = {
  id: '', sector: '', location: '', type: '1RK', rent: '',
  caretaker: '', phone: '', map: '', details: '', status: 'Available'
}

const isPublic = new URLSearchParams(window.location.search).get('public') === '1'

function isVideo(url) {
  return /\/video\/upload\//i.test(url) || /\.(mp4|mov|webm)(\?|$)/i.test(url)
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
      folder.file(`Media-${i + 1}.${blob.type.split('/')[1]?.split(';')[0] || 'file'}`, blob)
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Property-${property.id}.zip`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    alert('ZIP download failed: ' + error.message)
  }
}

function App() {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(!isPublic)
  const [email, setEmail] = useState('')
const [newPassword, setNewPassword] = useState('')
const [confirmPassword, setConfirmPassword] = useState('')
  const [properties, setProperties] = useState([])
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
  const [adminEmail, setAdminEmail] = useState('')
  const [admins, setAdmins] = useState([])

  const isAdmin = role === 'admin' || role === 'super_admin'
  const isPasswordSetup =
  new URLSearchParams(window.location.search).get('set-password') === '1'

const setAdminPassword = async (e) => {
  e.preventDefault()

  if (newPassword.length < 8) {
    alert('Password must be at least 8 characters.')
    return
  }

  if (newPassword !== confirmPassword) {
    alert('Passwords do not match.')
    return
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword
  })

  if (error) {
    alert('Password setup failed: ' + error.message)
    return
  }

  window.history.replaceState({}, '', window.location.pathname)
  setNewPassword('')
  setConfirmPassword('')
  alert('Password set successfully! Welcome to PropertyHub.')
  window.location.reload()
}

  // Check login session
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

  // Load role and admin list
  useEffect(() => {
    if (!session?.user) {
      setRole(null)
      return
    }

    let active = true

    async function loadRole() {
      const { data, error } = await supabase
        .from('propertyhub_admins')
        .select('role')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (!active) return

      if (error || !data) {
        setRole(null)
        return
      }

      setRole(data.role)
    }

    loadRole()
    return () => { active = false }
  }, [session])

  // Load properties
  useEffect(() => {
    if (!isPublic && !session) return
    if (!isPublic && session && role === null) return

    async function loadProperties() {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error(error)
        return
      }

      setProperties((data || []).map(item => ({
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
        media_urls: item.media_urls || []
      })))
    }

    loadProperties()
  }, [session, role])

  // Load admins for Super Admin
  useEffect(() => {
    if (!isSuperAdmin) return

    async function loadAdmins() {
      const { data, error } = await supabase
        .from('propertyhub_admins')
        .select('user_id,email,role,created_at')
        .order('created_at', { ascending: true })

      if (!error) setAdmins(data || [])
      else console.error(error)
    }

    loadAdmins()
  }, [isSuperAdmin])

  const filtered = properties.filter(property =>
    Object.values(property).some(value =>
      String(value).toLowerCase().includes(search.toLowerCase())
    )
  )

  const login = async (e) => {
    e.preventDefault()
    setLoading(true)

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    })

    setLoading(false)

    if (error) {
      alert('Login failed: ' + error.message)
      return
    }

    setSession(data.session)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setRole(null)
  }

 
  const addAdmin = async (e) => {
    e.preventDefault();

    if (!adminEmail.trim()) return;

    const { data: { session: currentSession } } =
      await supabase.auth.getSession();

    if (!currentSession) {
      alert('Please login again.');
      return;
    }

    const { data, error } = await supabase.functions.invoke('add-admin', {
      body: { email: adminEmail.trim() },
    });

    if (error || data?.error) {
      alert('Could not send invitation: ' + (data?.error || error.message));
      return;
    }

    alert('Invitation sent successfully to ' + adminEmail.trim());
    setAdminEmail('');

    const { data: updatedAdmins } = await supabase
      .from('propertyhub_admins')
      .select('user_id,email,role,created_at')
      .order('created_at', { ascending: true });

    setAdmins(updatedAdmins || []);
  };

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
      status: property.status || 'Available'
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
      const uploadedUrls = await Promise.all(
        media.map(file => uploadToCloudinary(file))
      )

      const existing = editingProperty
        ? properties.find(p => p.id === editingOriginalId)
        : null

      const allMediaUrls = [...(existing?.media_urls || []), ...uploadedUrls]

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
        media_urls: allMediaUrls
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
                id: newId, sector: form.sector, location: form.location,
                type: form.type, rent: Number(form.rent),
                caretaker: form.caretaker, phone: form.phone,
                map: form.map, details: form.details,
                status: form.status, media_urls: allMediaUrls
              }
            : p
        ))

        alert('Property updated successfully!')
      } else {
        const { error } = await supabase
          .from('properties')
          .insert([propertyData])

        if (error) throw error

        setProperties(prev => [{
          id: newId, sector: form.sector, location: form.location,
          type: form.type, rent: Number(form.rent),
          caretaker: form.caretaker, phone: form.phone,
          map: form.map, details: form.details,
          status: form.status, media_urls: allMediaUrls
        }, ...prev])

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
    setSelectedProperty(null)
    alert('Property deleted.')
  }

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
      await saveGallery(
        selectedProperty,
        selectedProperty.media_urls.filter(item => item !== url)
      )
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
      const newUrls = selectedProperty.media_urls.map(url =>
        url === oldUrl ? newUrl : url
      )
      await saveGallery(selectedProperty, newUrls)
      alert('Media replaced.')
    } catch (error) {
      alert('Replace failed: ' + error.message)
    }
  }

  if (loading) {
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

            <div className="search-box">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search properties..."
              />
            </div>

            <div className="property-section">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>PROPERTY</th><th>LOCATION</th><th>TYPE</th>
                      <th>RENT</th><th>CARETAKER</th><th>PHONE</th><th>STATUS</th><th>DETAILS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(property => (
                      <tr key={property.id}>
                        <td>#{property.id}</td>
                        <td>{property.sector}</td>
                        <td>{property.type}</td>
                        <td>₹{Number(property.rent).toLocaleString('en-IN')}</td>
                        <td>{property.caretaker || 'Not added'}</td>
                        <td>
                          {property.phone
                            ? <a href={`tel:${property.phone}`}>{property.phone}</a>
                            : 'Not added'}
                        </td>
                        <td>{property.status}</td>
                        <td>
                          <button className="action-link" onClick={() => setSelectedProperty(property)}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedProperty && (
              <div className="modal-overlay" onClick={() => setSelectedProperty(null)}>
                <div className="details-modal" onClick={e => e.stopPropagation()}>
                  <div className="form-heading">
                    <div>
                      <p className="eyebrow">PROPERTY DETAILS</p>
                      <h2>#{selectedProperty.id}</h2>
                      <p>{selectedProperty.sector} · {selectedProperty.type}</p>
                    </div>
                    <button className="close-button" onClick={() => setSelectedProperty(null)}>×</button>
                  </div>

                  <div className="details-grid">
                    <div><small>Rent</small><strong>₹{Number(selectedProperty.rent).toLocaleString('en-IN')}</strong></div>
                    <div><small>Status</small><strong>{selectedProperty.status}</strong></div>
                    <div><small>Caretaker</small><strong>{selectedProperty.caretaker || 'Not added'}</strong></div>
                    <div><small>Phone</small><strong>{selectedProperty.phone || 'Not added'}</strong></div>
                  </div>

                  {selectedProperty.location && <p className="detail-line">Address: {selectedProperty.location}</p>}
                  {selectedProperty.details && <p className="detail-line">{selectedProperty.details}</p>}

                  {selectedProperty.map && (
                    <p><a href={selectedProperty.map} target="_blank" rel="noreferrer">Open Google Map</a></p>
                  )}

                  <div className="media-gallery">
                    {(selectedProperty.media_urls || []).map((url, index) => (
                      <div className="gallery-item" key={url}>
                        {isVideo(url)
                          ? <video src={url} controls />
                          : <button className="gallery-image-button" onClick={() => setPreviewMedia(url)}>
                              <img src={url} alt={`Property ${index + 1}`} />
                            </button>}
                      </div>
                    ))}
                  </div>

                  <button className="cancel-button" onClick={() => setSelectedProperty(null)}>Close</button>
                </div>
              </div>
            )}

            {previewMedia && (
              <div className="image-preview-overlay" onClick={() => setPreviewMedia(null)}>
                <button className="preview-close">×</button>
                <img src={previewMedia} alt="Property preview" />
              </div>
            )}
          </section>
        </main>
      </div>
    )
  }

  // New Admin Password Setup
if (isPasswordSetup && session) {
  return (
    <div className="login-screen">
      <form className="property-form" onSubmit={setAdminPassword}>
        <div className="brand">
          <div className="brand-icon">P</div>
          <span>Property<span className="green">Hub</span></span>
        </div>

        <h2>Set Your Password</h2>
        <p>Create a password for your PropertyHub admin account.</p>

        <label>New Password
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            minLength="8"
            required
          />
        </label>

        <label>Confirm Password
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            minLength="8"
            required
          />
        </label>

        <button className="add-button" type="submit">
          Set Password
        </button>
      </form>
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
          <p>Sign in with your authorized admin account.</p>

          <label>Email Address
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </label>

          <label>Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </label>

          <button className="add-button" type="submit">Login</button>
        </form>
      </div>
    )
  }

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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">P</div>
          <span>Property<span className="green">Hub</span></span>
        </div>

        <p className="menu-label">WORKSPACE</p>

        {['Dashboard', 'All Properties', ...(isSuperAdmin ? ['Manage Admins'] : [])].map(item => (
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
            <div><strong>FNF Properties</strong><small>{role === 'super_admin' ? 'Super Admin' : 'Admin'}</small></div>
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
                Invitation will be sent by email. The admin can set their own password.
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
                          {admin.role !== 'super_admin' &&
                            <button className="cancel-button" onClick={() => removeAdmin(admin)}>Remove</button>}
                        </td>
                      </tr>
                    ))}
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
                  {isAdmin && (
                    <button className="add-button" onClick={() => {
                      setForm(emptyForm)
                      setMedia([])
                      setEditingProperty(false)
                      setEditingOriginalId(null)
                      setShowForm(true)
                    }}>+ Add Property</button>
                  )}
                </div>
              </div>

              <div className="stats">
                <div className="stat-card"><span>Total Properties</span><strong>{properties.length}</strong></div>
                <div className="stat-card"><span>Available</span><strong className="green">{properties.filter(p => p.status === 'Available').length}</strong></div>
                <div className="stat-card"><span>Occupied</span><strong>{properties.filter(p => p.status === 'Occupied').length}</strong></div>
                <div className="stat-card"><span>Locations</span><strong>{new Set(properties.map(p => p.sector).filter(Boolean)).size}</strong></div>
              </div>

              <div className="property-section">
                <div className="section-heading">
                  <div><h2>Property Directory</h2><p>Search by property number, sector, caretaker, rent or type.</p></div>
                  <span className="count">{filtered.length} shown</span>
                </div>

                <div className="search-box">
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search any property detail..." />
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>PROPERTY</th><th>LOCATION</th><th>TYPE</th><th>MONTHLY RENT</th>
                        <th>CARETAKER</th><th>STATUS</th><th>MEDIA</th><th>ACTION</th>
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
                          <td>{property.status}</td>
                          <td>{property.media_urls?.length || 0} files</td>
                          <td>
                            <button className="action-link" onClick={() => {
                              setSelectedProperty(property)
                              setSelectedMedia([])
                            }}>View Details</button>
                          </td>
                        </tr>
                      ))}
                      {!filtered.length && <tr><td colSpan="8">No properties found.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {showForm && isAdmin && (
        <div className="modal-overlay">
          <form className="property-form" onSubmit={addProperty}>
            <div className="form-heading">
              <div><p className="eyebrow">{editingProperty ? 'UPDATE LISTING' : 'NEW LISTING'}</p><h2>{editingProperty ? 'Edit Property' : 'Add Property'}</h2></div>
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
                  {['1RK', '1RK Studio', '1BHK', '2BHK', '3BHK', 'Other'].map(t => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label>Monthly Rent
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
              <label>Status
                <select name="status" value={form.status} onChange={updateForm}>
                  <option>Available</option><option>Occupied</option><option>On Hold</option>
                </select>
              </label>
              <label className="full-field">Special Details
                <textarea name="details" value={form.details} onChange={updateForm} rows="3" />
              </label>
              <label className="full-field">Add Photos & Videos
                <input type="file" accept="image/*,video/*" multiple onChange={e => setMedia(Array.from(e.target.files || []))} />
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

      {selectedProperty && (
        <div className="modal-overlay" onClick={() => setSelectedProperty(null)}>
          <div className="details-modal" onClick={e => e.stopPropagation()}>
            <div className="form-heading">
              <div><p className="eyebrow">PROPERTY DETAILS</p><h2>#{selectedProperty.id}</h2><p>{selectedProperty.sector} · {selectedProperty.type}</p></div>
              <button className="close-button" onClick={() => setSelectedProperty(null)}>×</button>
            </div>

            <div className="details-grid">
              <div><small>Monthly Rent</small><strong>₹{Number(selectedProperty.rent).toLocaleString('en-IN')}</strong></div>
              <div><small>Status</small><strong>{selectedProperty.status}</strong></div>
              <div><small>Caretaker</small><strong>{selectedProperty.caretaker || 'Not added'}</strong></div>
              <div><small>Phone</small><strong>{selectedProperty.phone || 'Not added'}</strong></div>
            </div>

            {selectedProperty.location && <p className="detail-line"><strong>Address:</strong> {selectedProperty.location}</p>}
            {selectedProperty.details && <p className="detail-line"><strong>Details:</strong> {selectedProperty.details}</p>}

            <div className="gallery-heading">
              <div><h3>Photos & Videos</h3><p>{selectedProperty.media_urls?.length || 0} files</p></div>
              {selectedProperty.media_urls?.length > 0 && (
                <button className="add-button" onClick={() => downloadGalleryAsZip(selectedProperty)}>Download All ZIP</button>
              )}
            </div>

            {isAdmin && selectedProperty.media_urls?.length > 0 && (
              <div className="gallery-tools">
                <button className="cancel-button" onClick={() => setSelectedMedia(
                  selectedMedia.length === selectedProperty.media_urls.length ? [] : [...selectedProperty.media_urls]
                )}>Select All / None</button>
                <span>{selectedMedia.length} selected</span>
                <button className="cancel-button" onClick={removeSelectedMedia} disabled={!selectedMedia.length}>Delete Selected</button>
              </div>
            )}

            <div className="media-gallery">
              {(selectedProperty.media_urls || []).map((url, index) => (
                <div className="gallery-item" key={url}>
                  {isAdmin && (
                    <label>
                      <input type="checkbox" checked={selectedMedia.includes(url)}
                        onChange={() => setSelectedMedia(prev => prev.includes(url) ? prev.filter(x => x !== url) : [...prev, url])} />
                      Select
                    </label>
                  )}

                  {isVideo(url)
                    ? <video src={url} controls preload="metadata" />
                    : <button className="gallery-image-button" onClick={() => setPreviewMedia(url)}>
                        <img src={url} alt={`Property ${index + 1}`} />
                        <span>View photo</span>
                      </button>}

                  {isAdmin && (
                    <div className="media-management-actions">
                      <label className="replace-media-button">Replace
                        <input type="file" accept="image/*,video/*" hidden onChange={e => {
                          replaceMedia(url, e.target.files?.[0])
                          e.target.value = ''
                        }} />
                      </label>
                      <button className="media-delete-button" onClick={() => removeOneMedia(url)}>Delete</button>
                    </div>
                  )}

                  <a className="media-download" href={url} target="_blank" rel="noreferrer">Open / Download</a>
                </div>
              ))}
            </div>

            <div className="details-actions">
              {isAdmin && <>
                <button className="add-button" onClick={() => openEditForm(selectedProperty)}>Edit Property</button>
                <button className="cancel-button" onClick={() => deleteProperty(selectedProperty)}>Delete Property</button>
              </>}
              {selectedProperty.phone && <a className="add-button" href={`tel:${selectedProperty.phone}`}>Call Caretaker</a>}
              {selectedProperty.map && <a className="action-link" href={selectedProperty.map} target="_blank" rel="noreferrer">Open Map ↗</a>}
              <button className="cancel-button" onClick={() => setSelectedProperty(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {previewMedia && (
        <div className="image-preview-overlay" onClick={() => setPreviewMedia(null)}>
          <button className="preview-close" onClick={() => setPreviewMedia(null)}>×</button>
          <img src={previewMedia} alt="Property full preview" />
        </div>
      )}
    </div>
  )
}

export default App
