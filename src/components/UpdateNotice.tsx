import { useEffect, useState } from "react"
import { check } from "@tauri-apps/plugin-updater"

// Cache one check per app run, including failures; never poll or install silently.
let startupVersion: Promise<string | null> | undefined
function availableVersion() {
  return startupVersion ??= check().then(async update => {
    if (!update) return null
    const version = update.version
    await update.close()
    return version
  }).catch(() => null)
}
export default function UpdateNotice({ onReview }: { onReview: () => void }) {
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    let active = true
    void availableVersion().then(value => { if (active) setVersion(value) })
    return () => { active = false }
  }, [])
  if (!version || dismissed) return null
  return <div className="update-startup-notice" role="status">
    <span>Flowpilot {version} is available.</span>
    <button onClick={onReview}>Review update</button>
    <button onClick={() => setDismissed(true)} aria-label="Dismiss update notice">×</button>
  </div>
}
