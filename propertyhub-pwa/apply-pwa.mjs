// PropertyHub -> installable app. One command, zero manual editing.
//   Run from your project root (the folder with package.json):
//     node propertyhub-pwa/apply-pwa.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = process.cwd()
const appPath = path.join(root, 'src', 'App.jsx')
const htmlPath = path.join(root, 'index.html')

const fail = (msg) => { console.error('\n[X] ' + msg + '\n    Kuch bhi change nahi kiya gaya. Ye message mujhe bhej do.\n'); process.exit(1) }

if (!fs.existsSync(appPath) || !fs.existsSync(htmlPath)) fail('src/App.jsx ya index.html nahi mili. Command project ke root folder (jahan package.json hai) se chalao.')

const rawApp = fs.readFileSync(appPath, 'utf8')
const crlf = rawApp.includes('\r\n')
let src = rawApp.replace(/\r\n/g, '\n')
if (src.includes("from './pwa'")) fail('Ye pehle hi apply ho chuka hai (App.jsx mein ./pwa already hai).')

/* ---------- helpers ---------- */
function once(find, replacement, label) {
  const parts = src.split(find)
  if (parts.length !== 2) fail(label + ': ' + (parts.length - 1) + ' baar mila (1 hona chahiye).')
  src = parts.join(replacement)
}
function replaceBetween(start, end, code, label) {
  const a = src.indexOf(start)
  const b = src.indexOf(end)
  if (a < 0 || b < 0 || b < a) fail(label + ': marker comment nahi mila.')
  src = src.slice(0, a + start.length) + '\n' + code + '\n\n  ' + src.slice(b)
}
function regexOnce(re, fn, label) {
  if (!re.test(src)) fail(label + ': jagah nahi mili.')
  src = src.replace(re, fn)
}

/* ---------- 1) imports ---------- */
once("import { useState, useEffect, useMemo } from 'react'", "import { useState, useEffect, useMemo, useRef } from 'react'", 'react import')
once("import { uploadToCloudinary } from './cloudinary'",
  "import { uploadToCloudinary } from './cloudinary'\nimport { InstallButton, BottomNav, useLiveRefresh, announceChange, cacheGet, cacheSet, cacheClear, lsGet, lsSet } from './pwa'",
  'cloudinary import')

/* ---------- 2) live + instant-open state ---------- */
once('const resetFilters = () => setFilters(emptyFilters)', String.raw`const resetFilters = () => setFilters(emptyFilters)

  /* ---------- App mode: live updates + instant open ---------- */
  const [refreshTick, setRefreshTick] = useState(0)
  const freshRef = useRef(false)      // true once real data arrived from the server
  const cachedRef = useRef(false)     // true when the screen was filled from the saved copy
  const loadedForRef = useRef(null)
  const liveSlug = isPublic
    ? (isClientShare ? null : companySlug)
    : (isSuperAdmin ? companies.find(c => c.id === activeCompanyId)?.slug : companyInfo?.slug)
  useLiveRefresh({
    key: liveSlug,
    onChange: () => setRefreshTick(t => t + 1),
    dbEvents: isAdmin && !isPublic,
    enabled: isPublic || Boolean(role),
    pollMs: isPublic ? 60000 : 120000
  })`, 'resetFilters')

/* ---------- 3) effects ---------- */
const ROLE = String.raw`  useEffect(() => {
    if (!userId) {
      setRole(null)
      setCompanyId(null)
      setRoleChecked(false)
      return
    }

    let active = true
    const cachedRole = lsGet('ph_role_' + userId)
    if (cachedRole?.role) {
      setRole(cachedRole.role)
      setCompanyId(cachedRole.companyId || null)
      setRoleChecked(true)
    }

    async function loadRole() {
      const { data, error } = await supabase
        .from('propertyhub_admins')
        .select('role,company_id,is_active')
        .eq('user_id', userId)
        .maybeSingle()

      if (!active) return
      if (error && cachedRole?.role) return // no internet: keep the saved role

      const nextRole = error || !data || data.is_active === false ? null : data.role
      setRole(nextRole)
      setCompanyId(data?.company_id || null)
      setRoleChecked(true)
      lsSet('ph_role_' + userId, nextRole ? { role: nextRole, companyId: data?.company_id || null } : null)
    }

    loadRole()
    return () => { active = false }
  }, [userId])`

