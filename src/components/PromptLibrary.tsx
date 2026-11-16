import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useDialogFocus } from "./useDialogFocus"
import "../styles/prompts.css"

type Prompt = { id: string; title: string; prompt: string; category: string; pinned: boolean; color: string; createdAt: number; updatedAt: number }
type Modal = { kind: "edit" | "detail" | "delete"; item?: Prompt } | null
const COLORS = ["default", "blue", "purple", "green", "orange", "red"]
const EMPTY = { title: "", category: "", prompt: "" }
export default function PromptLibrary() {
  const [items, setItems] = useState<Prompt[]>([])
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [modal, setModal] = useState<Modal>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  useDialogFocus(modal !== null, returnFocus)
  useEffect(() => {
    let cancelled = false
    setReady(false); setError("")
    void invoke<Prompt[]>("list_prompts").then(rows => { if (!cancelled) { setItems(rows); setReady(true) } }).catch(() => { if (!cancelled) setError("Unable to load prompts. Existing data has not been overwritten.") })
    return () => { cancelled = true }
  }, [attempt])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !lock.current) setModal(null) }
    if (modal) window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [modal])
  function open(next: NonNullable<Modal>) {
    returnFocus.current = document.activeElement as HTMLElement | null
    setError(""); setNotice(""); setForm(next.item ? { title: next.item.title, category: next.item.category, prompt: next.item.prompt } : EMPTY); setModal(next)
  }
  async function mutate(mutation: object, close = false) {
    if (!ready || lock.current) return
    lock.current = true; setBusy(true); setError(""); setNotice("")
    try {
      setItems(await invoke<Prompt[]>("mutate_prompt", { mutation }))
      if (close) setModal(null)
      setNotice("Saved")
    } catch { setError("Unable to save this change. Your previous library is preserved; try again.") }
    finally { lock.current = false; setBusy(false) }
  }
  async function copy(item: Prompt) {
    setError(""); setNotice("")
    try { await navigator.clipboard.writeText(item.prompt); setNotice(`Copied ${item.title}`) }
    catch { setError("Copy failed. Clipboard access was not available.") }
  }
  const categories = Array.from(new Set(items.map(p => p.category).filter(Boolean))).sort()
  const selectedCategory = categories.includes(category) ? category : ""
  const shown = items.filter(p => (!selectedCategory || p.category === selectedCategory) && `${p.title} ${p.prompt} ${p.category}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
  return <section className="prompt-library" aria-labelledby="prompt-heading">
    <header><h1 id="prompt-heading">Prompt Library</h1><button className="primary" disabled={!ready || busy} onClick={() => open({ kind: "edit" })}>+ New prompt</button></header>
    <div className="prompt-filters">
      <input aria-label="Search prompts" placeholder="Search prompts…" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Filter prompt category" value={selectedCategory} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select>
      <span>{shown.length} prompts</span>
    </div>
    {!modal && error && <p role="alert" className="dialog-error">{error}</p>}
    {!modal && notice && <p role="status">{notice}</p>}
    {!ready ? error ? <button onClick={() => setAttempt(n => n + 1)}>Retry loading</button> : <p role="status">Loading prompts…</p> : shown.length === 0 ? <p>{items.length ? "No matching prompts. Adjust the search or category." : "Save your first prompt to reuse it across services."}</p> :
      <div className="prompt-grid">{shown.map(item => <article key={item.id} className={`prompt-card prompt-color-${item.color}`}>
        <button className="prompt-title" onClick={() => open({ kind: "detail", item })}>{item.title}</button>
        <small>{item.category || "Uncategorized"}{item.pinned ? " · Pinned" : ""}</small>
        <p className="prompt-preview">{item.prompt}</p>
        <div className="prompt-actions">
          <button onClick={() => void copy(item)}>Copy</button>
          <button disabled={busy} onClick={() => open({ kind: "edit", item })}>Edit</button>
          <button disabled={busy} aria-pressed={item.pinned} onClick={() => void mutate({ op: "pin", id: item.id, pinned: !item.pinned })}>{item.pinned ? "Unpin" : "Pin"}</button>
          <button disabled={busy} onClick={() => open({ kind: "delete", item })}>Delete</button>
          <select aria-label={`Color for ${item.title}`} disabled={busy} value={item.color} onChange={e => void mutate({ op: "color", id: item.id, color: e.target.value })}>{COLORS.map(color => <option key={color}>{color}</option>)}</select>
        </div>
      </article>)}</div>}
    {modal && <div className="overlay"><div className="dialog prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-dialog-title" aria-busy={busy}>
      <h2 id="prompt-dialog-title">{modal.kind === "edit" ? modal.item ? "Edit prompt" : "New prompt" : modal.kind === "delete" ? "Delete prompt?" : modal.item!.title}</h2>
      {modal.kind === "edit" ? <form onSubmit={e => { e.preventDefault(); void mutate({ op: "save", id: modal.item?.id ?? null, ...form }, true) }}>
        <label>Title<input required maxLength={200} value={form.title} disabled={busy} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label>Category<input maxLength={100} value={form.category} disabled={busy} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
        <label>Prompt<textarea aria-label="Prompt" required maxLength={100000} rows={10} value={form.prompt} disabled={busy} onChange={e => setForm({ ...form, prompt: e.target.value })} /></label>
        {error && <p role="alert" className="dialog-error">{error}</p>}
        <div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className="primary" disabled={busy || !form.title.trim() || !form.prompt.trim()}>{busy ? "Saving…" : "Save"}</button></div>
      </form> : <>
        {modal.kind === "detail" ? <><small>{modal.item!.category || "Uncategorized"}</small><div className="prompt-detail">{modal.item!.prompt}</div></> : <p>This permanently removes “{modal.item!.title}” from your saved prompt library.</p>}
        {error && <p role="alert" className="dialog-error">{error}</p>}{notice && <p role="status">{notice}</p>}
        <div className="dialog-actions"><button disabled={busy} onClick={() => setModal(null)}>{modal.kind === "delete" ? "Cancel" : "Close"}</button>
          {modal.kind === "detail" ? <button onClick={() => void copy(modal.item!)}>Copy</button> : <button className="danger" disabled={busy} onClick={() => void mutate({ op: "delete", id: modal.item!.id }, true)}>Delete prompt</button>}
        </div>
      </>}
    </div></div>}
  </section>
}
