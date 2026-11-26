// PropertyHub v3:
//  1) Android share: photos go first (alone), then "Send Details Text" button
//  2) Property Tours: Rename (property number + sector) for admins / super admin
//  3) Admin login: 6-digit code option (works inside the iPhone home-screen app)
//   node propertyhub-pwa-v3/apply-v3.mjs     (run from the project root)
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
if (src.includes('fileShareData')) fail('v3 pehle hi apply ho chuka hai.')

function once(find, replacement, label) {
  const parts = src.split(find)
  if (parts.length !== 2) fail(label + ': ' + (parts.length - 1) + ' baar mila (1 hona chahiye).')
  src = parts.join(replacement)
}

/* ---------- 1) Share: photos first, details text after (Android) ---------- */
once('async function copyPropertyText(property) {', `// iPhone needs a caption with shared photos. On Android a caption makes apps like WhatsApp
// send ONLY the text, so Android shares the photos alone and the details text follows.
function fileShareData(files, property) {
  return isIOSDevice() ? { files, ...shareInfo(property) } : { files }
}

async function copyPropertyText(property) {`, 'fileShareData helper')

once("const [notice, setNotice] = useState('')", "const [notice, setNotice] = useState('')\n  const [textPending, setTextPending] = useState(false)", 'textPending state')

once("const openFolderById = (id) => { setOpenFolder(id); setSelectMode(false); setSelectedMedia([]); setReady(null); setNotice('') }",
  "const openFolderById = (id) => { setOpenFolder(id); setSelectMode(false); setSelectedMedia([]); setReady(null); setNotice(''); setTextPending(false) }", 'openFolderById')

once("// Share opens the phone's share sheet (WhatsApp etc.) without saving files first.", `// Android: photos are sent first on their own, then the details text goes with one more tap.
  const afterFilesShared = () => {
    if (isIOSDevice()) return
    setTextPending(true)
    setNotice('Photos shared. Tap "Send Details Text" to send the property details after them.')
  }
  const handleShareText = async () => {
    try {
      await navigator.share(shareInfo(property))
      setTextPending(false)
      setNotice('')
    } catch (error) {
      if (error?.name !== 'AbortError') setNotice('Could not open share. Please try again.')
    }
  }

  // Share opens the phone's share sheet (WhatsApp etc.) without saving files first.`, 'share helpers')

once('await navigator.share({ files: ready.files, ...shareInfo(property) })',
  'await navigator.share(fileShareData(ready.files, property))\n        afterFilesShared()', 'share (second tap)')
once('await navigator.share({ files, ...shareInfo(property) })',
  'await navigator.share(fileShareData(files, property))\n        afterFilesShared()', 'share (first tap)')

once('{notice && <p className="detail-line" role="status">{notice}</p>}',
  `{notice && <p className="detail-line" role="status">{notice}</p>}
        {textPending && <div className="gallery-actions"><button className="add-button" onClick={handleShareText}>↗ Send Details Text</button></div>}`, 'details text button')

/* ---------- 2) Property tour rename ---------- */
once('function PropertyToursPanel({ tours, isAdmin, onUpload, onDelete, uploading }) {',
  'function PropertyToursPanel({ tours, isAdmin, onUpload, onDelete, onRename, uploading }) {', 'PropertyToursPanel props')

once("const [tourSearch, setTourSearch] = useState('')", `const [tourSearch, setTourSearch] = useState('')
  const [renameId, setRenameId] = useState(null)
  const [renameForm, setRenameForm] = useState({ number: '', sector: '' })
  const [renaming, setRenaming] = useState(false)
  const startRename = tour => { setRenameId(tour.id); setRenameForm({ number: tour.property_number || '', sector: tour.sector || '' }) }
  const saveRename = async tour => {
    const number = renameForm.number.trim()
    const sectorName = renameForm.sector.trim()
    if (!number || !sectorName) return alert('Property number and sector cannot be empty.')
    setRenaming(true)
    const ok = await onRename(tour, { propertyNumber: number, sector: sectorName })
    setRenaming(false)
    if (ok) setRenameId(null)
  }`, 'rename state')