const WORKSPACE = String.raw`  useEffect(() => {
    let active = true
    async function loadCompanies() {
      if (isPublic) {
        if (isClientShare) {
          const { data, error } = await supabase.rpc('get_client_shared_properties', { p_token: clientShareToken })
          if (!active) return
          if (error) {
            console.error('Client share could not be loaded:', error)
            if (!cachedRef.current) {
              setClientShareError('This property link is invalid or unavailable.')
              setClientShareProperties([])
            }
          } else {
            freshRef.current = true
            setClientShareError((data || []).length ? '' : 'No properties are available on this link.')
            setClientShareProperties((data || []).map(normalizeShared))
            cacheSet('client:' + clientShareToken, data || [])
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
        if (companyRes.error) {
          console.error(companyRes.error)
          if (!cachedRef.current) setProperties([])
          setLoading(false); setListLoading(false); return
        }
        if (!companyRes.data) {
          // company missing or on hold: show nothing and forget the saved copy
          setCompanyInfo(null); setProperties([]); setPropertyTours([])
          cacheSet('pub:' + companySlug, null)
          setLoading(false); setListLoading(false); return
        }
        freshRef.current = true
        setCompanyInfo(companyRes.data)
        if (propertiesRes.error) console.error(propertiesRes.error)
        if (toursRes.error) console.error(toursRes.error)
        if (!propertiesRes.error) setProperties((propertiesRes.data || []).map(mapRow))
        if (!toursRes.error) setPropertyTours(toursRes.data || [])
        if (!propertiesRes.error && !toursRes.error) {
          cacheSet('pub:' + companySlug, { companyInfo: companyRes.data, properties: propertiesRes.data || [], tours: toursRes.data || [] })
        }
        setLoading(false)
        setListLoading(false)
        return
      }
      if (!role) return
      if (isSuperAdmin) {
        const savedList = lsGet('ph_companies')
        if (savedList?.length) {
          setCompanies(savedList)
          setSelectedCompanyId(prev => prev || savedList[0].id)
        }
        const { data, error } = await supabase.from('companies').select('*').order('created_at', { ascending: true })
        if (!active) return
        if (error) { console.error(error); return }
        setCompanies(data || [])
        lsSet('ph_companies', data || [])
        setSelectedCompanyId(prev => prev || data?.[0]?.id || '')
        if (!data?.length) setListLoading(false)
      } else if (companyId) {
        const savedCompany = lsGet('ph_company_' + companyId)
        if (savedCompany) {
          setCompanyInfo(savedCompany)
          setCompanySettings({ name: savedCompany.name || '', logo_url: savedCompany.logo_url || '', theme_color: savedCompany.theme_color || '#b08d57', text_color: savedCompany.text_color || '#ffffff' })
        }
        const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).single()
        if (!active) return
        if (error) console.error(error)
        setCompanyInfo(data || null)
        if (data) {
          lsSet('ph_company_' + companyId, data)
          setCompanySettings({ name: data.name || '', logo_url: data.logo_url || '', theme_color: data.theme_color || '#b08d57', text_color: data.text_color || '#ffffff' })
        }
      }
    }
    loadCompanies()
    return () => { active = false }
  }, [role, companyId, isSuperAdmin, isPublic, companySlug, isPublic ? refreshTick : 0])

  /* ---------- Show the last saved data instantly (viewer + client pages) ---------- */
  useEffect(() => {
    if (!isPublic) return
    let active = true
    cacheGet(isClientShare ? 'client:' + clientShareToken : 'pub:' + companySlug).then(saved => {
      if (!active || !saved || freshRef.current) return
      cachedRef.current = true
      if (isClientShare) {
        setClientShareProperties(saved.map(normalizeShared))
      } else {
        setCompanyInfo(saved.companyInfo || null)
        setProperties((saved.properties || []).map(mapRow))
        setPropertyTours(saved.tours || [])
      }
      setLoading(false)
      setListLoading(false)
    })
    return () => { active = false }
  }, [])`

