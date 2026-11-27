// PropertyHub v7: instant photo/video sharing (one tap, no popups)
//   1) is folder ke andar jo "src" folder hai usse apne project ke src me daalo (fastShare.js)
//   2) project root se chalao:   node apply-v7.mjs
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
if (src.includes('./fastShare')) fail('v7 pehle hi apply ho chuka hai.')

function between(startMarker, endMarker, replacement, label) {
  const s = src.indexOf(startMarker)
  if (s === -1 || src.indexOf(startMarker, s + 1) !== -1) fail(label + ': start marker 1 baar nahi mila.')
  const e = src.indexOf(endMarker, s)
  if (e === -1) fail(label + ': end marker nahi mila.')
  src = src.slice(0, s) + replacement + src.slice(e)
}
function once(find, replacement, label) {
  const parts = src.split(find)
  if (parts.length !== 2) fail(label + ': ' + (parts.length - 1) + ' baar mila (1 hona chahiye).')
  src = parts.join(replacement)
}

once("import { fetchShareFile, makeShareFile, buildBatches } from './shareFiles'",
  "import { isShareReady, prepareShareItems, buildShareBatches, makeShareFile } from './fastShare'", 'import')

const photoShare = `  // ---------- Sharing (fast: small copies, parallel download, cached) ----------
  const sharingRef = useRef(false)
  const [preparedTick, setPreparedTick] = useState(0)
  const [batchNo, setBatchNo] = useState(0)
  const onIOSDevice = isIOSDevice()
  const settled = actionItems.filter(i => isShareReady(i)).length
  const allReady = actionItems.length > 0 && settled === actionItems.length
  const plan = useMemo(() => buildShareBatches(actionItems, onIOSDevice), [sig, preparedTick])

  useEffect(() => { setBatchNo(0) }, [sig])

  // Start getting the files ready the moment a folder is open, so Share is instant.
  useEffect(() => {
    if (!canShare || showOverview || !actionItems.length) return undefined
    let cancelled = false
    prepareShareItems(actionItems, () => { if (!cancelled) setPreparedTick(n => n + 1) })
    return () => { cancelled = true }
  }, [sig, showOverview, canShare])

  const finishShare = (skippedCount) => {
    setBatchNo(0)
    if (!onIOSDevice) setTextPending(true)
    setNotice(skippedCount ? skippedCount + ' file(s) could not be shared. Please use Download for those.' : '')
  }

  const runShare = async (files) => {
    if (!navigator.canShare({ files })) {
      setNotice('This browser cannot share these files directly. Please use Download.')
      return false
    }
    try {
      await navigator.share(onIOSDevice ? { files, ...shareInfo(property) } : { files })
      return true
    } catch (error) {
      if (error?.name === 'AbortError') return false
      // phone wanted a fresh tap after the wait: files are ready now, next tap shares instantly
      setNotice(error?.name === 'NotAllowedError' ? 'Ready. Tap Share again.' : 'Could not open share. Please tap Share again, or use Download.')
      return false
    }
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

  const handleShare = async () => {
    if (!actionItems.length || busy || sharingRef.current) return
    sharingRef.current = true
    try {
      setNotice('')
      if (!allReady) await prepareShareItems(actionItems, () => setPreparedTick(n => n + 1))
      const { batches, skipped } = buildShareBatches(actionItems, onIOSDevice)
      if (!batches.length) { setNotice('These files cannot be shared directly. Please use Download.'); return }
      const no = batchNo >= batches.length ? 0 : batchNo
      const files = batches[no].map(item => makeShareFile(item, property.id, actionItems.indexOf(item)))
      const sent = await runShare(files)
      if (!sent) return
      if (no + 1 < batches.length) setBatchNo(no + 1)
      else finishShare(skipped.length)
    } finally {
      sharingRef.current = false
    }
  }

  const shareLabel = busy ? 'Please wait…'
    : (!allReady && !showOverview) ? \`Preparing \${settled}/\${actionItems.length}…\`
    : (allReady && plan.batches.length > 1) ? \`↗ Share part \${Math.min(batchNo, plan.batches.length - 1) + 1} of \${plan.batches.length}\`
    : \`↗ Share \${countLabel}\``

between('  // ---------- Sharing ----------\n', '\n\n  return (\n    <div className="modal-overlay" onClick={onClose}>', photoShare, 'photo share')

const tourShare = `  const tourFilesRef = useRef({})
  const shareOne = async (url, title, propertyNumber, index) => {
    const shareKey = \`\${propertyNumber}-\${index}\`
    if (!navigator.share || !navigator.canShare) { downloadOne(url, propertyNumber, index); return }

    const trySend = async (file) => {
      try {
        if (!navigator.canShare({ files: [file] })) { downloadOne(url, propertyNumber, index); return true }
        await navigator.share({ files: [file], title })
        return true
      } catch (error) {
        return error?.name === 'AbortError' // cancelled by the user = done; anything else = ask for one more tap
      }
    }

    // File already downloaded (earlier tap): share instantly, no waiting, no popup.
    const cached = tourFilesRef.current[shareKey]
    if (cached) {
      if (await trySend(cached)) setReadyShare(null)
      return
    }

    try {
      setBusyShare(shareKey)
      setReadyShare(null)
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) throw new Error('Video could not be fetched')
      const blob = await response.blob()
      const mimeType = blob.type && blob.type.startsWith('video/') ? blob.type : 'video/mp4'
      const file = new File([blob], \`Property-\${safeName(propertyNumber)}-Tour-\${index + 1}.mp4\`, { type: mimeType })
      tourFilesRef.current[shareKey] = file
      // try straight away; if the phone wants a fresh tap, the button turns into "Tap again to Share"
      if (!(await trySend(file))) setReadyShare({ key: shareKey })
    } catch (error) {
      console.error('Video preparation failed:', error)
      downloadOne(url, propertyNumber, index)
    } finally {
      setBusyShare('')
    }
  }`
between('  const shareOne = async (url, title, propertyNumber, index) => {', '\n\n  return (\n    <div className="property-section property-tours-section">', tourShare, 'tour share')

fs.mkdirSync(path.join(root, 'src'), { recursive: true })
fs.writeFileSync(appPath + '.bak7', rawApp)
fs.writeFileSync(appPath, crlf ? src.replace(/\n/g, '\r\n') : src)
fs.copyFileSync(path.join(here, 'src', 'fastShare.js'), path.join(root, 'src', 'fastShare.js'))
console.log('\n[OK] v7 apply ho gaya. Ab: git add .  ->  git commit -m "fast share v7"  ->  git push\n')
