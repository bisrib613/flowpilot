import { invoke } from "@tauri-apps/api/core"

export type StoredAccount = {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
  avatar: string
  favorite: boolean
  order: number
  service?: "flow" | "dola" | "leonardo" | "chatgpt" | "migoo"
  flowSessionId?: string
}

const STORAGE_KEY = "flowpilot-accounts"
const SERVICES = new Set(["flow", "dola", "leonardo", "chatgpt", "migoo"])

function isAccount(value: unknown): value is StoredAccount {
  if (!value || typeof value !== "object") return false
  const account = value as Partial<StoredAccount>
  return (
    typeof account.id === "string" &&
    typeof account.name === "string" &&
    (account.email === null || typeof account.email === "string") &&
    (account.avatarUrl === null || typeof account.avatarUrl === "string") &&
    typeof account.avatar === "string" &&
    typeof account.favorite === "boolean" &&
    typeof account.order === "number" &&
    (account.service === undefined || SERVICES.has(account.service)) &&
    (account.flowSessionId === undefined || (
      typeof account.flowSessionId === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(account.flowSessionId) &&
      account.service !== undefined && account.service !== "flow"
    ))
  )
}

export async function loadAccounts(): Promise<StoredAccount[]> {
  try {
    const native = await invoke<unknown>("load_accounts")
    if (native !== null && native !== undefined) {
      if (!Array.isArray(native) || !native.every(isAccount)) throw new Error("Invalid stored account data")
      localStorage.removeItem(STORAGE_KEY)
      return [...native].sort((a, b) => a.order - b.order)
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed) || !parsed.every(isAccount)) throw new Error("Invalid stored account data")
      await invoke("save_accounts", { accounts: parsed })
      localStorage.removeItem(STORAGE_KEY)
      return [...parsed].sort((a, b) => a.order - b.order)
    }
    return []
  } catch (error) {
    console.error("Flowpilot account data could not be loaded", error)
    return []
  }
}

export async function saveAccounts(accounts: StoredAccount[]) {
  try {
    if (!accounts.every(isAccount)) throw new Error("Invalid account data")
    await invoke("save_accounts", { accounts })
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.error("Flowpilot account data could not be saved", error)
  }
}
