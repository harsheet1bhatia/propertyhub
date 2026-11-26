// PropertyHub app v2: company-wise name/logo, viewer opens without login,
// bottom bar "Share All" only, share caption fix.
//   node propertyhub-pwa-v2/apply-v2.mjs     (run from the project root)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = process.cwd()
const appPath = path.join(root, 'src', 'App.jsx')
const fail = (msg) => { console.error('\n[X] ' + msg + '\n    Kuch bhi change nahi kiya gaya. Ye message mujhe bhej do.\n'); process.exit(1) }

if (!fs.existsSync(appPath)) fail('src/App.jsx nahi mili. Command project ke root folder se chalao.')
const rawApp = fs.readFileSync(appPath, 'utf8')
const crlf = rawApp.includes('\r\n')
let src = rawApp.replace(/\r\n/g, '\n')
if (!src.includes("from './pwa'")) fail('Pehle wali apply-pwa.mjs chalani zaruri hai (App.jsx mein ./pwa nahi mila).')
if (src.includes('useBrand')) fail('v2 pehle hi apply ho chuka hai.')

function once(find, replacement, label) {
  const parts = src.split(find)
  if (parts.length !== 2) fail(label + ': ' + (parts.length - 1) + ' baar mila (1 hona chahiye).')
  src = parts.join(replacement)
}
function regexOnce(re, fn, label) {
  if (!re.test(src)) fail(label + ': jagah nahi mili.')
  src = src.replace(re, fn)
}

/* ---------- App.jsx ---------- */
once("lsSet } from './pwa'", "lsSet, useBrand } from './pwa'", 'pwa import')

regexOnce(/(pollMs: isPublic \? 60000 : 120000\s*\}\))/,
  (m) => m + "\n  // Installed app name + logo = this company's name + logo\n  useBrand(isPublic ? { ...(companyInfo || {}), slug: companyInfo?.slug || companySlug } : (isSuperAdmin ? null : companyInfo), isPublic ? 'viewer' : 'admin')",
  'useBrand')

regexOnce(/\{ label: 'Share', icon: 'share', onClick: \(\) => shareClientLink\(null\) \},\s*\{ label: 'Call', icon: 'phone', href: 'tel:7717463674' \}/,
  () => "{ label: 'Share All', icon: 'share', onClick: () => shareClientLink(null) }", 'bottom bar Share/Call')

once('async function copyPropertyText(property) {', `// Short caption sent along with shared photos (some apps refuse a share that has no text)
function shareInfo(property) {
  const where = property.sector ? property.sector + ' · ' : ''
  return { title: 'Property Details', text: where + typeLabel(property) + ' · ' + rentLabel(property) + ' / month' }
}

async function copyPropertyText(property) {`, 'shareInfo helper')

once('navigator.share({ files: ready.files })', 'navigator.share({ files: ready.files, ...shareInfo(property) })', 'share (second tap)')
once('navigator.share({ files })', 'navigator.share({ files, ...shareInfo(property) })', 'share (first tap)')

/* ---------- /api/manifest function (reads company name + logo) ---------- */
function detectSupabase() {
  const file = ['src/supabase.js', 'src/supabase.jsx', 'src/supabase.ts'].map(p => path.join(root, p)).find(p => fs.existsSync(p))
  if (!file) return null
  const t = fs.readFileSync(file, 'utf8')
  const envs = [...new Set([...t.matchAll(/import\.meta\.env\.([A-Za-z0-9_]+)/g)].map(m => m[1]))]
  const urlName = envs.find(n => /URL/i.test(n))
  const keyName = envs.find(n => /KEY|ANON/i.test(n))
  let urlExpr = urlName ? 'process.env.' + urlName : null
  let keyExpr = keyName ? 'process.env.' + keyName : null
  if (!urlExpr) { const m = t.match(/https:\/\/[a-z0-9-]+\.supabase\.co/); if (m) urlExpr = JSON.stringify(m[0]) }
  if (!keyExpr) { const m = t.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_publishable_[\w-]+/); if (m) keyExpr = JSON.stringify(m[0]) }
  return urlExpr && keyExpr ? { urlExpr, keyExpr } : null
}
const sb = detectSupabase()
if (!sb) fail('src/supabase.js se Supabase URL/key nahi pehchan paya. Us file ke pehle 10 lines (key ka beech ka hissa chhupa ke) bhej do.')

let isModule = false
try { isModule = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).type === 'module' } catch { /* ignore */ }

const apiCode = `// Vercel function: /api/manifest?c=<company-slug>[&a=1]
// Gives every company its own app name, logo and start page.
const SUPABASE_URL = ${sb.urlExpr}
const SUPABASE_KEY = ${sb.keyExpr}

function logoIcon(url, size, pad) {
  if (/res\\.cloudinary\\.com/.test(url) && /\\/upload\\//.test(url)) {
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
  const shortName = name.length <= 14 ? name : (name.slice(0, 14).replace(/\s+\S*$/, '') || name.slice(0, 14)).trim()
  const startUrl = slug && !admin ? '/?public=1&company=' + slug : '/'
  const id = slug ? (admin ? '/?admin=' + slug : startUrl) : '/'
  const custom = /^https?:\\/\\//i.test(logo)
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

${isModule ? 'export default handler' : 'module.exports = handler'}
`

/* ---------- write (only after every check passed) ---------- */
fs.writeFileSync(appPath + '.bak2', rawApp)
fs.writeFileSync(appPath, crlf ? src.replace(/\n/g, '\r\n') : src)
fs.copyFileSync(path.join(here, 'src', 'pwa.jsx'), path.join(root, 'src', 'pwa.jsx'))
fs.copyFileSync(path.join(here, 'src', 'pwa.css'), path.join(root, 'src', 'pwa.css'))
fs.mkdirSync(path.join(root, 'public'), { recursive: true })
fs.copyFileSync(path.join(here, 'public', 'manifest.webmanifest'), path.join(root, 'public', 'manifest.webmanifest'))
fs.mkdirSync(path.join(root, 'api'), { recursive: true })
fs.writeFileSync(path.join(root, 'api', 'manifest.js'), apiCode)

console.log('\n[OK] v2 apply ho gaya.')
console.log('     Naya: api/manifest.js (har company ka naam + logo), src/pwa.jsx, src/App.jsx')
console.log('     Ab: git add . && git commit -m "app v2" && git push\n')
