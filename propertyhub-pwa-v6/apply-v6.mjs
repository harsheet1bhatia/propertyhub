// PropertyHub v6: fresh service worker (kills the old saved version on every phone) + version label in footer
//   node propertyhub-pwa-v6/apply-v6.mjs     (project root)
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
if (src.includes('ph-version')) fail('v6 pehle hi apply ho chuka hai.')

function once(find, replacement, label) {
  const parts = src.split(find)
  if (parts.length !== 2) fail(label + ': ' + (parts.length - 1) + ' baar mila (1 hona chahiye).')
  src = parts.join(replacement)
}
const ver = '<small className="ph-version" style={{ opacity: 0.5 }}> · v6</small>'
once('Contact Harsheet for Any Update · <a href="tel:7717463674">7717463674</a></footer>', 'Contact Harsheet for Any Update · <a href="tel:7717463674">7717463674</a>' + ver + '</footer>', 'viewer footer')
once('Contact Harsheet · <a href="tel:7717463674">7717463674</a></footer>', 'Contact Harsheet · <a href="tel:7717463674">7717463674</a>' + ver + '</footer>', 'admin footer')

fs.mkdirSync(path.join(root, 'public'), { recursive: true })
const swPath = path.join(root, 'public', 'sw.js')
if (fs.existsSync(swPath)) fs.copyFileSync(swPath, swPath + '.bak6')
fs.writeFileSync(appPath + '.bak6', rawApp)
fs.writeFileSync(appPath, crlf ? src.replace(/\n/g, '\r\n') : src)
fs.copyFileSync(path.join(here, 'public', 'sw.js'), swPath)
fs.copyFileSync(path.join(here, 'src', 'pwa.jsx'), path.join(root, 'src', 'pwa.jsx'))
console.log('\n[OK] v6 apply ho gaya. Ab: git add .  ->  git commit -m "app v6"  ->  git push\n')