const PROPS = String.raw`  useEffect(() => {
    if (isPublic) return
    if (!role || !activeCompanyId) { setProperties([]); return }
    let active = true
    let fresh = false
    if (loadedForRef.current !== activeCompanyId) {
      loadedForRef.current = activeCompanyId
      setProperties([])
      setListLoading(true)
    }
    cacheGet('adm:' + activeCompanyId).then(saved => {
      if (!active || fresh || !saved) return
      setProperties(saved.map(mapRow))
      setListLoading(false)
    })
    async function loadProperties() {
      const { data, error } = await supabase.from('properties').select('*').eq('company_id', activeCompanyId).order('created_at', { ascending: false })
      if (!active) return
      setListLoading(false)
      if (error) { console.error(error); return }
      fresh = true
      setProperties((data || []).map(mapRow))
      cacheSet('adm:' + activeCompanyId, data || [])
    }
    loadProperties()
    return () => { active = false }
  }, [role, activeCompanyId, isPublic, refreshTick])`

const TOURS = String.raw`  useEffect(() => {
    if (isPublic || !role || !activeCompanyId) return
    let active = true
    let fresh = false
    cacheGet('tours:' + activeCompanyId).then(saved => { if (active && saved && !fresh) setPropertyTours(saved) })
    supabase.from('property_tours').select('*').eq('company_id', activeCompanyId).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return
        if (error) { console.error('Could not load property tours:', error); return }
        fresh = true
        setPropertyTours(data || [])
        cacheSet('tours:' + activeCompanyId, data || [])
      })
    return () => { active = false }
  }, [role, activeCompanyId, isPublic, refreshTick])`

const M = (name) => '/* ---------- ' + name + ' ---------- */'
replaceBetween(M('Load role'), M('Load company workspace'), ROLE, 'Load role')
replaceBetween(M('Load company workspace'), M('Load properties for the active company'), WORKSPACE, 'Load company workspace')
replaceBetween(M('Load properties for the active company'), M('Load property tours for the active company'), PROPS, 'Load properties')
replaceBetween(M('Load property tours for the active company'), M('Load admins for the active company'), TOURS, 'Load tours')

/* ---------- 4) logout + live pings ---------- */
once('await supabase.auth.signOut()', 'await supabase.auth.signOut()\n    cacheClear()', 'logout')
regexOnce(/([ \t]*)closeForm\(\)(\s*\n\s*)setActiveTab\('All Properties'\)/,
  (m, ind, sep) => ind + 'announceChange(liveSlug)\n' + ind + 'closeForm()' + sep + "setActiveTab('All Properties')", 'addProperty')
once('setProperties(prev => prev.filter(p => p.rowId !== property.rowId))', 'setProperties(prev => prev.filter(p => p.rowId !== property.rowId))\n    announceChange(liveSlug)', 'deleteProperty')
once('setProperties(prev => prev.map(p => p.rowId === property.rowId ? updated : p))', 'setProperties(prev => prev.map(p => p.rowId === property.rowId ? updated : p))\n    announceChange(liveSlug)', 'saveGallery')
once('setPropertyTours(prev => [data, ...prev])', 'setPropertyTours(prev => [data, ...prev])\n      announceChange(liveSlug)', 'uploadPropertyTour')
once('setPropertyTours(prev => prev.filter(item => item.id !== tour.id))', 'setPropertyTours(prev => prev.filter(item => item.id !== tour.id))\n    announceChange(liveSlug)', 'deletePropertyTour')
once("alert('Company settings updated.');", "announceChange(liveSlug); alert('Company settings updated.');", 'company settings')

/* ---------- 5) install buttons ---------- */
regexOnce(/(<small>\{role\}<\/small><\/div>\s*)(<button className="cancel-button" onClick=\{logout\}>Logout<\/button>)/,
  (m, a, b) => a + '<InstallButton />\n            ' + b, 'admin topbar')
