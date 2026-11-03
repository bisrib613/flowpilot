import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { listen } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import packageJson from "../package.json"
import { neighborIndices, shortcutBounds, readPreloadSides, rememberWorkspace, forgetWorkspaces, resumableAccount, type WorkspaceMemory, type WorkspaceCloseScope } from "./services/workspace-policy"
import { loadAccounts, saveAccounts } from "./services/account-store"
import { availableSharedSources, defaultSortDirection, PROFILE_SORT_OPTIONS, readProfileSort, sortProfileCards, type ProfileSort, type ProfileSortKey } from "./services/profile-features"

type ServiceId = "flow" | "dola" | "leonardo" | "chatgpt" | "migoo" | "claude"
type AppView = "accounts" | "favorites" | "settings" | "flow"
type BookmarkServiceId = "flow" | "chatgpt"
type ServiceBookmark = {
  id: string
  name: string
  url: string
}
type Account = {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
  avatar: string
  favorite: boolean
  order: number
  addedAt?: number
  lastOpenedAt?: number
  service?: ServiceId
  flowSessionId?: string
}
const SERVICES: Record<ServiceId, { name: string; shortName: string; logo: string; url: string }> = {
  flow: { name: "Google Flow", shortName: "Flow", logo: "/flow-logo.png", url: "https://flow.google.com/" },
  dola: { name: "Dola", shortName: "Dola", logo: "/dola-logo.png", url: "https://www.dola.com/" },
  leonardo: { name: "Leonardo AI", shortName: "Leonardo", logo: "/leonardo-logo.png", url: "https://app.leonardo.ai/" },
  chatgpt: { name: "ChatGPT", shortName: "ChatGPT", logo: "/chatgpt-logo.png", url: "https://chatgpt.com/" },
  migoo: { name: "Migoo", shortName: "Migoo", logo: "/migoo-logo.png", url: "https://migoo.ai/home" },
  claude: { name: "Claude", shortName: "Claude", logo: "/claude-logo.svg", url: "https://claude.ai/" },
}
const serviceOf = (account: Account): ServiceId => account.service || "flow"
const BOOKMARK_STORAGE_KEYS: Record<BookmarkServiceId, string> = {
  flow: "flowpilot-flow-bookmarks",
  chatgpt: "flowpilot-chatgpt-bookmarks",
}
const supportsBookmarks = (service: ServiceId): service is BookmarkServiceId =>
  service === "flow" || service === "chatgpt"
const isBookmarkUrl = (service: BookmarkServiceId, value: string) => {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password
    ) return false
    if (service === "chatgpt") return url.hostname === "chatgpt.com"
    return (
      (url.hostname === "flow.google.com" &&
        (url.pathname === "/" || url.pathname.startsWith("/project/") || url.pathname.startsWith("/library"))) ||
      (url.hostname === "labs.google" &&
        (url.pathname === "/fx/tools/flow" || url.pathname.startsWith("/fx/tools/flow/")))
    )
  } catch {
    return false
  }
}
const loadBookmarks = (service: BookmarkServiceId): ServiceBookmark[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(BOOKMARK_STORAGE_KEYS[service]) || "[]")
    if (!Array.isArray(stored)) return []
    return stored.filter((item): item is ServiceBookmark => {
      if (!item || typeof item !== "object") return false
      const bookmark = item as Partial<ServiceBookmark>
      return (
        typeof bookmark.id === "string" &&
        typeof bookmark.name === "string" &&
        bookmark.name.trim().length > 0 &&
        bookmark.name.length <= 50 &&
        typeof bookmark.url === "string" &&
        bookmark.url.length <= 2048 &&
        isBookmarkUrl(service, bookmark.url)
      )
    })
  } catch {
    return []
  }
}
const APP_VERSION = packageJson.version
const TELEGRAM_CHANNEL_URL = ""

const bookmarkUrlExample = (service: BookmarkServiceId) =>
  service === "flow"
    ? "https://flow.google.com/project/..."
    : "https://chatgpt.com/..."
