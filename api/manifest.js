// Vercel function: /api/manifest?c=<company-slug>[&a=1]
// Gives every company its own app name, logo and start page.
const SUPABASE_URL = "https://gbtgnaepcpadzazedsfw.supabase.co"
const SUPABASE_KEY = "sb_publishable_BphC01-sQSdOmpB04kXyfg_iiRSkdgs"

function logoIcon(url, size, pad) {
  if (/res\.cloudinary\.com/.test(url) && /\/upload\//.test(url)) {
    const t = pad
      ? 'c_fit,w_' + Math.round(size * 0.7) + ',h_' + Math.round(size * 0.7) + '/c_pad,w_' + size + ',h_' + size + ',b_white,f_png'
      : 'c_pad,w_' + size + ',h_' + size + ',b_white,f_png'
    return url.replace('/upload/', '/upload/' + t + '/')
  }
  return url
}

async function handler(req, res) {
  const q = req.query || {}
  const slug = String(q.c || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60)
  const admin = String(q.a || '') === '1'
  let name = 'PropertyHub'
  let logo = ''
  let theme = '#12100d'

  if (slug && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_public_company_by_slug', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_slug: slug })
      })
      let data = await r.json()
      if (Array.isArray(data)) data = data[0]
      if (data && data.name) {
        name = String(data.name)
        logo = String(data.logo_url || '')
        if (/^#[0-9a-f]{6}$/i.test(String(data.theme_color || ''))) theme = data.theme_color
      }
    } catch (e) { /* fall back to PropertyHub */ }
  }

  const label = admin && slug ? name + ' Admin' : name
  const shortName = name.length <= 14 ? name : (name.slice(0, 14).replace(/s+S*$/, '') || name.slice(0, 14)).trim()
  const startUrl = slug && !admin ? '/?public=1&company=' + slug : '/'
  const id = slug ? (admin ? '/?admin=' + slug : startUrl) : '/'
  const custom = /^https?:\/\//i.test(logo)
  const icons = custom
    ? [
        { src: logoIcon(logo, 192, false), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: logoIcon(logo, 512, false), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: logoIcon(logo, 512, true), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    : [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  res.status(200).send(JSON.stringify({
    id, name: label, short_name: shortName,
    description: 'Property listings, photos and tours - always live.',
    start_url: startUrl, scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: '#ffffff', theme_color: theme, icons
  }))
}

export default handler
