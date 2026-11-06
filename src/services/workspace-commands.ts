import { invoke } from "@tauri-apps/api/core"

export class WorkspaceCommandCancelled extends Error {}

let pending: Promise<unknown> = Promise.resolve()

// One ordered path for the shell's native controller operations. A discarded
// React effect may skip queued work, but its hide still precedes the next open.
export function workspaceCommand<T = void>(command: string, args: Record<string, unknown>, current = () => true): Promise<T> {
  const result = pending.then(() => {
    if (!current()) throw new WorkspaceCommandCancelled()
    return invoke<T>(command, args)
  })
  pending = result.catch(() => undefined)
  return result
}
