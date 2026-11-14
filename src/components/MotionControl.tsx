import defaultPrompt from "../../src-tauri/src/automation/motion-default.txt?raw"
import FFmpegStatus from "./FFmpegStatus"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { useState } from "react"

type Profile = { id: string; name: string }

function FileField({ label, path, onChoose }: { label: string; path: string; onChoose: () => void }) {
  return <div className="motion-file">
    <div><strong>{label}</strong><span title={path}>{path ? path.split(/[\\/]/).pop() : "No file selected"}</span></div>
    <button type="button" className="secondary" onClick={onChoose} aria-label={`Choose ${label.toLowerCase()}`}>{path ? "Change" : "Choose file"}</button>
  </div>
}

export default function MotionControl({ profiles }: { profiles: Profile[] }) {
  const [characterImage, setCharacterImage] = useState("")
  const [motionVideo, setMotionVideo] = useState("")
  const [ffmpegReady, setFfmpegReady] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")

  async function choose(kind: string, setPath: (path: string) => void) {
    try {
      const selected = await invoke<string | null>("choose_motion_file", { kind })
      if (selected !== null) setPath(selected)
    } catch (error) {
      setStatus(String(error))
    }
  }

  return <section className="motion-workspace">
    <h1>Motion Control</h1>
    <form onSubmit={async event => {
      event.preventDefault()
      const fields = new FormData(event.currentTarget)
      const profileId = String(fields.get("profile"))
      const start = profiles.findIndex(profile => profile.id === profileId)
      if (start < 0) return
      const profileOrder = [...profiles.slice(start), ...profiles.slice(0, start)].map(profile => profile.id)
      setBusy(true)
      setStatus("Preparing references and generating video…")
      try {
        const result = await invoke<string>("generate_motion", { input: {
          profileId, profileOrder,
          prompt: fields.get("prompt"),
          aspectRatio: fields.get("ratio"),
          preserveAudio: fields.has("audio"),
          characterImage, motionVideo,
        } })
        setStatus(`Saved to ${result}`)
      } catch (error) {
        setStatus(String(error))
      } finally {
        setBusy(false)
      }
    }}>
      <fieldset disabled={busy || profiles.length === 0}>
        <div className="motion-grid">
          <section className="motion-card">
            <h2>References</h2>
            <FileField label="Character image" path={characterImage} onChoose={() => void choose("image", setCharacterImage)} />
            {characterImage && <img className="motion-preview" src={convertFileSrc(characterImage)} alt="Selected character reference" />}
            <FileField label="Motion video" path={motionVideo} onChoose={() => void choose("video", path => { setVideoError(false); setMotionVideo(path) })} />
            {motionVideo && <video key={motionVideo} className="motion-preview" src={convertFileSrc(motionVideo)} controls preload="metadata" aria-label="Motion reference preview" onError={() => setVideoError(true)} />}
            {videoError && <p className="dialog-error" role="status">This video format or codec could not be previewed in WebView2.</p>}
            <details>
              <summary>View default prompt</summary>
              <p className="motion-default-prompt">{defaultPrompt.trim()}</p>
            </details>
            <label className="motion-field">Additional instructions (optional)
              <textarea name="prompt" rows={5} placeholder="Add instructions for this video." />
            </label>
          </section>
          <section className="motion-card">
            <h2>Output</h2>
            <label className="motion-field">Start profile
              <select required name="profile">{profiles.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select>
            </label>
            <p className="muted">Continues with the next Flow profile when credits are insufficient.</p>
            <div className="motion-options">
              <label className="motion-field">Aspect ratio<select name="ratio"><option>9:16</option><option>16:9</option></select></label>
              <div className="motion-field">Model<span>Omni 1.1 Flash</span></div>
            </div>
            <p className="muted">Results are saved automatically in Motion Control inside your download folder.</p>
            <label className="motion-checkbox"><input type="checkbox" name="audio" defaultChecked /> Preserve original audio</label>
            <FFmpegStatus onReady={setFfmpegReady} />
          </section>
        </div>
        <div className="motion-actions">
          {!busy && (!characterImage || !motionVideo || !ffmpegReady) && <span className="muted">
            {!characterImage ? "Choose a character image" : !motionVideo ? "Choose a motion video" : "FFmpeg is required"}
          </span>}
          <button type="submit" className="primary" disabled={!characterImage || !motionVideo || !ffmpegReady}>{busy ? "Generating…" : "Generate"}</button>
        </div>
      </fieldset>
      {profiles.length === 0 && <p role="status">Add a Google Flow profile to start.</p>}
      {status && <p className="motion-status" role="status">{status}</p>}
    </form>
  </section>
}