export default function App() {
  const [downloadNotice, setDownloadNotice] = useState("")
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen<string>("flowpilot-download", (event) => setDownloadNotice(event.payload)).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    }).catch((error) => console.error("Download status listener failed", error))
    return () => { disposed = true; unlisten?.() }
  }, [])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [bookmarksByService, setBookmarksByService] = useState<Record<BookmarkServiceId, ServiceBookmark[]>>(() => ({
    flow: loadBookmarks("flow"),
    chatgpt: loadBookmarks("chatgpt"),
  }))
  const [preloadSides, setPreloadSides] = useState(readPreloadSides)
  const [settingsTab, setSettingsTab] = useState("general")
  const [activeService, setActiveService] = useState<ServiceId>("flow")
  const [sortByService, setSortByService] = useState<Record<ServiceId, ProfileSort>>(() =>
    (Object.keys(SERVICES) as ServiceId[]).reduce((record, service) => {
      record[service] = readProfileSort(service)
      return record
    }, {} as Record<ServiceId, ProfileSort>)
  )
  const profileSort = sortByService[activeService]
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountStorageReady, setAccountStorageReady] = useState(false)
  const [accountStorageError, setAccountStorageError] = useState("")
  const [profile, setProfile] = useState<{
    name: string
    avatar: string | null
  }>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("flowpilot-profile") ||
          '{"name":"Flowpilot","avatar":null}'
      )
    } catch {
      return { name: "Flowpilot", avatar: null }
    }
  })
  const [query, setQuery] = useState("")
  const [view, setView] = useState<AppView>("accounts")
  const [active, setActive] = useState<Account | null>(null)
  const [workspaceMemory, setWorkspaceMemory] = useState<WorkspaceMemory>({})
  const [workspaceClosing, setWorkspaceClosing] = useState(false)
  const [fullView, setFullView] = useState(false)
  const [dialog, setDialog] = useState<Account | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [cacheNotice, setCacheNotice] = useState("")
  const [flowScanRunning, setFlowScanRunning] = useState(false)
  const [flowScanResults, setFlowScanResults] = useState<Record<string, string>>({})
  const flowScanLock = useRef(false)
  const [clearingCacheId, setClearingCacheId] = useState<string | null>(null)
  const [clearingAllCaches, setClearingAllCaches] = useState(false)
  const [addAccountOpen, setAddAccountOpen] = useState(false)
  const [bulkShareOpen, setBulkShareOpen] = useState(false)
  const [bulkShareSelected, setBulkShareSelected] = useState<string[]>([])
  const [bulkShareRunning, setBulkShareRunning] = useState(false)
  const [bulkShareProgress, setBulkShareProgress] = useState("")
  const [bulkShareResults, setBulkShareResults] = useState<Record<string, string>>({})
  const bulkShareStop = useRef(false)
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen<{ accountId: string; status: string }>("flowpilot-bulk-login-action", (event) => {
      if (event.payload.status === "consent_required") {
        setBulkShareResults((current) => ({
          ...current,
          [event.payload.accountId]: "Google approval required — click Continue in the popup",
        }))
      }
    }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    }).catch((error) => console.error("Bulk OAuth status listener failed", error))
    return () => { disposed = true; unlisten?.() }
  }, [])
  const [newAccountName, setNewAccountName] = useState("")
  const [googleAccountEmail, setGoogleAccountEmail] = useState("")
  const [flowSessionId, setFlowSessionId] = useState("")
  const [accountNameEdited, setAccountNameEdited] = useState(false)
  const [renamingAccount, setRenamingAccount] = useState<Account | null>(null)
  const [addAccountError, setAddAccountError] = useState("")
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragTargetId, setDragTargetId] = useState<string | null>(null)
  const [dragTargetAfter, setDragTargetAfter] = useState(false)
  const [dragOrderIds, setDragOrderIds] = useState<string[] | null>(null)
  const dragSourceRef = useRef<HTMLElement | null>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const dragSourceIdRef = useRef<string | null>(null)
  const dragTargetIdRef = useRef<string | null>(null)
  const dragInsertAfterRef = useRef(false)
  const handleRename = (a: Account) => {
    setRenamingAccount(a)
    setNewAccountName(a.name)
    setGoogleAccountEmail(a.email || "")
    setAddAccountError("")
    setAddAccountOpen(true)
    setMenu(null)
  }
  const handleDelete = (a: Account) => {
    setDialog(a)
    setMenu(null)
  }
  const confirmDelete = async () => {
    if (!dialog) return
    const removing = dialog
    try {
      const profileCleaned = await invoke<boolean>("remove_google_flow_account", {
        accountId: removing.id,
        service: serviceOf(removing),
      })
      if (!profileCleaned) {
        setCacheNotice("The session folder is still in use. Close sign-in windows, restart Flowpilot, then delete the profile again.")
        setDialog(null)
        return
      }
      setAccounts((current) => current.filter((account) => account.id !== removing.id))
      setWorkspaceMemory((current) => forgetWorkspaces(current, "profile", serviceOf(removing), removing.id))
      if (active?.id === removing.id) {
        setActive(null)
        setFullView(false)
        setView("accounts")
      }
      setDialog(null)
    } catch (error) {
      console.error("Unable to remove account", error)
    }
  }
  const handleClearAccountCache = async (a: Account) => {
    if (clearingCacheId || clearingAllCaches) return
    setMenu(null)
    setCacheNotice("")
    setClearingCacheId(a.id)
    try {
      await invoke("clear_google_flow_cache", { accountId: a.id, service: serviceOf(a) })
      setCacheNotice(`Cache cleared for ${a.name}. Cookies and login were kept.`)
    } catch (error) {
      console.error("Unable to clear account cache", error)
      setCacheNotice(`Unable to clear cache for ${a.name}. Please try again.`)
    } finally {
      setClearingCacheId(null)
    }
  }
  const handleClearAllAccountCaches = async () => {
    if (clearingCacheId || clearingAllCaches) return
    setCacheNotice("")
    setClearingAllCaches(true)
    try {
      for (const account of accounts) {
        setClearingCacheId(account.id)
        await invoke("clear_google_flow_cache", { accountId: account.id, service: serviceOf(account) })
      }
      setCacheNotice(
        accounts.length === 0
          ? "No account caches to clear."
          : `Cleared caches for ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}. Cookies and login were kept.`
      )
    } catch (error) {
      console.error("Unable to clear all account caches", error)
      setCacheNotice("Some account caches could not be cleared. Please try again.")
    } finally {
      setClearingCacheId(null)
      setClearingAllCaches(false)
    }
  }
  const checkAllFlowProfiles = async () => {
    if (flowScanLock.current || !accountStorageReady) return
    flowScanLock.current = true
    setFlowScanRunning(true)
    setActiveService("flow")
    setView("accounts")
    setFlowScanResults({})
    const target = accounts.filter((a) => serviceOf(a) === "flow")
    try {
      if (!(await invoke<boolean>("google_relogin_status"))) {
        setCacheNotice("Enable Google Flow auto re-login in Settings first.")
        return
      }
      for (const account of target) {
        setFlowScanResults((current) => ({ ...current, [account.id]: "Checking…" }))
        try {
          const status = await invoke<string>("check_flow_profile", { accountId: account.id })
          const label: Record<string, string> = {
            signed_in: "Signed in",
            no_previous_session: "Not previously signed in",
            relogin_unconfirmed: "Re-login attempted · verify manually",
            google_auth_pending: "Google sign-in pending · skipped",
            verification_skipped: "Skipped — CAPTCHA or verification required",
            unknown: "Could not confirm login status",
          }
          setFlowScanResults((current) => ({ ...current, [account.id]: label[status] || "Unknown status" }))
        } catch (error) {
          setFlowScanResults((current) => ({ ...current, [account.id]: `Check failed: ${String(error)}` }))
        }
      }
      setCacheNotice(`Checked ${target.length} Google Flow profile${target.length === 1 ? "" : "s"}. Review each result below.`)
    } catch (error) {
      setCacheNotice(`Could not begin Google Flow check: ${String(error)}`)
    } finally {
      flowScanLock.current = false
      setFlowScanRunning(false)
    }
  }
  const handleToggleFavorite = (a: Account) => {
    setAccounts(
      accounts.map((x) => (x.id === a.id ? { ...x, favorite: !x.favorite } : x))
    )
    setMenu(null)
  }
  const saveProfileSort = (sort: ProfileSort) => {
    setSortByService((current) => ({ ...current, [activeService]: sort }))
    try { localStorage.setItem(`flowpilot-sort-${activeService}`, `${sort.key}:${sort.direction}`) }
    catch { /* optional preference */ }
    setDragOrderIds(null)
  }
  const changeProfileSort = (key: ProfileSortKey) =>
    saveProfileSort({ key, direction: defaultSortDirection(key) })
  const reverseProfileSort = () =>
    saveProfileSort({ ...profileSort, direction: profileSort.direction === "asc" ? "desc" : "asc" })
  const openBulkShare = () => {
    setBulkShareSelected([])
    setAddAccountError("")
    setBulkShareOpen(true)
    setMenu(null)
  }
  const createBulkSharedProfiles = async () => {
    if (!accountStorageReady || bulkShareRunning || activeService === "flow" || !bulkShareSelected.length) return
    const eligible = new Set(shareableSources.map((source) => source.id))
    const sources = accounts.filter((account) => serviceOf(account) === "flow" &&
      eligible.has(account.id) && bulkShareSelected.includes(account.id))
    const service = activeService
    const target = accounts.filter((account) => serviceOf(account) === service)
    const linked = new Set(target.map((account) => account.flowSessionId).filter(Boolean))
    const startOrder = Math.max(-1, ...target.map((account) => account.order)) + 1
    const now = Date.now()
    const additions = sources.filter((source) => !linked.has(source.id))
      .map((source, index): Account => ({
        id: crypto.randomUUID(),
        name: source.name.slice(0, 80),
        email: null,
        avatarUrl: SERVICES[service].logo,
        avatar: "NF",
        favorite: false,
        order: startOrder + index,
        addedAt: now + index,
        service,
        flowSessionId: source.id,
      }))
    if (!additions.length) {
      setBulkShareOpen(false)
      return
    }
    // Native batch login resolves the linked Flow directory from saved
    // account metadata; persist that metadata BEFORE opening a service WebView.
    const nextAccounts = [...accounts, ...additions]
    setBulkShareRunning(true)
    setBulkShareProgress("Saving linked profiles…")
    try {
      await saveAccounts(nextAccounts)
    } catch (error) {
      setAddAccountError(`Could not save shared profiles: ${String(error)}`)
      setBulkShareRunning(false)
      setBulkShareProgress("")
      return
    }
    setAccounts(nextAccounts)
    setBulkShareOpen(false)
    setBulkShareSelected([])
    setBulkShareResults({})
    setBulkShareRunning(true)
    bulkShareStop.current = false
    const statusLabels: Record<string, string> = {
      signed_in: "Signed in",
      invalid_session: "Invalid Flow session",
      needs_attention: "Needs attention — open the profile to continue",
      verification_required: "CAPTCHA required — open the profile to continue",
      signup_required: "Signup needs attention — open the profile to continue",
      onboarding_required: "Onboarding needs attention — open the profile to continue",
      reauth_required: "Service requested sign-in again — open the profile",
      consent_required: "Google approval pending — popup left open",
      login_unconfirmed: "Login not confirmed",
      login_button_not_found: "Google sign-in button not found",
    }
    try {
      for (let index = 0; index < additions.length; index++) {
        const account = additions[index]
        if (bulkShareStop.current) {
          setBulkShareResults((current) => ({ ...current, [account.id]: "Stopped" }))
          continue
        }
        setBulkShareProgress(`${index + 1} / ${additions.length} · ${account.name}`)
        setBulkShareResults((current) => ({ ...current, [account.id]: "Signing in…" }))
        try {
          const status = await invoke<string>("run_bulk_shared_login", {
            accountId: account.id, service,
          })
          setBulkShareResults((current) => ({
            ...current, [account.id]: statusLabels[status] || "Login not confirmed",
          }))
        } catch (error) {
          const invalid = String(error).includes("invalid_flow_session")
          setBulkShareResults((current) => ({
            ...current, [account.id]: invalid ? "Invalid Flow session" : `Login failed: ${String(error)}`,
          }))
        }
      }
    } finally {
      setBulkShareProgress("")
      setBulkShareRunning(false)
      setCacheNotice(`Created ${additions.length} shared ${SERVICES[service].shortName} profiles. Check the sign-in results; Google may require manual consent.`)
    }
  }
  const markProfileOpened = (account: Account) => {
    const timestamp = Date.now()
    setAccounts((current) => current.map((item) =>
      item.id === account.id ? { ...item, lastOpenedAt: timestamp } : item))
  }
  const openProfile = (account: Account) => {
    markProfileOpened(account)
    setActiveService(serviceOf(account))
    setActive(account)
    setView("flow")
  }
  const selectService = (service: ServiceId) => {
    if (workspaceClosing) return
    setActiveService(service)
    setQuery("")
    setMenu(null)
    const remembered = resumableAccount(accounts, workspaceMemory, service)
    if (remembered) openProfile(remembered)
    else {
      setActive(null)
      setView("accounts")
    }
  }
  const handleAddAccount = () => {
    setRenamingAccount(null)
    setFlowSessionId("")
    setAccountNameEdited(false)
    setNewAccountName("")
    setGoogleAccountEmail("")
    setAddAccountError("")
    setAddAccountOpen(true)
  }
  const createAccount = () => {
    const name = newAccountName.trim()
    if (!name) {
      setAddAccountError("Please enter an account name.")
      return
    }
    if (name.length > 80) {
      setAddAccountError("Account name must be 80 characters or fewer.")
      return
    }
    const googleEmail = googleAccountEmail.trim().toLowerCase()
    if ((renamingAccount ? serviceOf(renamingAccount) : activeService) === "flow" && googleEmail &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleEmail)) {
      setAddAccountError("Enter a valid Google email, or leave it blank.")
      return
    }
    if (renamingAccount) {
      setAccounts((current) => current.map((account) => account.id === renamingAccount.id
        ? { ...account, name, ...(serviceOf(account) === "flow" ? { email: googleEmail || null } : {}) }
        : account))
      setAddAccountOpen(false)
      setRenamingAccount(null)
      return
    }
    const source = flowSessionId ? accounts.find((account) => account.id === flowSessionId && serviceOf(account) === "flow") : undefined
    if (flowSessionId && !source) {
      setAddAccountError("The selected Flow profile is no longer available. Select another profile or normal login.")
      return
    }
    if (source && accounts.some((account) => serviceOf(account) === activeService && account.flowSessionId === source.id)) {
      setAddAccountError("This service already has a profile using that Flow session. Open the existing profile or select another session.")
      return
    }
    const a: Account = {
      id: crypto.randomUUID(),
      name,
      email: activeService === "flow" ? googleEmail || null : null,
      avatarUrl: SERVICES[activeService].logo,
      avatar: "NF",
      favorite: false,
      order: Math.max(-1, ...accounts.filter((account) => serviceOf(account) === activeService)
        .map((account) => account.order)) + 1,
      addedAt: Date.now(),
      service: activeService,
      ...(source && activeService !== "flow" ? { flowSessionId: source.id } : {}),
    }
    setAccounts([...accounts, a])
    setAddAccountOpen(false)
  }
  const updateProfileAvatar = (avatar: string) => {
    const next = { ...profile, avatar }
    setProfile(next)
    localStorage.setItem("flowpilot-profile", JSON.stringify(next))
  }
  useEffect(() => {
    if (accountsLoaded) return
    void loadAccounts().then((saved) => {
      setAccounts(saved as Account[])
      setAccountStorageReady(true)
    }).catch((error) => {
      console.error("Account storage is unavailable", error)
      setAccountStorageError("Account data could not be loaded. Changes are disabled to protect existing accounts.")
    }).finally(() => setAccountsLoaded(true))
  }, [accountsLoaded])
  useEffect(() => {
    if (!accountsLoaded || !accountStorageReady) return
    void saveAccounts(accounts).then(() => setAccountStorageError("")).catch((error) => {
      console.error("Account changes could not be saved", error)
      setAccountStorageError("Account changes could not be saved. Do not close Flowpilot until the storage issue is resolved.")
    })
  }, [accounts, accountsLoaded, accountStorageReady])
  useEffect(() => {
    try {
      localStorage.setItem(BOOKMARK_STORAGE_KEYS.flow, JSON.stringify(bookmarksByService.flow))
      localStorage.setItem(BOOKMARK_STORAGE_KEYS.chatgpt, JSON.stringify(bookmarksByService.chatgpt))
    } catch (error) {
      console.error("Bookmarks could not be saved", error)
    }
  }, [bookmarksByService])
  useEffect(() => {
    const activeStillExists = active !== null && accounts.some((account) => account.id === active.id)
    if (view === "flow" && !activeStillExists) {
      setActive(null)
      setFullView(false)
      setView("accounts")
    } else if (view !== "flow" && fullView) {
      setFullView(false)
    }
  }, [active, accounts, view, fullView])
  const serviceAccounts = useMemo(
    () => accounts.filter((account) => serviceOf(account) === activeService).sort((a, b) => a.order - b.order),
    [accounts, activeService]
  )
  const shareableSources = useMemo(
    () => availableSharedSources(
      accounts.filter((account) => serviceOf(account) === "flow"),
      accounts.filter((account) => serviceOf(account) === activeService)
    ),
    [accounts, activeService]
  )
  const favoriteCount = accounts.filter((a) => a.favorite).length
  const visible = useMemo(
    () =>
      (view === "favorites" ? accounts : serviceAccounts).filter(
        (a) =>
          (view !== "favorites" || a.favorite) &&
          `${a.name} ${a.email}`.toLowerCase().includes(query.toLowerCase())
      ),
    [accounts, serviceAccounts, query, view]
  )
  const displayed = useMemo(() => {
    if (dragOrderIds && view === "accounts" && profileSort.key === "manual") {
      const byId = new Map(visible.map((account) => [account.id, account]))
      return dragOrderIds.map((id) => byId.get(id)).filter(Boolean) as Account[]
    }
    return view === "accounts" ? sortProfileCards(visible, profileSort) : visible
  }, [dragOrderIds, view, visible, profileSort])
  const finishPointerDrag = (commit: boolean) => {
    const sourceId = dragSourceIdRef.current
    const targetId = dragTargetIdRef.current
    if (commit && sourceId && targetId && sourceId !== targetId) {
      setAccounts((current) => {
        const service = current.find((account) => account.id === sourceId)
        if (!service) return current
        const serviceId = serviceOf(service)
        const ordered = current
          .filter((account) => serviceOf(account) === serviceId)
          .sort((a, b) => a.order - b.order)
        const sourceIndex = ordered.findIndex((account) => account.id === sourceId)
        if (sourceIndex < 0 || !ordered.some((account) => account.id === targetId)) return current
        const [moved] = ordered.splice(sourceIndex, 1)
        const targetIndex = ordered.findIndex((account) => account.id === targetId)
        ordered.splice(targetIndex + (dragInsertAfterRef.current ? 1 : 0), 0, moved)
        const orderById = new Map(ordered.map((account, index) => [account.id, index]))
        return current.map((account) =>
          serviceOf(account) === serviceId
            ? { ...account, order: orderById.get(account.id) ?? account.order }
            : account
        )
      })
    }
    if (dragSourceRef.current && dragPointerIdRef.current !== null) {
      try { dragSourceRef.current.releasePointerCapture(dragPointerIdRef.current) } catch { /* already released */ }
    }
    dragSourceRef.current = null
    dragPointerIdRef.current = null
    dragSourceIdRef.current = null
    dragTargetIdRef.current = null
    setDraggingId(null)
    setDragTargetId(null)
    setDragTargetAfter(false)
    setDragOrderIds(null)
  }
  useEffect(() => {
    const accountAtPoint = (x: number, y: number) => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("[data-account-id]"))
        .filter((element) => element.dataset.accountId !== dragSourceIdRef.current)
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      const hit = candidates.find(({ rect }) =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      )
      if (hit) return { id: hit.element.dataset.accountId || null, after: y > (hit.rect.top + hit.rect.bottom) / 2 }
      const nearest = candidates
        .map(({ element, rect }) => ({
          element,
          rect,
          distance: Math.abs((rect.top + rect.bottom) / 2 - y),
        }))
        .sort((a, b) => a.distance - b.distance)[0]
      if (!nearest) return null
      return { id: nearest.element.dataset.accountId || null, after: y > (nearest.rect.top + nearest.rect.bottom) / 2 }
    }
    const onMove = (event: PointerEvent) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      const hit = accountAtPoint(event.clientX, event.clientY)
      const targetId = hit?.id || null
      dragInsertAfterRef.current = hit?.after || false
      dragTargetIdRef.current = targetId
      setDragTargetId(targetId)
      setDragTargetAfter(hit?.after || false)
      if (targetId) setDragOrderIds((current) => {
        const ids = current || serviceAccounts.map((account) => account.id)
        const from = ids.indexOf(dragSourceIdRef.current || "")
        const to = ids.indexOf(targetId)
        if (from < 0 || to < 0 || from === to) return ids
        const next = [...ids]
        const [moved] = next.splice(from, 1)
        const targetIndex = next.indexOf(targetId)
        next.splice(targetIndex + (dragInsertAfterRef.current ? 1 : 0), 0, moved)
        return next
      })
    }
    const onUp = (event: PointerEvent) => {
      if (dragPointerIdRef.current === event.pointerId) finishPointerDrag(true)
    }
    const onCancel = (event: PointerEvent) => {
      if (dragPointerIdRef.current === event.pointerId) finishPointerDrag(false)
    }
    window.addEventListener("pointermove", onMove, { passive: false })
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
    }
  }, [accounts, serviceAccounts])
  const beginPointerDrag = (id: string, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || view !== "accounts" || query.trim() || profileSort.key !== "manual") return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragSourceRef.current = event.currentTarget
    dragPointerIdRef.current = event.pointerId
    dragSourceIdRef.current = id
    dragTargetIdRef.current = null
    dragInsertAfterRef.current = false
    setDraggingId(id)
    setDragTargetId(null)
    setDragTargetAfter(false)
    setDragOrderIds(serviceAccounts.map((account) => account.id))
  }
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setMenu(null)
      setDialog(null)
      setAddAccountOpen(false)
      setBulkShareOpen(false)
    }
    window.addEventListener("keydown", dismiss)
    return () => window.removeEventListener("keydown", dismiss)
  }, [])
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: MouseEvent) => {
      if (!(event.target as Element).closest(".menu-wrap")) setMenu(null)
    }
    document.addEventListener("click", dismiss)
    return () => document.removeEventListener("click", dismiss)
  }, [menu])
  useEffect(() => {
    if (!dialog && !addAccountOpen && !bulkShareOpen) return
    const previousFocus = document.activeElement as HTMLElement | null
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return
      const controls = document.querySelectorAll<HTMLElement>('.dialog button:not(:disabled), .dialog input:not(:disabled), .dialog select:not(:disabled)')
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener("keydown", trapFocus)
    return () => {
      document.removeEventListener("keydown", trapFocus)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [dialog, addAccountOpen, bulkShareOpen])
  if (view === "flow" && active)
    return (
      <div className={`app ${fullView ? "full" : ""}`}>
        {!fullView && <Sidebar view="flow" setView={setView} accounts={accounts} activeService={activeService} onService={selectService} disabled={workspaceClosing} />}
        <main className="content flow-content">
          <FlowShell
            downloadNotice={downloadNotice}
            onDismissDownload={() => setDownloadNotice("")}
            account={active}
            preloadSides={preloadSides}
            onOpened={(account) => setWorkspaceMemory((current) => rememberWorkspace(current, serviceOf(account), account.id))}
            onClosingChange={setWorkspaceClosing}
            onClosed={(scope) => {
              setWorkspaceMemory((current) => forgetWorkspaces(current, scope, serviceOf(active), active.id))
              setActive(null)
              setFullView(false)
              setView("accounts")
            }}
            accounts={serviceAccounts}
            bookmarks={
              supportsBookmarks(serviceOf(active))
                ? bookmarksByService[serviceOf(active) as BookmarkServiceId]
                : []
            }
            fullView={fullView}
            onToggleFullView={() => setFullView((current) => !current)}
            onSelectAccount={(account) => {
              if (account.id !== active.id) {
                markProfileOpened(account)
                setActive(account)
              }
            }}
            onSaveBookmark={(id, name, url) => {
              const bookmarkService = serviceOf(active)
              if (!supportsBookmarks(bookmarkService)) return "Bookmarks are not available for this service."
              const cleanName = name.trim()
              const cleanUrl = url.trim()
              if (!cleanName) return "Enter a bookmark name."
              if (cleanName.length > 50) return "Bookmark name must be 50 characters or fewer."
              if (cleanUrl.length > 2048 || !isBookmarkUrl(bookmarkService, cleanUrl)) {
                return `Enter a valid ${SERVICES[bookmarkService].name} URL starting with ${bookmarkUrlExample(bookmarkService)}`
              }
              const serviceBookmarks = bookmarksByService[bookmarkService]
              if (serviceBookmarks.some((bookmark) => bookmark.id !== id && bookmark.url === cleanUrl)) {
                return `That ${SERVICES[bookmarkService].shortName} URL is already bookmarked.`
              }
              setBookmarksByService((current) => ({
                ...current,
                [bookmarkService]: id
                  ? current[bookmarkService].map((bookmark) =>
                      bookmark.id === id ? { ...bookmark, name: cleanName, url: cleanUrl } : bookmark
                    )
                  : [...current[bookmarkService], { id: crypto.randomUUID(), name: cleanName, url: cleanUrl }],
              }))
              return null
            }}
            onDeleteBookmark={(id) => {
              const bookmarkService = serviceOf(active)
              if (!supportsBookmarks(bookmarkService)) return
              setBookmarksByService((current) => ({
                ...current,
                [bookmarkService]: current[bookmarkService].filter((bookmark) => bookmark.id !== id),
              }))
            }}
            onBack={() => {
              void invoke("close_google_flow", { accountId: active.id, service: serviceOf(active) })
              setFullView(false)
              setView("accounts")
            }}
            onAddAccount={() => {
              setFullView(false)
              setView("accounts")
              handleAddAccount()
            }}
          />
        </main>
      </div>
    )
  return (
    <div className="app">
      <Sidebar view={view} setView={setView} accounts={accounts} activeService={activeService} onService={selectService} />
      <main className={`content ${view === "accounts" || view === "favorites" ? "accounts-page" : ""}`}>
        <DownloadNotice message={downloadNotice} onDismiss={() => setDownloadNotice("")} />
        <header>
          <div>
            <div className="eyebrow page-eyebrow" aria-hidden="true">
              FLOWPILOT /{" "}
              {view === "settings"
                ? "SETTINGS"
                : view === "favorites"
                ? "FAVORITES"
                : view.toUpperCase()}
            </div>
            <h1>
              {view === "settings"
                ? "Settings"
                : view === "favorites"
                ? "Favorite Accounts"
                : SERVICES[activeService].name}
            </h1>
            <p>
              {view === "settings"
                ? "Keep Flowpilot personal, private, and ready to use."
                : view === "favorites"
                ? "Your favorite accounts across all services."
                : `Manage your ${SERVICES[activeService].name} accounts in one place.`}
            </p>
            {view === "accounts" && (
              <div className="account-count">
                {serviceAccounts.length}{" "}
                {serviceAccounts.length === 1 ? "profile" : "profiles"} in {SERVICES[activeService].name}
              </div>
            )}
            {view === "favorites" && (
              <div className="account-count">{favoriteCount} Favorites</div>
            )}
          </div>
          {(view === "accounts" || view === "favorites") && (
            <div className="header-actions">
              {view === "accounts" && (
                <div className="profile-sort-controls">
                  <label className="profile-sort-wrap">
                    <span>Sort</span>
                    <select aria-label="Sort profiles" className="profile-sort" value={profileSort.key}
                      onChange={(event) => changeProfileSort(event.target.value as ProfileSortKey)}>
                      {PROFILE_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  {profileSort.key !== "manual" && (
                    <button type="button" className="secondary profile-sort-direction" onClick={reverseProfileSort}
                      aria-label={profileSort.direction === "asc" ? "Sort ascending. Switch to descending" : "Sort descending. Switch to ascending"}
                      title={profileSort.direction === "asc" ? "Ascending · click for descending" : "Descending · click for ascending"}>
                      {profileSort.direction === "asc" ? "↑" : "↓"}
                    </button>
                  )}
                </div>
              )}
              <div className="search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
                <input
                  aria-label="Search accounts"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search accounts..."
                />
              </div>
              {view === "accounts" && activeService === "flow" && (
                <button className="secondary" disabled={!accountStorageReady || flowScanRunning || serviceAccounts.length === 0}
                  onClick={() => void checkAllFlowProfiles()}>
                  {flowScanRunning ? "Checking Flow profiles…" : "Check & Re-login All"}
                </button>
              )}
              {view === "accounts" && activeService !== "flow" && (
                <button className="secondary" disabled={!accountStorageReady || bulkShareRunning || shareableSources.length === 0}
                  onClick={openBulkShare}>+ Bulk share</button>
              )}
              {view === "accounts" && <button className="primary" disabled={!accountStorageReady || flowScanRunning || bulkShareRunning} onClick={handleAddAccount}>
                + Add account
              </button>}
            </div>
          )}
        </header>
        {accountStorageError && <div className="cache-status" role="alert">{accountStorageError}</div>}
        {cacheNotice && (
          <div className="cache-status" role="status">
            <span>{cacheNotice}</span>
            <button type="button" aria-label="Dismiss cache status" onClick={() => setCacheNotice("")}>×</button>
          </div>
        )}
        {view === "accounts" && activeService !== "flow" && (bulkShareRunning || Object.keys(bulkShareResults).length > 0) && (
          <section className="cache-status bulk-login-report" role="status" aria-label="Bulk shared Google sign-in results">
            <div>
              <strong>Bulk Google sign-in {bulkShareRunning ? `· ${bulkShareProgress}` : "· completed"}</strong>
              <ul>
                {accounts.filter((a) => serviceOf(a) === activeService && bulkShareResults[a.id]).map((a) => (
                  <li key={a.id}>{a.name}: {bulkShareResults[a.id]}</li>
                ))}
              </ul>
            </div>
            {bulkShareRunning && <button type="button" onClick={() => { bulkShareStop.current = true }}>
              Stop after current profile
            </button>}
          </section>
        )}
        {view === "accounts" && activeService === "flow" && Object.keys(flowScanResults).length > 0 && (
          <section className="cache-status" role="status" aria-label="Google Flow profile check results">
            <strong>Google Flow session check</strong>
            <ul>
              {serviceAccounts.filter((a) => flowScanResults[a.id]).map((a) => (
                <li key={a.id}>{a.name}: {flowScanResults[a.id]}</li>
              ))}
            </ul>
          </section>
        )}
        {view === "settings" ? (
          <>
          <nav className="settings-tabs" aria-label="Settings sections">
            {["general", "updates", "help"].map((tab) => <button key={tab} className={settingsTab === tab ? "active" : ""} aria-pressed={settingsTab === tab} onClick={() => setSettingsTab(tab)}>{tab === "help" ? "Help & info" : tab[0].toUpperCase() + tab.slice(1)}</button>)}
          </nav>
          {settingsTab === "general" ? <>
          <DownloadSettings />
          <GoogleReLoginSettings onEnabled={() => void checkAllFlowProfiles()} />
          <NameGeneratorSettings />
          <section className="preload-setting">
            <div><h2>Account preload</h2><p>Keep up to this many accounts ready on each side of the current profile, per service. More accounts use more memory.</p></div>
            <label htmlFor="preload-sides">Accounts per side</label>
            <select id="preload-sides" value={preloadSides} onChange={(event) => { const value = Number(event.target.value); setPreloadSides(value); localStorage.setItem("flowpilot-preload-sides", String(value)) }}>
              {[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value === 0 ? "Off" : value}</option>)}
            </select>
            <p>Up to {2 * preloadSides + 1} open profiles per service. Applied when you next open a profile. Shortcut buttons are independent of this setting.</p>
          </section>
          <Settings
            profile={profile}
            onAvatarChange={updateProfileAvatar}
            accountCount={accounts.length}
            clearingAllCaches={clearingAllCaches}
            onClearAllCaches={() => void handleClearAllAccountCaches()}
          />
          </> : settingsTab === "updates" ? <UpdatesPage /> : <InfoPage />}
          </>
        ) : (
          <>
            {!accountsLoaded && <p className="account-empty" role="status">Loading accounts...</p>}
            {accountsLoaded && accountStorageReady && displayed.length === 0 && (
              <div className="account-empty" role="status">
                <h2>{query ? "No matching accounts" : view === "favorites" ? "No favorites yet" : `No ${SERVICES[activeService].shortName} accounts yet`}</h2>
                <p>{query ? "Try a different profile name." : view === "favorites" ? "Mark an account as a favorite to find it here." : "Add an account to create your first profile for this service."}</p>
              </div>
            )}
            <div className="grid">
              {displayed.map((a) => (
                <Card
                  key={a.id}
                  a={a}
                  menuOpen={menu === a.id}
                  onMenu={() => setMenu(menu === a.id ? null : a.id)}
                  onOpen={() => openProfile(a)}
                  onFavorite={() => handleToggleFavorite(a)}
                  onDelete={() => handleDelete(a)}
                  onRename={() => handleRename(a)}
                  onClearCache={() => void handleClearAccountCache(a)}
                  cacheBusy={clearingCacheId === a.id || clearingAllCaches}
                  dragEnabled={view === "accounts" && profileSort.key === "manual" && !query.trim()}
                  isDragging={draggingId === a.id}
                  dropPosition={
                    dragTargetId === a.id
                      ? dragTargetAfter ? "after" : "before"
                      : null
                  }
                  onPointerDown={(event) => beginPointerDrag(a.id, event)}
                />
              ))}

            </div>
          </>
        )}
        {dialog && (
          <div className="overlay">
            <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
              <h2 id="delete-title">Delete {dialog.name}?</h2>
              <p>
                This removes this profile from Flowpilot. Browser data is deleted only when this profile owns the session folder and no other profile uses it. It does not delete your account with the service.
              </p>
              {accounts.some((a) => a.id !== dialog.id && (a.flowSessionId || (serviceOf(a) === "flow" ? a.id : null)) === (dialog.flowSessionId || (serviceOf(dialog) === "flow" ? dialog.id : ""))) && (
                <p className="session-note">This session is also used by {accounts.filter((a) => a.id !== dialog.id && (a.flowSessionId || (serviceOf(a) === "flow" ? a.id : null)) === (dialog.flowSessionId || (serviceOf(dialog) === "flow" ? dialog.id : ""))).map((a) => `${SERVICES[serviceOf(a)].shortName}: ${a.name}`).join(", ")}. Their browser data and saved logins will be kept.</p>
              )}
              {dialog.flowSessionId && <p className="session-note">The borrowed Flow session will be kept, including this platform's login stored in that shared session.</p>}
              <div className="dialog-actions">
                <button autoFocus className="secondary" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button
                  className="danger"
                  onClick={() => void confirmDelete()}
                >
                  Delete account
                </button>
              </div>
            </div>
          </div>
        )}
        {bulkShareOpen && activeService !== "flow" && (
          <div className="overlay">
            <div className="dialog bulk-share-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-share-title">
              <h2 id="bulk-share-title">Bulk share to {SERVICES[activeService].name}</h2>
              <p>Select existing Google Flow profiles. Each source creates one linked
                {SERVICES[activeService].shortName} profile without copying or deleting login data.</p>
              <div className="bulk-share-actions">
                <button className="secondary" type="button" onClick={() => setBulkShareSelected(shareableSources.map((a) => a.id))}>Select all</button>
                <button className="secondary" type="button" onClick={() => setBulkShareSelected([])}>Clear</button>
                <span>{bulkShareSelected.length} selected / {shareableSources.length} available</span>
              </div>
              <div className="bulk-share-source-list" role="group" aria-label="Google Flow source profiles">
                {shareableSources.length === 0 ? <p>No unlinked Flow profiles available for this service.</p> :
                  shareableSources.map((source) => (
                    <label key={source.id} className="bulk-share-source">
                      <input type="checkbox" checked={bulkShareSelected.includes(source.id)}
                        onChange={(event) => setBulkShareSelected((current) =>
                          event.target.checked
                            ? [...current, source.id]
                            : current.filter((id) => id !== source.id)
                        )} />
                      <span>{source.name}</span>
                    </label>
                  ))}
              </div>
              <p className="session-note">Existing links are excluded. After adding, Flowpilot automatically
                opens each service, selects Google sign-in, and checks the result using its shared Flow session.
                No fresh Google password login is attempted.</p>
              {addAccountError && <p className="dialog-error" role="alert">{addAccountError}</p>}
              <div className="dialog-actions">
                <button className="secondary" onClick={() => setBulkShareOpen(false)}>Cancel</button>
                <button className="primary" disabled={!bulkShareSelected.length || bulkShareRunning}
                  onClick={() => void createBulkSharedProfiles()}>
                  {bulkShareRunning ? "Saving…" : `Add & sign in ${bulkShareSelected.length} profiles`}
                </button>
              </div>
            </div>
          </div>
        )}
        {addAccountOpen && (
          <div className="overlay">
            <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
              <h2 id="add-account-title">{renamingAccount ? "Rename account" : "Add account"}</h2>
              <p>{renamingAccount ? "Choose a name you can recognize in your account list." : `Create a profile for ${SERVICES[activeService].name}. You can sign in after opening it.`}</p>
              {!renamingAccount && activeService !== "flow" && accounts.some((a) => serviceOf(a) === "flow") && (
                <>
                  <label className="field-label" htmlFor="flow-session">Session (optional)</label>
                  <p id="session-help" className="session-note">Choose a Flow profile to use its Google session, or keep normal login for a separate profile.</p>
                  <select aria-describedby="session-help" id="flow-session" className="session-select" value={flowSessionId} onChange={(event) => {
                    const id = event.target.value
                    setFlowSessionId(id)
                    setAddAccountError("")
                    if (!accountNameEdited) setNewAccountName(accounts.find((a) => a.id === id)?.name || "")
                  }}>
                    <option value="">Normal login · Separate profile</option>
                    {accounts.filter((a) => serviceOf(a) === "flow").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  {flowSessionId && <p className="session-note">Open the account, then choose Continue with Google. This uses the selected Flow profile's browser session. Removing a linked profile keeps the source session and saved logins.</p>}
                </>
              )}
              <label className="field-label" htmlFor="account-name">Profile name</label>
              <input
                id="account-name"
                autoFocus
                value={newAccountName}
                onChange={(event) => {
                  setAccountNameEdited(true)
                  setNewAccountName(event.target.value)
                  setAddAccountError("")
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createAccount()
                }}
                placeholder="Enter account name"
                maxLength={80}
              />
              {(renamingAccount ? serviceOf(renamingAccount) : activeService) === "flow" && (
                 <>
                   <label className="field-label" htmlFor="google-account-email">Google email (optional)</label>
                   <input id="google-account-email" type="email" value={googleAccountEmail}
                     onChange={(event) => setGoogleAccountEmail(event.target.value)}
                     placeholder="email@gmail.com" maxLength={254} />
                   <p className="session-note">For matching an already-recognized account when Google shows multiple identities. If blank, auto re-login chooses only when exactly one is shown.</p>
                 </>
               )}
               {addAccountError && <p className="dialog-error">{addAccountError}</p>}
              <div className="dialog-actions">
                <button className="secondary" onClick={() => setAddAccountOpen(false)}>
                  Cancel
                </button>
                <button className="primary" onClick={createAccount}>
                  {renamingAccount ? "Save name" : "Add account"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
function Brand() {
  return (
    <div className="brand">
      <img className="brand-image" src="/foursquare.png" alt="Flowpilot logo" />
      <span>FLOWPILOT</span>
    </div>
  )
}
function Sidebar({
  view,
  setView,
  accounts, activeService, onService, disabled = false,
}: {
  accounts: Account[]
  activeService: ServiceId
  onService: (service: ServiceId) => void
  disabled?: boolean
  view: AppView
  setView: (view: AppView) => void
}) {
  return (
    <aside>
      <Brand />
      <div className="side-label">WORKSPACE</div>
      {(Object.keys(SERVICES) as ServiceId[]).map((id) => <button key={id}
        className={(view === "accounts" || view === "flow") && activeService === id ? "active" : ""}
        aria-current={(view === "accounts" || view === "flow") && activeService === id ? "page" : undefined}
        disabled={disabled} title={SERVICES[id].name} onClick={() => onService(id)}>
        <img className="sidebar-service-logo" src={SERVICES[id].logo} alt="" />
        <span>{SERVICES[id].shortName}</span><b className="service-count">{accounts.filter((a) => serviceOf(a) === id).length}</b>
      </button>)}
      <button disabled={disabled} className={view === "favorites" ? "active" : ""} title="Favorites" onClick={() => setView("favorites")}>
        <SidebarIcon name="favorites" /><span>Favorites</span>
      </button>
      <div className="sidebar-spacer" />
      <button disabled={disabled} className={view === "settings" ? "active" : ""} title="Settings" onClick={() => setView("settings")}>
        <SidebarIcon name="settings" /><span>Settings</span>
      </button>
      <div className="side-bottom">
        <img className="owner-avatar" src="/kuntyy-profile.svg" alt="" aria-hidden="true" />
        <span className="owner-label">I'M Kuntyy</span>
      </div>
    </aside>
  )
}
function SidebarIcon({ name }: { name: "favorites" | "settings" }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true }
  const paths = {
    favorites: <path d="m12 4 2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8L12 4Z" />,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.8" fill="currentColor" stroke="none" /></>,
  }
  return <svg className="sidebar-icon" {...common}>{paths[name]}</svg>
}
function UpdatesPage() {
  type UpdatePhase = "checking" | "upToDate" | "available" | "downloading" | "installing" | "relaunching" | "error"
  const [phase, setPhase] = useState<UpdatePhase>("checking")
  const [currentVersion, setCurrentVersion] = useState("—")
  const [latestVersion, setLatestVersion] = useState("—")
  const [releaseNotes, setReleaseNotes] = useState<string[]>([])
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null)
  const [downloaded, setDownloaded] = useState(0)
  const [contentLength, setContentLength] = useState<number | null>(null)
  const checking = useRef(false)

  const checkForUpdates = async () => {
    if (checking.current) return
    checking.current = true
    setPhase("checking")
    try {
      const installedVersion = await getVersion()
      setCurrentVersion(installedVersion)
      const update = await check()
      setAvailableUpdate(update)
      if (!update) {
        setLatestVersion(installedVersion)
        setReleaseNotes([])
        setPhase("upToDate")
        return
      }
      setLatestVersion(update.version)
      setReleaseNotes(update.body ? update.body.split(/\r?\n/).filter(Boolean) : [])
      setPhase("available")
    } catch {
      setAvailableUpdate(null)
      setPhase("error")
    } finally {
      checking.current = false
    }
  }

  useEffect(() => {
    void checkForUpdates()
  }, [])

  const installUpdate = async () => {
    if (!availableUpdate) return
    setDownloaded(0)
    setContentLength(null)
    setPhase("downloading")
    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setContentLength(event.data.contentLength ?? null)
          setDownloaded(0)
        } else if (event.event === "Progress") {
          setDownloaded((value) => value + event.data.chunkLength)
        } else if (event.event === "Finished") {
          setPhase("installing")
        }
      })
      setPhase("relaunching")
      await relaunch()
    } catch {
      setPhase("error")
    }
  }

  const status: Record<UpdatePhase, string> = {
    checking: "Checking for updates",
    upToDate: "Up to date",
    available: "Update available",
    downloading: "Downloading",
    installing: "Installing",
    relaunching: "Relaunching",
    error: "Update unavailable",
  }
  const progress = contentLength ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : null
  const busy = phase === "checking" || phase === "downloading" || phase === "installing" || phase === "relaunching"

  return (
    <div className="feature-page">
      <section className="info-card">
        <div>
          <div className="eyebrow">CURRENT VERSION</div>
          <h2>{currentVersion}</h2>
        </div>
        <div>
          <div className="eyebrow">LATEST VERSION</div>
          <h2>{latestVersion}</h2>
        </div>
        <span className="badge">{status[phase]}</span>
        <button className="primary" disabled={busy || phase === "upToDate" || !availableUpdate} onClick={() => void installUpdate()}>
          {phase === "downloading" ? "Downloading…" : phase === "installing" ? "Installing…" : phase === "relaunching" ? "Relaunching…" : "Update Now"}
        </button>
        {phase === "error" && <button className="secondary" onClick={() => void checkForUpdates()}>Retry</button>}
        {phase === "downloading" && <div className="update-progress" role="status">{progress === null ? `${Math.round(downloaded / 1024)} KB downloaded` : `${progress}% downloaded`}</div>}
      </section>
      <section className="info-card release-notes">
        <div className="eyebrow">WHAT'S NEW</div>
        {releaseNotes.length === 0 && <p>{phase === "upToDate" ? "You are using the latest version." : "Release notes are not available."}</p>}
        {releaseNotes.map((note) => (
          <p key={note}>• {note}</p>
        ))}
      </section>
    </div>
  )
}
function InfoPage() {
  const steps = [
    [
      "Add an Account",
      "Choose a service, add a profile, then sign in directly inside that service.",
    ],
    [
      "Keep Sessions Separate",
      "Each normal profile keeps its own local browser session. A linked Google session is optional.",
    ],
    [
      "Manage Your Accounts",
      "Open, rename, favorite, remove, or reorder profiles from the account list.",
    ],
    [
      "Switch Between Accounts",
      "Use the account shortcut row above the workspace to switch between nearby profiles.",
    ],
    [
      "Use Service Bookmarks",
      "Flow and ChatGPT bookmarks provide saved links inside their own workspace.",
    ],
  ]
  return (
    <div className="feature-page info-page">
      <div className="info-steps">
        {steps.map((step, i) => (
          <section className="info-step" key={step[0]}>
            <div className="step-number">{String(i + 1).padStart(2, "0")}</div>
            <div>
              <h2>{step[0]}</h2>
              <p>{step[1]}</p>
            </div>
          </section>
        ))}
      </div>
      <section className="privacy-info info-card">
        <div className="privacy-heading">
          <div className="eyebrow">PRIVACY &amp; SECURITY</div>
          <h2>Your accounts stay under your control.</h2>
          <span className="badge">LOCAL ACCOUNT DATA</span>
        </div>
        <div className="privacy-row">
          <span>🔒</span>
          <div>
            <h3>Google Login Stays in Google Flow</h3>
            <p>
              Your Google account login is handled directly inside Google Flow.
              Flowpilot does not ask you to enter your Google password into
              Flowpilot.
            </p>
          </div>
        </div>
        <div className="privacy-row">
          <span>🔑</span>
          <div>
            <h3>No Password Storage</h3>
            <p>
              Flowpilot does not store your Google password or ask you to
              provide it to the application.
            </p>
          </div>
        </div>
        <div className="privacy-row">
          <span>💻</span>
          <div>
            <h3>Local Account Management</h3>
            <p>
              Flowpilot stores account-management metadata locally on your
              device so you can organize your Google Flow accounts.
            </p>
          </div>
        </div>
        <div className="privacy-row">
          <span>🛡️</span>
          <div>
            <h3>No Unnecessary Account Data Collection</h3>
            <p>
              Flowpilot is designed to manage account shortcuts without
              requiring unnecessary Google account information. Your Google
              account remains managed through Google Flow.
            </p>
          </div>
        </div>
      </section>
      <section className="info-card telegram-card">
        <h2>Need help or want the latest updates?</h2>
        <p>
          Follow the Flowpilot Telegram channel for announcements, guides, and
          product updates.
        </p>
        <button className="secondary" disabled={!TELEGRAM_CHANNEL_URL}>
          Join Telegram Channel
        </button>
      </section>
    </div>
  )
}

function Card({
  a,
  menuOpen,
  onMenu,
  onOpen,
  onFavorite,
  onDelete,
  onRename,
  onClearCache,
  cacheBusy,
  dragEnabled,
  isDragging,
  dropPosition,
  onPointerDown,
}: {
  a: Account
  menuOpen: boolean
  onMenu: () => void
  onOpen: () => void
  onFavorite: () => void
  onDelete: () => void
  onRename: () => void
  onClearCache: () => void
  cacheBusy: boolean
  dragEnabled: boolean
  isDragging: boolean
  dropPosition: "before" | "after" | null
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const service = SERVICES[serviceOf(a)]
  return (
    <article
      data-account-id={a.id}
      className={`card ${isDragging ? "is-dragging" : ""} ${dropPosition ? `is-drop-${dropPosition}` : ""}`}
    >
      <div className="card-top">
        <button
          type="button"
          className="drag-handle"
          disabled={!dragEnabled}
          onPointerDown={onPointerDown}
          aria-label={`Reorder ${a.name}`}
          title={dragEnabled ? "Drag to reorder" : undefined}
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <div className="card-actions">
          <button
            className={`star ${a.favorite ? "fav" : ""}`}
            onClick={onFavorite}
            aria-label={a.favorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={a.favorite}
          >
            {a.favorite ? "★" : "☆"}
          </button>
          <div className="menu-wrap">
            <button className="more" onClick={onMenu} aria-label={`Options for ${a.name}`} aria-expanded={menuOpen}>
              •••
            </button>
            {menuOpen && (
              <div className="account-menu">
                <button onClick={onRename}>Rename</button>
                <button onClick={onFavorite}>
                  {a.favorite ? "Remove from Favorites" : "Add to Favorites"}
                </button>
                <button disabled={cacheBusy} onClick={onClearCache}>
                  {cacheBusy ? "Clearing Cache…" : "Clear Cache"}
                </button>
                <div className="menu-rule" />
                <button className="menu-danger" onClick={onDelete}>
                  Delete Account
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="account-identity">
        <div className="avatar large">
          <img
            src={a.avatarUrl || service.logo}
            alt={`${service.name} account`}
            draggable={false}
          />
        </div>
        <div className="account-name"><h2 title={a.name}>{a.name}</h2><p>{service.name}</p></div>
      </div>
      <button className="primary wide" onClick={onOpen}>
        Open {service.shortName}
      </button>
    </article>
  )
}
function Settings({
  profile,
  onAvatarChange,
  accountCount,
  clearingAllCaches,
  onClearAllCaches,
}: {
  profile: { name: string; avatar: string | null }
  onAvatarChange: (avatar: string) => void
  accountCount: number
  clearingAllCaches: boolean
  onClearAllCaches: () => void
}) {
  return (
    <div className="settings">
      <section>
        <label className="setting-icon profile-avatar-input">
          {profile.avatar ? (
            <img src={profile.avatar} alt="Flowpilot profile" />
          ) : (
            "YK"
          )}
          <input
            id="profile-avatar-input"
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () =>
                typeof reader.result === "string" &&
                onAvatarChange(reader.result)
              reader.readAsDataURL(file)
            }}
          />
          <button
            type="button"
            className="profile-avatar-edit"
            aria-label="Change profile photo"
            title="Change profile photo"
            onClick={(e) => {
              e.preventDefault()
              document.getElementById("profile-avatar-input")?.click()
            }}
          >
            ✎
          </button>
        </label>
        <div>
          <div className="eyebrow">PROFILE</div>
          <h2>Your Flowpilot profile</h2>
          <p>Local desktop profile used for your account manager.</p>
        </div>
      </section>
      <section>
        <div>
          <div className="eyebrow">PRIVACY & SECURITY</div>
          <h2>Your data stays local</h2>
          <p>
            Flowpilot stores account metadata locally. Google re-login is optional;
            its shared password is saved in Windows Credential Manager, not in account files.
          </p>
        </div>
        <span className="badge">LOCAL ONLY</span>
      </section>
      <section>
        <div className="setting-icon" aria-hidden="true">↻</div>
        <div>
          <div className="eyebrow">STORAGE</div>
          <h2>Clear all account caches</h2>
          <p>
            Removes only the WebView2 disk cache. Cookies, login sessions, local
            storage, and account profiles stay intact.
          </p>
        </div>
        <button
          className="secondary"
          disabled={clearingAllCaches || accountCount === 0}
          onClick={onClearAllCaches}
        >
          {clearingAllCaches ? "Clearing…" : "Clear All Caches"}
        </button>
      </section>
      <section>
        <div>
          <div className="eyebrow">ABOUT</div>
          <h2>
            Flowpilot <span className="muted">{APP_VERSION}</span>
          </h2>
          <p>Multi-service desktop workspace and account manager.</p>
        </div>
      </section>
    </div>
  )
}
function GoogleReLoginSettings({ onEnabled }: { onEnabled: () => void }) {
  const [enabled, setEnabled] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  useEffect(() => {
    let active = true
    void invoke<boolean>("google_relogin_status").then((value) => {
      if (active) setEnabled(value)
    }).catch((error) => {
      if (active) setMessage(`Credential Manager unavailable: ${String(error)}`)
    })
    return () => { active = false }
  }, [])
  const save = async () => {
    if (!password) return
    setBusy(true)
    setMessage("")
    try {
      await invoke("google_relogin_save_password", { password })
      setEnabled(true)
      setPassword("")
      setMessage("Google Flow re-login is enabled. Checking existing profiles…")
      onEnabled()
    } catch (error) {
      setMessage(`Could not save password: ${String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  const disable = async () => {
    setBusy(true)
    setMessage("")
    try {
      await invoke("google_relogin_disable")
      setEnabled(false)
      setPassword("")
      setMessage("Google Flow re-login is disabled.")
    } catch (error) {
      setMessage(`Could not disable re-login: ${String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="preload-setting">
      <div>
        <h2>Google Flow auto re-login</h2>
        <p>After saving, Flowpilot checks your existing Flow profiles. You can also run Check &amp; Re-login All from the Flow account list. Fresh login and additional verification are not automated. The password is shared across Flow profiles and stored in Windows Credential Manager.</p>
        <p>Status: <strong>{enabled ? "Enabled" : "Disabled"}</strong></p>
      </div>
      <label htmlFor="google-relogin-password">Shared Google password</label>
      <input id="google-relogin-password" type="password" autoComplete="new-password"
        value={password} disabled={busy} maxLength={1024}
        onChange={(event) => setPassword(event.target.value)}
        placeholder={enabled ? "Enter new password to replace saved one" : "Enter password to enable"} />
      <div className="dialog-actions">
        <button className="primary" disabled={busy || !password} onClick={() => void save()}>
          {enabled ? "Replace password" : "Enable re-login"}
        </button>
        {enabled && <button className="secondary" disabled={busy} onClick={() => void disable()}>
          Disable re-login
        </button>}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
function NameGeneratorSettings() {
  const [enabled, setEnabled] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  useEffect(() => {
    let active = true
    void invoke<boolean>("name_generator_status").then((value) => {
      if (active) setEnabled(value)
    }).catch(() => {
      if (active) setMessage("Could not read the saved API key setting.")
    })
    return () => { active = false }
  }, [])
  const save = async () => {
    setBusy(true)
    setMessage("")
    try {
      await invoke("name_generator_save_key", { apiKey })
      setEnabled(true)
      setApiKey("")
      setMessage("API key saved. Indonesian names will be requested only during new ChatGPT signup.")
    } catch {
      setMessage("Could not save API key. Check Windows Credential Manager and try again.")
    } finally { setBusy(false) }
  }
  const disable = async () => {
    setBusy(true)
    setMessage("")
    try {
      await invoke("name_generator_disable")
      setEnabled(false)
      setApiKey("")
      setMessage("Name generator disabled and its saved API key removed.")
    } catch {
      setMessage("Could not remove the saved API key.")
    } finally { setBusy(false) }
  }
  return (
    <section className="preload-setting">
      <div>
        <h2>Indonesian signup names</h2>
        <p>Use Behind the Name to generate a name for new ChatGPT accounts during shared-profile sign-in. Existing accounts keep their names. If the API is unavailable, use the Google name or linked profile name. The signup age defaults to 27 when empty.</p>
        <p>Your API key is stored in Windows Credential Manager and sent only to Behind the Name to request names.</p>
        <p>Status: <strong>{enabled ? "Enabled" : "Disabled"}</strong></p>
      </div>
      <label htmlFor="behind-the-name-key">Behind the Name API key</label>
      <input id="behind-the-name-key" type="password" autoComplete="new-password"
        value={apiKey} disabled={busy} maxLength={512}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={enabled ? "Enter a new key to replace the saved one" : "Enter API key"} />
      <div className="dialog-actions">
        <button className="primary" disabled={busy || !apiKey.trim()} onClick={() => void save()}>
          {enabled ? "Replace API key" : "Save and enable"}
        </button>
        {enabled && <button className="secondary" disabled={busy} onClick={() => void disable()}>Disable</button>}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
function DownloadSettings() {
  const [folder, setFolder] = useState("")
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    let disposed = false
    void invoke<string>("get_download_folder").then((path) => { if (!disposed) setFolder(path) })
      .catch((reason) => { if (!disposed) setError(String(reason)) })
      .finally(() => { if (!disposed) setBusy(false) })
    return () => { disposed = true }
  }, [])
  const changeFolder = async () => {
    setBusy(true)
    setError("")
    try {
      const selected = await invoke<string | null>("choose_download_folder")
      if (selected) setFolder(selected)
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const openFolder = async () => {
    setBusy(true)
    setError("")
    try { await invoke("open_download_folder") }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  return <section className="preload-setting download-settings">
    <h2>Downloads</h2>
    <p>Files from all services save directly to this folder. No Save As dialog for each download.</p>
    <label htmlFor="download-folder">Download folder</label>
    <input id="download-folder" readOnly value={folder} placeholder={busy ? "Loading..." : "Choose a folder"} />
    <div className="download-folder-actions">
      <button className="secondary" disabled={busy} onClick={() => void changeFolder()}>Change folder</button>
      <button className="secondary" disabled={busy || !folder} onClick={() => void openFolder()}>Open folder</button>
    </div>
    <p>Changes apply to new downloads. Files already downloaded or currently downloading stay in their original location.</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </section>
}

function DownloadNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  if (!message) return null
  return <div className="download-notice" role="status"><span>{message}</span><button aria-label="Dismiss download status" onClick={onDismiss}>×</button></div>
}

function FlowShell({
  downloadNotice, onDismissDownload,
  preloadSides, onClosed, onOpened, onClosingChange,
  account,
  accounts,
  bookmarks,
  fullView,
  onToggleFullView,
  onSelectAccount,
  onSaveBookmark,
  onDeleteBookmark,
  onBack,
  onAddAccount,
}: {
  downloadNotice: string
  onDismissDownload: () => void
  preloadSides: number
  onClosed: (scope: WorkspaceCloseScope) => void
  onOpened: (account: Account) => void
  onClosingChange: (closing: boolean) => void
  account: Account
  accounts: Account[]
  bookmarks: ServiceBookmark[]
  fullView: boolean
  onToggleFullView: () => void
  onSelectAccount: (account: Account) => void
  onSaveBookmark: (id: string | null, name: string, url: string) => string | null
  onDeleteBookmark: (id: string) => void
  onBack: () => void
  onAddAccount: () => void
}) {
  const serviceId = serviceOf(account)
  const service = SERVICES[serviceId]
  const bookmarkService = supportsBookmarks(serviceId) ? serviceId : null
  const [status, setStatus] = useState(`Loading ${service.name}...`)
  const [openError, setOpenError] = useState("")
  const [bookmarkManagerOpen, setBookmarkManagerOpen] = useState(false)
  const [bookmarkName, setBookmarkName] = useState("")
  const [bookmarkUrl, setBookmarkUrl] = useState("")
  const [bookmarkError, setBookmarkError] = useState("")
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null)
  const [bookmarkMenu, setBookmarkMenu] = useState<{ id: string; left: number; top: number } | null>(null)
  const shortcutListRef = useRef<HTMLDivElement>(null)
  const revealShortcuts = useRef<"before" | "after" | null>(null)
  const [moreBefore, setMoreBefore] = useState(0)
  const [moreAfter, setMoreAfter] = useState(0)
  useEffect(() => {
    const list = shortcutListRef.current
    if (!list) return
    if (revealShortcuts.current) {
      list.scrollLeft = revealShortcuts.current === "before" ? 0 : list.scrollWidth
      revealShortcuts.current = null
    } else {
      const selected = list.querySelector<HTMLElement>("[aria-current]")
      if (selected) {
        const left = selected.offsetLeft - list.offsetLeft
        if (left < list.scrollLeft) list.scrollLeft = left
        else if (left + selected.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = left + selected.offsetWidth - list.clientWidth
      }
    }
  }, [account.id, moreBefore, moreAfter])
  const [closing, setClosing] = useState(false)
  const stopped = useRef(false)
  const currentIndex = accounts.findIndex((candidate) => candidate.id === account.id)
  const [shortcutStart, shortcutEnd] = shortcutBounds(accounts.length, currentIndex, moreBefore, moreAfter)
  const neighborIds = neighborIndices(accounts.length, currentIndex, preloadSides).map((index) => accounts[index].id)
  const neighborKey = neighborIds.join(",")
  const containerRef = useRef<HTMLDivElement>(null)
  const clearBookmarkForm = () => {
    setEditingBookmarkId(null)
    setBookmarkName("")
    setBookmarkUrl("")
    setBookmarkError("")
  }
  useEffect(() => {
    setBookmarkManagerOpen(false)
    setBookmarkMenu(null)
    clearBookmarkForm()
    let cancelled = false
    stopped.current = false
    setOpenError("")
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    invoke<number>("prepare_workspace", {
      neighbors: neighborIds,
      accountId: account.id,
      service: serviceId,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    })
      .then(async (epoch) => {
        if (cancelled || stopped.current) return
        onOpened(account)
        setStatus(`${service.name} workspace`)
        containerRef.current?.dispatchEvent(new Event("flowpilot-webview-ready"))
        for (const id of neighborIds) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          if (cancelled || stopped.current) break
          try {
            await invoke("preload_workspace", { accountId: id, service: serviceId, epoch, width: rect.width, height: rect.height })
          } catch (error) {
            if (!cancelled && !stopped.current) setStatus("Workspace open. Some nearby accounts could not preload.")
            console.warn("Account preload failed", error)
          }
        }
      })
      .catch((error) => {
        console.error(`${service.name} WebView failed`, error)
        if (!cancelled) {
          setStatus(`Unable to open ${service.name}`)
          setOpenError(String(error))
        }
      })
    return () => {
      cancelled = true
      void invoke("close_google_flow", { accountId: account.id, service: serviceId })
    }
  }, [account.id, serviceId, preloadSides, neighborKey])
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const syncBounds = () => {
      const rect = container.getBoundingClientRect()
      void invoke("resize_google_flow", { accountId: account.id, service: serviceId, x: rect.left, y: rect.top, width: rect.width, height: rect.height })
    }
    const onReady = () => syncBounds()
    container.addEventListener("flowpilot-webview-ready", onReady)
    const observer = new ResizeObserver(syncBounds)
    observer.observe(container)
    syncBounds()
    return () => {
      observer.disconnect()
      container.removeEventListener("flowpilot-webview-ready", onReady)
    }
  }, [fullView, account.id, serviceId])
  useEffect(() => {
    if (!bookmarkMenu) return
    const dismiss = () => setBookmarkMenu(null)
    window.addEventListener("pointerdown", dismiss)
    window.addEventListener("resize", dismiss)
    return () => {
      window.removeEventListener("pointerdown", dismiss)
      window.removeEventListener("resize", dismiss)
    }
  }, [bookmarkMenu])
  const closeWorkspaces = async (scope: WorkspaceCloseScope) => {
    if (stopped.current) return
    stopped.current = true
    setClosing(true)
    onClosingChange(true)
    try {
      await invoke("close_workspaces", {
        service: scope === "all" ? null : serviceId,
        accountId: scope === "profile" ? account.id : null,
      })
      onClosed(scope)
    } catch (error) {
      setStatus(`Unable to close workspaces: ${String(error)}`)
      stopped.current = false
      setClosing(false)
    } finally {
      onClosingChange(false)
    }
  }
  const showWebview = async () => {
    if (stopped.current) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setBookmarkManagerOpen(false)
    setBookmarkMenu(null)
    clearBookmarkForm()
    setStatus(`Loading ${service.name}...`)
    setOpenError("")
    try {
      await invoke("open_google_flow", {
        accountId: account.id,
        service: serviceId,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
      setStatus(`${service.name} workspace`)
    } catch (error) {
      console.error(`${service.name} WebView failed`, error)
      setStatus(`Unable to open ${service.name}`)
      setOpenError(String(error))
    }
  }
  const navigateBookmark = async (url: string, name: string) => {
    if (!bookmarkService || stopped.current) return
    try {
      setBookmarkMenu(null)
      if (bookmarkManagerOpen) await showWebview()
      if (stopped.current) return
      setStatus(`Opening ${name}...`)
      await invoke("navigate_service_bookmark", { accountId: account.id, service: bookmarkService, url })
      setStatus(`Opened ${name}`)
    } catch (error) {
      console.error(`${service.name} bookmark failed`, error)
      setStatus(`Unable to open ${name}. Please check the bookmark URL.`)
    }
  }
  const openBookmarkManager = async () => {
    if (!bookmarkService || stopped.current) return
    try {
      await invoke("close_google_flow", { accountId: account.id, service: serviceId })
      setBookmarkManagerOpen(true)
      setBookmarkMenu(null)
      clearBookmarkForm()
      setStatus(`Manage ${service.shortName} bookmarks`)
    } catch (error) {
      console.error("Unable to open bookmark manager", error)
      setStatus("Unable to open bookmark manager. Please try again.")
    }
  }
  const submitBookmark = () => {
    const error = onSaveBookmark(editingBookmarkId, bookmarkName, bookmarkUrl)
    if (error) {
      setBookmarkError(error)
      return
    }
    clearBookmarkForm()
  }
  const editBookmark = async (bookmark: ServiceBookmark) => {
    if (stopped.current) return
    try {
      if (!bookmarkManagerOpen) {
        await invoke("close_google_flow", { accountId: account.id, service: serviceId })
      }
      setBookmarkManagerOpen(true)
      setBookmarkMenu(null)
      setEditingBookmarkId(bookmark.id)
      setBookmarkName(bookmark.name)
      setBookmarkUrl(bookmark.url)
      setBookmarkError("")
      setStatus(`Edit ${bookmark.name}`)
    } catch (error) {
      console.error("Unable to edit bookmark", error)
      setStatus("Unable to open bookmark editor. Please try again.")
    }
  }
  const removeBookmark = (bookmark: ServiceBookmark) => {
    setBookmarkMenu(null)
    if (!window.confirm(`Remove bookmark "${bookmark.name}"?`)) return
    onDeleteBookmark(bookmark.id)
    if (editingBookmarkId === bookmark.id) clearBookmarkForm()
  }
  const openBookmarkContextMenu = (event: ReactMouseEvent, bookmark: ServiceBookmark) => {
    event.preventDefault()
    setBookmarkMenu({
      id: bookmark.id,
      left: Math.min(event.clientX, window.innerWidth - 176),
      top: Math.max(8, event.clientY - 84),
    })
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (stopped.current) return
      if (event.key !== "Escape") return
      if (bookmarkMenu) {
        setBookmarkMenu(null)
      } else if (bookmarkManagerOpen) {
        void showWebview()
      } else if (fullView) {
        onToggleFullView()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [bookmarkMenu, bookmarkManagerOpen, fullView, onToggleFullView])
  const menuBookmark = bookmarkMenu
    ? bookmarks.find((bookmark) => bookmark.id === bookmarkMenu.id) || null
    : null
  return (
    <div className={`flow-shell ${bookmarkService ? "has-bookmarks" : ""}`}>
      <div className="flow-bar">
        <button className="back" disabled={closing} onClick={onBack}>‹ Accounts</button>
        <button className="back" disabled={closing} onClick={onAddAccount}>+ Add account</button>
        <span className="flow-status" role="status">{status}</span>
        <div className="flow-controls">
          <strong className="active-profile-name" title={account.name}>{account.name}</strong>
          <select className="close-workspaces" aria-label="Close workspaces" value="" disabled={closing}
            onChange={(event) => {
              const scope = event.target.value
              if (scope === "profile" || scope === "service" || scope === "all") void closeWorkspaces(scope)
            }}>
            <option value="" disabled>{closing ? "Closing..." : "Close"}</option>
            <option value="profile">Close current profile</option>
            <option value="service">Close {service.shortName}</option>
            <option value="all">Close all services</option>
          </select>
          <button className="fullscreen" disabled={closing} onClick={onToggleFullView}>
            {fullView ? "Exit Full View" : "Full View"}
          </button>
        </div>
      </div>
      <DownloadNotice message={downloadNotice} onDismiss={onDismissDownload} />
      <nav className="account-shortcuts" aria-label="Account shortcuts">
        <button className="shortcut-more" disabled={shortcutStart === 0 || closing} onClick={() => { revealShortcuts.current = "before"; setMoreBefore((value) => value + 5) }}>Oldest more</button>
        <div className="shortcut-list" ref={shortcutListRef}>
          {accounts.slice(shortcutStart, shortcutEnd).map((candidate) => <button key={candidate.id}
            className={candidate.id === account.id ? "active" : ""} aria-current={candidate.id === account.id ? "true" : undefined}
            disabled={closing} title={candidate.name} onClick={() => onSelectAccount(candidate)}>{candidate.name}</button>)}
        </div>
        <button className="shortcut-more" disabled={shortcutEnd === accounts.length || closing} onClick={() => { revealShortcuts.current = "after"; setMoreAfter((value) => value + 5) }}>Latest more</button>
      </nav>
      {bookmarkService && (
        <nav className="flow-bookmark-bar" aria-label={`${service.name} bookmarks`}>
          <button type="button" className="flow-bookmark flow-bookmark-home" onClick={() => void navigateBookmark(service.url, service.shortName)}>
            <img src={service.logo} alt="" />
            <span>{service.shortName}</span>
          </button>
          {bookmarks.map((bookmark) => (
            <button
              type="button"
              className="flow-bookmark"
              key={bookmark.id}
              title={`${bookmark.name} — ${bookmark.url}`}
              onClick={() => void navigateBookmark(bookmark.url, bookmark.name)}
              onContextMenu={(event) => openBookmarkContextMenu(event, bookmark)}
            >
              {bookmark.name}
            </button>
          ))}
          <button
            type="button"
            className="flow-bookmark-add"
            title={`Manage ${service.shortName} bookmarks`}
            aria-label={`Manage ${service.shortName} bookmarks`}
            onClick={() => void openBookmarkManager()}
          >
            +
          </button>
        </nav>
      )}
      {menuBookmark && bookmarkMenu && (
        <div
          className="bookmark-context-menu"
          role="menu"
          style={{ left: bookmarkMenu.left, top: bookmarkMenu.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => void editBookmark(menuBookmark)}>Edit bookmark</button>
          <button type="button" role="menuitem" className="danger-item" onClick={() => removeBookmark(menuBookmark)}>Remove bookmark</button>
        </div>
      )}
      <div ref={containerRef} className="webview-host" aria-label={`${service.name} WebView`}>
        {openError && <div className="workspace-error" role="alert"><h2>Unable to open {service.name}</h2><p>{openError}</p><button className="secondary" onClick={onBack}>Back to accounts</button></div>}
        {bookmarkManagerOpen && bookmarkService && (
          <section className="bookmark-manager" aria-labelledby="bookmark-manager-title">
            <div className="bookmark-manager-heading">
              <div>
                <h2 id="bookmark-manager-title">{service.shortName} bookmarks</h2>
                <p>Add shortcuts for pages you use in {service.name}.</p>
              </div>
              <button type="button" className="bookmark-close" onClick={() => void showWebview()} aria-label="Close bookmark manager">×</button>
            </div>
            <div className="bookmark-form">
              <label>
                <span>Name</span>
                <input value={bookmarkName} maxLength={50} onChange={(event) => setBookmarkName(event.target.value)} placeholder="Bookmark name" />
              </label>
              <label>
                <span>{service.shortName} URL</span>
                <input
                  value={bookmarkUrl}
                  onChange={(event) => setBookmarkUrl(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && submitBookmark()}
                  placeholder={bookmarkUrlExample(bookmarkService)}
                />
              </label>
              <div className="bookmark-form-actions">
                {editingBookmarkId && <button type="button" className="secondary" onClick={clearBookmarkForm}>Cancel</button>}
                <button type="button" className="primary" onClick={submitBookmark}>
                  {editingBookmarkId ? "Save changes" : "Add bookmark"}
                </button>
              </div>
            </div>
            {bookmarkError && <p className="bookmark-error" role="alert">{bookmarkError}</p>}
            <div className="bookmark-list">
              {bookmarks.length === 0 ? (
                <p className="bookmark-empty">No bookmarks saved for {service.shortName}.</p>
              ) : bookmarks.map((bookmark) => (
                <div className={`bookmark-row ${editingBookmarkId === bookmark.id ? "is-editing" : ""}`} key={bookmark.id}>
                  <div>
                    <strong>{bookmark.name}</strong>
                    <span>{bookmark.url}</span>
                  </div>
                  <div className="bookmark-row-actions">
                    <button type="button" onClick={() => void editBookmark(bookmark)}>Edit</button>
                    <button type="button" className="remove" onClick={() => removeBookmark(bookmark)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
