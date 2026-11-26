// PropertyHub v4:
//  1) Share: files are prepared in the background -> ONE tap shares. Big sets go in parts (Android limit).
//     Photos are sent as JPEG (fixes "Can't send empty message" in WhatsApp).
//  2) iPhone viewer: home-screen icon opens the viewer (no login page)
//   node propertyhub-pwa-v4/apply-v4.mjs     (run from the project root, AFTER v3)
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
if (!src.includes('afterFilesShared')) fail('Pehle apply-v3.mjs chalana zaruri hai.')
if (src.includes('buildBatches')) fail('v4 pehle hi apply ho chuka hai.')

function once(find, replacement, label) {
  const parts = src.split(find)
  if (parts.length !== 2) fail(label + ': ' + (parts.length - 1) + ' baar mila (1 hona chahiye).')
  src = parts.join(replacement)
}

once("import { supabase } from './supabase'", "import { supabase } from './supabase'\nimport { fetchShareFile, makeShareFile, buildBatches } from './shareFiles'", 'import')

// Replace the whole old share logic (from the v3 marker up to the modal's return)
const startMarker = '// Android: photos are sent first on their own'
const start = src.indexOf(startMarker)
if (start === -1) fail('Purana share block nahi mila.')
const end = src.indexOf('\n  return (\n    <div className="modal-overlay" onClick={onClose}>', start)
if (end === -1) fail('Share block ka end nahi mila.')
const block = fs.readFileSync(path.join(here, 'snippets', 'share-block.txt'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
src = src.slice(0, start) + block + '\n' + src.slice(end)

const oldLabel = "{busy ? 'Please wait…' : readyNow ? " + "`↗ Tap to Share (${actionItems.length})`" + " : " + "`↗ Share ${countLabel}`" + "}"
once(oldLabel, '{shareLabel}', 'share button label')

/* ---------- write ---------- */
fs.writeFileSync(appPath + '.bak4', rawApp)
fs.writeFileSync(appPath, crlf ? src.replace(/\n/g, '\r\n') : src)
fs.copyFileSync(path.join(here, 'src', 'shareFiles.js'), path.join(root, 'src', 'shareFiles.js'))
fs.copyFileSync(path.join(here, 'src', 'pwa.jsx'), path.join(root, 'src', 'pwa.jsx'))
console.log('\n[OK] v4 apply ho gaya. Ab: git add .  ->  git commit -m "app v4"  ->  git push\n')
