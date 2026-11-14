import { invoke } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"

type Source = "managed" | "path" | "missing" | "unsupported"

export default function FFmpegStatus({ onReady }: { onReady?: (ready: boolean) => void }) {
  const [source, setSource] = useState<Source>()
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    void invoke<Source>("ffmpeg_status").then(result => {
      if (!cancelled) setSource(result)
    }, error => {
      if (!cancelled) setError(String(error))
    })
    return () => { cancelled = true }
  }, [])
  const ready = source === "managed" || source === "path"
  useEffect(() => { onReady?.(ready) }, [onReady, ready])

  async function install() {
    setInstalling(true)
    setError("")
    try {
      setSource(await invoke<Source>("install_ffmpeg"))
    } catch (error) {
      setError(String(error))
    } finally {
      setInstalling(false)
    }
  }

  return <div className="dependency-entry">
    <div className="dependency-row">
      <div><strong>FFmpeg</strong>
        <span role="status">{installing ? "Downloading and verifying FFmpeg…" : source === "managed" ? "Installed by Flowpilot" : source === "path" ? "Available on system PATH" : source === "missing" ? "Required to prepare and assemble clips" : source === "unsupported" ? "Available on Windows" : error ? "Could not check FFmpeg" : "Checking availability…"}</span>
      </div>
      {source === "missing" && <button className="secondary" type="button" disabled={installing} onClick={() => void install()}>{installing ? "Installing…" : "Install FFmpeg · 115 MB"}</button>}
    </div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </div>
}
