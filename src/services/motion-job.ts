import { invoke } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'

type Job = { busy: boolean; status: string; resumeJob: string | null }
let job: Job = { busy: false, status: '', resumeJob: null }
const listeners = new Set<() => void>()
const set = (next: Job) => { job = next; listeners.forEach(listener => listener()) }
export const useMotionJob = () => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => job
)
export async function generateMotion(input: object) {
  if (job.busy) return
  set({ busy: true, status: 'Preparing references and generating video…', resumeJob: null })
  try {
    const path = await invoke<string>('generate_motion', { input })
    set({ busy: false, status: `Saved to ${path}`, resumeJob: null })
  } catch (error) {
    const status = String(error)
    const resumeJob = status.match(/Resume job: ([a-f0-9-]{36})/)?.[1] || null
    set({ busy: false, status, resumeJob })
  }
}
export async function resumeMotion(id: string) {
  if (job.busy) return
  set({ busy: true, status: 'Resuming completed segments…', resumeJob: id })
  try {
    const path = await invoke<string>('resume_motion', { jobId: id })
    set({ busy: false, status: `Saved to ${path}`, resumeJob: null })
  } catch (error) { set({ busy: false, status: String(error), resumeJob: id }) }
}
export async function cancelMotion() {
  try { await invoke('cancel_motion'); set({ ...job, status: 'Stopping at a safe boundary…' }) }
  catch (error) { set({ ...job, status: String(error) }) }
}
