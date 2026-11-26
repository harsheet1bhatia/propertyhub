# PropertyHub → Installable App (PWA)

Website ka look **bilkul same** rahega (super admin, admin, broker, client sab ke liye).
Naya sirf yeh hai: Install App button (admin + broker), app ke andar bottom bar, live updates, instant open.

## Step 1 — Files copy karo
| Ye file | Yahan rakho |
|---|---|
| `public/manifest.webmanifest` | project ke `public/` folder mein |
| `public/sw.js` | project ke `public/` folder mein |
| `public/icons/*.png` (4 files) | `public/icons/` |
| `src/pwa.jsx` | `src/` |
| `src/pwa.css` | `src/` |

## Step 2 — `index.html` ke `<head>` mein
Purani viewport line hata ke yeh sab daalo:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#12100d" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="PropertyHub" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
```

## Step 3 — Supabase (SQL Editor mein ek baar run karo)
Admin ke liye live changes:
```sql
alter publication supabase_realtime add table properties, property_tours;
```
(Agar "already member" error aaye to ignore karo.)
Broker/client ko live ping admin ke save karte hi milta hai, uske liye extra setup nahi chahiye
(Supabase → Realtime settings mein "Allow public access" ON rehna chahiye, default ON hota hai).

## Step 4 — `App.jsx` mein changes (9 patches)

### Patch 1 — imports (top)
```js
import { useState, useEffect, useMemo } from 'react'
```
ko badlo:
```js
import { useState, useEffect, useMemo, useRef } from 'react'
```
aur `import { uploadToCloudinary } from './cloudinary'` ke neeche add karo:
```js
import { InstallButton, BottomNav, useLiveRefresh, announceChange, cacheGet, cacheSet, cacheClear, lsGet, lsSet } from './pwa'
```

### Patch 2 — live + instant-open state
`const resetFilters = () => setFilters(emptyFilters)` ke **turant neeche** paste karo:
```js
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
  })
```

### Patch 3 — `/* ---------- Load role ---------- */` wala poora `useEffect` replace karo
```js
  useEffect(() => {
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
  }, [userId])
```

### Patch 4 — `/* ---------- Load company workspace ---------- */` wala poora `useEffect` replace karo
(Neeche ek naya effect bhi hai — dono paste karo.)
```js
  useEffect(() => {
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
  }, [])
```

### Patch 5 — `/* ---------- Load properties for the active company ---------- */` wala `useEffect` replace karo
```js
  useEffect(() => {
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
  }, [role, activeCompanyId, isPublic, refreshTick])
```

### Patch 6 — `/* ---------- Load property tours for the active company ---------- */` wala `useEffect` replace karo
```js
  useEffect(() => {
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
  }, [role, activeCompanyId, isPublic, refreshTick])
```

### Patch 7 — logout aur "live ping" (chhote one-line changes)
**a)** `logout` ke andar `await supabase.auth.signOut()` ke neeche ek line:
```js
    cacheClear()
```
**b)** Admin jab bhi kuch save kare, sabko turant update mile — in jagah ek-ek line add karo:

| Function | Ye line dhundo | Iske **baad** (ya jaisa likha) add karo |
|---|---|---|
| `addProperty` | `closeForm()` jiske neeche `setActiveTab('All Properties')` hai | `closeForm()` se **pehle**: `announceChange(liveSlug)` |
| `deleteProperty` | `setProperties(prev => prev.filter(p => p.rowId !== property.rowId))` | neeche: `announceChange(liveSlug)` |
| `saveGallery` | `setProperties(prev => prev.map(p => p.rowId === property.rowId ? updated : p))` | neeche: `announceChange(liveSlug)` |
| `uploadPropertyTour` | `setPropertyTours(prev => [data, ...prev])` | neeche: `announceChange(liveSlug)` |
| `deletePropertyTour` | `setPropertyTours(prev => prev.filter(item => item.id !== tour.id))` | neeche: `announceChange(liveSlug)` |
| Company Settings form | `alert('Company settings updated.');` | uske **pehle**: `announceChange(liveSlug);` |

### Patch 8 — Install App button (3 jagah)
**a) Admin topbar** — `<button className="cancel-button" onClick={logout}>Logout</button>` ke **pehle** add karo:
```jsx
            <InstallButton />
```
**b) Broker (public viewer)** — yeh line **dono jagah** (All Properties wala header aur Property Tours wala header) milegi:
`<button type="button" className="client-share-button client-share-all-button" onClick={() => shareClientLink(null)}>Share All Properties</button>`
dono ke **pehle** add karo:
```jsx
<InstallButton />
```
Client link page (`?client=`) mein button nahi hai, jaisa chaha tha.

### Patch 9 — Bottom bar
**a) Broker/public viewer** — `// Public read-only page` return ke andar, `</main>` ke baad aur closing `</div>` se pehle:
```jsx
        </main>
        <BottomNav items={[
          { label: 'Home', icon: 'home', active: activeTab === 'All Properties', onClick: () => { setActiveTab('All Properties'); window.scrollTo({ top: 0, behavior: 'smooth' }) } },
          { label: 'Search', icon: 'search', onClick: () => { setActiveTab('All Properties'); setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector('.search-box input')?.focus() }, 80) } },
          { label: 'Tours', icon: 'video', active: activeTab === 'Property Tours', onClick: () => setActiveTab('Property Tours') },
          { label: 'Share', icon: 'share', onClick: () => shareClientLink(null) },
          { label: 'Call', icon: 'phone', href: 'tel:7717463674' }
        ]} />
      </div>
```
**b) Admin / Super admin** — file ke bilkul end mein, `{detailsModal}` se **pehle** (last `return` ke andar):
```jsx
      <BottomNav
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
      {detailsModal}
```

## Step 5 — Deploy aur test
`git push` karo (Vercel). Phir:
* **Android (Chrome):** site kholo → top-right **Install App** → Install. Home screen par app icon aayega, full-screen khulega.
* **iPhone (Safari):** top-right **Install App** → steps dikhenge (Share → Add to Home Screen).
* Installed app mein neeche 5 option wali bar dikhegi. Browser/laptop par website pehle jaisi hi rahegi.

## Dhyan rakhne wali baatein
* Naya update deploy karoge to app ko wo **agli baar kholne par** milta hai (pehle purani se turant khulta hai, peeche naya download ho jata hai). Data (properties/photos) hamesha live aata hai.
* iPhone par Admin magic-link email se login: link Safari mein khulta hai, installed app mein nahi (iOS ki limit). Isliye iPhone admin ke liye 6-digit code login add karna padega. Android par ye problem nahi.
* Install ke liye site HTTPS honi chahiye (Vercel par already hai).