once(`<div className="property-tour-title"><span>{tour.sector || 'Sector'}</span><h3>Property #{tour.property_number}</h3></div>`,
`{renameId === tour.id ? (
            <div className="tour-upload-fields" style={{ marginBottom: 13 }}>
              <label>Property Number<input value={renameForm.number} onChange={e => setRenameForm(p => ({ ...p, number: e.target.value }))} /></label>
              <label>Sector<input value={renameForm.sector} onChange={e => setRenameForm(p => ({ ...p, sector: e.target.value }))} /></label>
              <div className="property-tour-actions" style={{ gridColumn: '1 / -1' }}>
                <button className="add-button" type="button" disabled={renaming} onClick={() => saveRename(tour)}>{renaming ? 'Saving…' : 'Save'}</button>
                <button className="cancel-button" type="button" disabled={renaming} onClick={() => setRenameId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="property-tour-title"><span>{tour.sector || 'Sector'}</span><h3>Property #{tour.property_number}</h3></div>
          )}`, 'tour title')

once(`{isAdmin && <button className="tour-delete-button" type="button" onClick={() => onDelete(tour)}>Delete Tour</button>}`,
`{isAdmin && onRename && renameId !== tour.id && <button className="tour-delete-button" style={{ color: 'var(--acc-deep)', marginRight: 18 }} type="button" onClick={() => startRename(tour)}>Rename</button>}
          {isAdmin && <button className="tour-delete-button" type="button" onClick={() => onDelete(tour)}>Delete Tour</button>}`, 'rename button')

once('/* ---------- Shared modal props ---------- */', `const renamePropertyTour = async (tour, { propertyNumber, sector }) => {
    if (!isAdmin) return false
    const { data, error } = await supabase.from('property_tours')
      .update({ property_number: propertyNumber, sector })
      .eq('id', tour.id)
      .select('*')
      .single()
    if (error) { alert('Could not rename tour: ' + error.message); return false }
    setPropertyTours(prev => prev.map(item => item.id === tour.id ? data : item))
    announceChange(liveSlug)
    return true
  }

  /* ---------- Shared modal props ---------- */`, 'renamePropertyTour')

once('<PropertyToursPanel tours={propertyTours} isAdmin={isAdmin} onUpload={uploadPropertyTour} onDelete={deletePropertyTour} uploading={tourUploading} />',
  '<PropertyToursPanel tours={propertyTours} isAdmin={isAdmin} onUpload={uploadPropertyTour} onDelete={deletePropertyTour} onRename={renamePropertyTour} uploading={tourUploading} />', 'PropertyToursPanel usage')

/* ---------- 3) Login with 6-digit code (needed for the iPhone home-screen app) ---------- */
once("const [email, setEmail] = useState('')", "const [email, setEmail] = useState('')\n  const [otpSent, setOtpSent] = useState(false)\n  const [otpCode, setOtpCode] = useState('')", 'otp state')
once("alert('Login link sent! Check your email and click the link.')", "setOtpSent(true)\n    alert('Login link sent! Check your email. You can click the link, or type the 6-digit code below.')", 'login alert')
once('const logout = async () => {', `const verifyCode = async () => {
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: otpCode.trim(), type: 'email' })
    if (error) alert('That code did not work: ' + error.message)
  }

  const logout = async () => {`, 'verifyCode')
once('<button className="add-button" type="submit">Send Login Link</button>', `<button className="add-button" type="submit">Send Login Link</button>

          {otpSent && (
            <>
              <label>Code from email (optional)
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); verifyCode() } }}
                  placeholder="6-digit code"
                />
              </label>
              <button className="cancel-button" type="button" onClick={verifyCode} disabled={!otpCode.trim()}>Login with Code</button>
            </>
          )}`, 'login code UI')

/* ---------- write (only after every check passed) ---------- */
fs.writeFileSync(appPath + '.bak3', rawApp)
fs.writeFileSync(appPath, crlf ? src.replace(/\n/g, '\r\n') : src)
fs.copyFileSync(path.join(here, 'src', 'pwa.jsx'), path.join(root, 'src', 'pwa.jsx'))
console.log('\n[OK] v3 apply ho gaya. Ab: git add .  ->  git commit -m "app v3"  ->  git push\n')
