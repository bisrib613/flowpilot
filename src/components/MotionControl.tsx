import { invoke } from "@tauri-apps/api/core"
import { useState } from "react"

type Profile = { id: string; name: string }

export default function MotionControl({ profiles }: { profiles: Profile[] }) {
  const [characterImage, setCharacterImage] = useState("")
  const [motionVideo, setMotionVideo] = useState("")
  const [output, setOutput] = useState("")
  const [ffmpeg, setFfmpeg] = useState("")
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

  return <section className="preload-setting">
    <h2>Motion Control</h2>
    <p>Generate video in Google Flow using a character image and a motion reference. Model: Omni 1.1 Flash.</p>
    <form onSubmit={async event => {
      event.preventDefault()
      const fields = new FormData(event.currentTarget)
      setBusy(true)
      setStatus("Preparing references and generating video…")
      try {
        const result = await invoke<string>("generate_motion", { input: {
          profileId: fields.get("profile"),
          prompt: fields.get("prompt"),
          aspectRatio: fields.get("ratio"),
          preserveAudio: fields.has("audio"),
          characterImage, motionVideo, output, ffmpeg: ffmpeg || null,
        } })
        setStatus(`Saved to ${result}`)
      } catch (error) {
        setStatus(String(error))
      } finally {
        setBusy(false)
      }
    }}>
      <fieldset disabled={busy || profiles.length === 0}>
        <label>Google Flow profile {" "}
          <select required name="profile">{profiles.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select>
        </label>
        <label>Aspect ratio {" "}
          <select name="ratio"><option>9:16</option><option>16:9</option></select>
        </label>
        <div><button type="button" onClick={() => void choose("image", setCharacterImage)}>Choose character image</button> {characterImage}</div>
        <div><button type="button" onClick={() => void choose("video", setMotionVideo)}>Choose motion video</button> {motionVideo}</div>
        <div><button type="button" onClick={() => void choose("output", setOutput)}>Choose output file</button> {output}</div>
        <div><button type="button" onClick={() => void choose("ffmpeg", setFfmpeg)}>Choose FFmpeg</button> {ffmpeg || "Use FFmpeg from PATH"}</div>
        <label>Prompt <textarea name="prompt" required rows={4} /></label>
        <div><label><input type="checkbox" name="audio" defaultChecked /> Preserve original audio</label></div>
        <button type="submit" disabled={!characterImage || !motionVideo || !output}>Generate</button>
      </fieldset>
      {profiles.length === 0 && <p>Add a Google Flow profile to start.</p>}
      {status && <p role="status">{status}</p>}
    </form>
  </section>
}