const shareAll = '<button type="button" className="client-share-button client-share-all-button" onClick={() => shareClientLink(null)}>Share All Properties</button>'
{
  const n = src.split(shareAll).length - 1
  if (n < 1) fail('Share All Properties button nahi mila.')
  src = src.split(shareAll).join('<InstallButton />\n                ' + shareAll)
}

/* ---------- 6) bottom bars ---------- */
const NAV_PUBLIC = String.raw`        <BottomNav items={[
          { label: 'Home', icon: 'home', active: activeTab === 'All Properties', onClick: () => { setActiveTab('All Properties'); window.scrollTo({ top: 0, behavior: 'smooth' }) } },
          { label: 'Search', icon: 'search', onClick: () => { setActiveTab('All Properties'); setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector('.search-box input')?.focus() }, 80) } },
          { label: 'Tours', icon: 'video', active: activeTab === 'Property Tours', onClick: () => setActiveTab('Property Tours') },
          { label: 'Share', icon: 'share', onClick: () => shareClientLink(null) },
          { label: 'Call', icon: 'phone', href: 'tel:7717463674' }
        ]} />`
regexOnce(/(<\/main>\s*)(<\/div>\s*\)\s*\}\s*\/\/ Login screen)/,
  (m, a, b) => a.replace(/\s*$/, '') + '\n' + NAV_PUBLIC + '\n      ' + b, 'public bottom bar')

const NAV_ADMIN = String.raw`<BottomNav
        items={[
          { label: 'Home', icon: 'home', active: activeTab === 'All Properties', onClick: () => setActiveTab('All Properties') },
          { label: 'Tours', icon: 'video', active: activeTab === 'Property Tours', onClick: () => setActiveTab('Property Tours') },
          { label: 'Add', icon: 'plus', primary: true, onClick: openAddForm },
          { label: 'Settings', icon: 'settings', active: activeTab === 'Company Settings', onClick: () => setActiveTab('Company Settings') }
        ]}
        moreItems={[
          { label: 'Manage Admins', onClick: () => setActiveTab('Manage Admins') },
          ...(isSuperAdmin ? [{ label: 'Manage Companies', onClick: () => setActiveTab('Manage Companies') }] : []),
          { label: 'Copy Public Link', onClick: sharePublicLink },
          { label: 'Logout', onClick: logout, danger: true }
        ]}
        moreActive={activeTab === 'Manage Admins' || activeTab === 'Manage Companies'}
      />
      `
{
  const i = src.lastIndexOf('{detailsModal}')
  if (i < 0) fail('Admin screen ka {detailsModal} nahi mila.')
  src = src.slice(0, i) + NAV_ADMIN + src.slice(i)
}

/* ---------- 7) index.html ---------- */
let html = fs.readFileSync(htmlPath, 'utf8')
const htmlBackup = html
if (!html.includes('manifest.webmanifest')) {
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />'
  const tags = [
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '<meta name="theme-color" content="#12100d" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-title" content="PropertyHub" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />'
  ]
  const hasViewport = /<meta\s+name="viewport"[^>]*>/i.test(html)
  if (hasViewport) html = html.replace(/<meta\s+name="viewport"[^>]*>/i, viewport)
  else tags.unshift(viewport)
  if (!/<\/head>/i.test(html)) fail('index.html mein </head> nahi mila.')
  html = html.replace(/<\/head>/i, '  ' + tags.join('\n    ') + '\n  </head>')
}

/* ---------- write everything (only now, after every check passed) ---------- */
fs.writeFileSync(appPath + '.bak', rawApp)
fs.writeFileSync(htmlPath + '.bak', htmlBackup)
fs.writeFileSync(appPath, crlf ? src.replace(/\n/g, '\r\n') : src)
fs.writeFileSync(htmlPath, html)
fs.cpSync(path.join(here, 'public'), path.join(root, 'public'), { recursive: true })
fs.cpSync(path.join(here, 'src'), path.join(root, 'src'), { recursive: true })

console.log('\n[OK] Done! App.jsx, index.html, public/ aur src/pwa.* ready hain.')
console.log('     Backup: src/App.jsx.bak aur index.html.bak')
console.log('     Ab: Supabase SQL (ek line) chalao, phir git add . && git commit -m "app" && git push\n')
