import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { invoke } from "@tauri-apps/api/core"
import { PhysicalSize } from "@tauri-apps/api/dpi"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import packageJson from "../package.json"
import { loadAccounts, saveAccounts } from "./services/account-store"

type ServiceId = "flow" | "dola" | "leonardo" | "chatgpt" | "migoo"
type FlowBookmark = {
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
  service?: ServiceId
}
const SERVICES: Record<ServiceId, { name: string; shortName: string; logo: string; url: string }> = {
  flow: { name: "Google Flow", shortName: "Flow", logo: "/flow-logo.png", url: "https://labs.google/fx/tools/flow" },
  dola: { name: "Dola", shortName: "Dola", logo: "/dola-logo.png", url: "https://www.dola.com/" },
  leonardo: { name: "Leonardo AI", shortName: "Leonardo", logo: "/leonardo-logo.png", url: "https://app.leonardo.ai/" },
  chatgpt: { name: "ChatGPT", shortName: "ChatGPT", logo: "/chatgpt-logo.png", url: "https://chatgpt.com/" },
  migoo: { name: "Migoo", shortName: "Migoo", logo: "/migoo-logo.png", url: "https://migoo.ai/home" },
}
const serviceOf = (account: Account): ServiceId => account.service || "flow"
const FLOW_BOOKMARKS_KEY = "flowpilot-flow-bookmarks"
const isFlowUrl = (value: string) => {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.hostname === "labs.google" &&
      (url.pathname === "/fx/tools/flow" || url.pathname.startsWith("/fx/tools/flow/")) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}
const loadFlowBookmarks = (): FlowBookmark[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FLOW_BOOKMARKS_KEY) || "[]")
    if (!Array.isArray(stored)) return []
    return stored.filter((item): item is FlowBookmark => {
      if (!item || typeof item !== "object") return false
      const bookmark = item as Partial<FlowBookmark>
      return (
        typeof bookmark.id === "string" &&
        typeof bookmark.name === "string" &&
        bookmark.name.trim().length > 0 &&
        bookmark.name.length <= 50 &&
        typeof bookmark.url === "string" &&
        bookmark.url.length <= 2048 &&
        isFlowUrl(bookmark.url)
      )
    })
  } catch {
    return []
  }
}
const LICENSE_PURCHASE_URL = "https://tokotelegram.com/toko/flowpilot"
const TELEGRAM_CHANNEL_URL = ""
const APP_VERSION = packageJson.version
type LicenseState = { plan: string; status: string; expires_at: string | null; lifetime: boolean; last_validated_at: string; device_id: string }
const licensePlanLabel = (plan: string) => ({ five_minutes: "5 Minutes", one_day: "1 Day", seven_days: "7 Days", thirty_days: "30 Days", one_year: "1 Year", lifetime: "Lifetime" }[plan] || plan)
const licenseStatusLabel = (status: string) => status ? status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unavailable"
const licenseExpiryLabel = (state: LicenseState | null) => state?.lifetime ? "Lifetime" : state?.expires_at ? new Date(state.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—"
const plans = [
  {
    name: "30 Days",
    originalPrice: "Rp50,000",
    price: "Rp25,000",
    description: "Flowpilot access for 30 days",
  },
  {
    name: "1 Year",
    originalPrice: "Rp149.000",
    price: "Rp99.000",
    description: "Flowpilot access for 1 year",
  },
  {
    name: "Lifetime",
    originalPrice: "Rp249.000",
    price: "Rp149.000",
    description: "Flowpilot access with no expiration",
  },
]
const starter: Account[] = [
  {
    id: "main",
    name: "Flow Main",
    email: null,
    avatarUrl: "/google-flow.png",
    avatar: "YK",
    favorite: true,
    order: 0,
    service: "flow",
  },
  {
    id: "client",
    name: "Client A",
    email: null,
    avatarUrl: "/google-flow.png",
    avatar: "CA",
    favorite: false,
    order: 1,
    service: "flow",
  },
  {
    id: "backup",
    name: "Backup",
    email: null,
    avatarUrl: "/google-flow.png",
    avatar: "B",
    favorite: false,
    order: 2,
    service: "flow",
  },
]

export default function App() {
  const [licensed, setLicensed] = useState(true)
  const [licenseChecking, setLicenseChecking] = useState(false)
  const [licenseError, setLicenseError] = useState("")
  const [licenseState, setLicenseState] = useState<LicenseState | null>(null)
  const [deviceId, setDeviceId] = useState("")
  const [key, setKey] = useState("")
  const [accounts, setAccounts] = useState<Account[]>([])
  const [flowBookmarks, setFlowBookmarks] = useState<FlowBookmark[]>(loadFlowBookmarks)
  const [activeService, setActiveService] = useState<ServiceId>("flow")
  const [accountsLoaded, setAccountsLoaded] = useState(false)
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
  const [view, setView] = useState<
    | "accounts"
    | "favorites"
    | "license"
    | "updates"
    | "info"
    | "settings"
    | "flow"
  >("accounts")
  const [active, setActive] = useState<Account | null>(null)
  const [fullView, setFullView] = useState(false)
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const [dialog, setDialog] = useState<Account | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [cacheNotice, setCacheNotice] = useState("")
  const [clearingCacheId, setClearingCacheId] = useState<string | null>(null)
  const [clearingAllCaches, setClearingAllCaches] = useState(false)
  const [addAccountOpen, setAddAccountOpen] = useState(false)
  const [newAccountName, setNewAccountName] = useState("")
  const [addAccountError, setAddAccountError] = useState("")
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragPoint, setDragPoint] = useState({ x: 0, y: 0 })
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragTargetId, setDragTargetId] = useState<string | null>(null)
  const [dragPreviewIds, setDragPreviewIds] = useState<string[] | null>(null)
  useEffect(() => { void (async () => { try { const id=await invoke<string>("get_device_id"); setDeviceId(id); const saved=await invoke<LicenseState|null>("get_license_state"); if(saved?.status) setLicenseState(saved) } catch(e) { console.warn("License check failed:",e) } })() }, [])
  const dragSourceRef = useRef<HTMLElement | null>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const dragSourceIdRef = useRef<string | null>(null)
  const dragTargetIdRef = useRef<string | null>(null)
  const dragInsertAfterRef = useRef(false)
  const handleRename = (a: Account) => {
    const n = prompt("Rename account", a.name)
    if (n)
      setAccounts(accounts.map((x) => (x.id === a.id ? { ...x, name: n } : x)))
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
      setAccounts((current) => current.filter((account) => account.id !== removing.id))
      if (active?.id === removing.id) {
        setActive(null)
        setFullView(false)
        setNavigatorOpen(false)
        setView("accounts")
      }
      if (!profileCleaned) console.warn("Account removed; profile cleanup is pending")
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
  const handleToggleFavorite = (a: Account) => {
    setAccounts(
      accounts.map((x) => (x.id === a.id ? { ...x, favorite: !x.favorite } : x))
    )
    setMenu(null)
  }
  const handleAddAccount = () => {
    setNewAccountName("")
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
    const a: Account = {
      id: crypto.randomUUID(),
      name,
      email: null,
      avatarUrl: SERVICES[activeService].logo,
      avatar: "NF",
      favorite: false,
      order: accounts.length,
      service: activeService,
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
    if (!licensed || accountsLoaded) return
    void loadAccounts().then((saved) => setAccounts(saved as Account[])).finally(() => setAccountsLoaded(true))
  }, [licensed, accountsLoaded])
  useEffect(() => {
    if (licensed && accountsLoaded) void saveAccounts(accounts)
  }, [accounts, licensed, accountsLoaded])
  useEffect(() => {
    try {
      localStorage.setItem(FLOW_BOOKMARKS_KEY, JSON.stringify(flowBookmarks))
    } catch (error) {
      console.error("Flow bookmarks could not be saved", error)
    }
  }, [flowBookmarks])
  useEffect(() => {
    const activeStillExists = active !== null && accounts.some((account) => account.id === active.id)
    if (view === "flow" && !activeStillExists) {
      setActive(null)
      setFullView(false)
      setNavigatorOpen(false)
      setView("accounts")
    } else if (view !== "flow" && (fullView || navigatorOpen)) {
      setFullView(false)
      setNavigatorOpen(false)
    }
  }, [active, accounts, view, fullView, navigatorOpen])
  const serviceAccounts = useMemo(
    () => accounts.filter((account) => serviceOf(account) === activeService),
    [accounts, activeService]
  )
  const favoriteCount = serviceAccounts.filter((a) => a.favorite).length
  const visible = useMemo(
    () =>
      serviceAccounts.filter(
        (a) =>
          (view !== "favorites" || a.favorite) &&
          `${a.name} ${a.email}`.toLowerCase().includes(query.toLowerCase())
      ),
    [serviceAccounts, query, view]
  )
  const displayed = useMemo(() => {
    if (!dragPreviewIds || view !== "accounts") return visible
    const byId = new Map(serviceAccounts.map((account) => [account.id, account]))
    return dragPreviewIds.map((id) => byId.get(id)).filter(Boolean) as Account[]
  }, [serviceAccounts, dragPreviewIds, view, visible])
  const finishPointerDrag = (commit: boolean) => {
    const sourceId = dragSourceIdRef.current
    const targetId = dragTargetIdRef.current
    if (commit && sourceId && targetId && sourceId !== targetId) {
      setAccounts((current) => {
        const sourceIndex = current.findIndex((a) => a.id === sourceId)
        const targetIndex = current.findIndex((a) => a.id === targetId)
        if (sourceIndex < 0 || targetIndex < 0) return current
        const next = [...current]
        const [source] = next.splice(sourceIndex, 1)
        const insertionIndex = next.findIndex((a) => a.id === targetId)
        next.splice(insertionIndex + (dragInsertAfterRef.current ? 1 : 0), 0, source)
        return next.map((a, index) => ({ ...a, order: index }))
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
    setDragPreviewIds(null)
  }
  useEffect(() => {
    const accountAtPoint = (x: number, y: number) => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("[data-account-id]"))
        .filter((element) => element.dataset.accountId !== dragSourceIdRef.current)
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      const hit = candidates.find(({ rect }) =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      )
      if (hit) return { id: hit.element.dataset.accountId || null, after: x > (hit.rect.left + hit.rect.right) / 2 }
      // Use the nearest card center when the pointer crosses a grid gap or a new row.
      const nearest = candidates
        .map(({ element, rect }) => ({
          element,
          rect,
          distance: Math.hypot((rect.left + rect.right) / 2 - x, (rect.top + rect.bottom) / 2 - y),
        }))
        .sort((a, b) => a.distance - b.distance)[0]
      if (!nearest) return null
      return { id: nearest.element.dataset.accountId || null, after: x > (nearest.rect.left + nearest.rect.right) / 2 }
    }
    const onMove = (event: PointerEvent) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      setDragPoint({ x: event.clientX, y: event.clientY })
      const hit = accountAtPoint(event.clientX, event.clientY)
      const targetId = hit?.id || null
      dragInsertAfterRef.current = hit?.after || false
      dragTargetIdRef.current = targetId
      setDragTargetId(targetId)
      if (targetId) setDragPreviewIds((current) => {
        const ids = current || accounts.map((a) => a.id)
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
  }, [accounts])
  const beginPointerDrag = (id: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || view !== "accounts" || query.trim()) return
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select")) return
    const rect = event.currentTarget.getBoundingClientRect()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragSourceRef.current = event.currentTarget
    dragPointerIdRef.current = event.pointerId
    dragSourceIdRef.current = id
    dragTargetIdRef.current = null
    dragInsertAfterRef.current = false
    setDraggingId(id)
    setDragTargetId(null)
    setDragPreviewIds(accounts.map((a) => a.id))
    setDragOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    setDragPoint({ x: event.clientX, y: event.clientY })
  }
  const activateLicense = async () => {
    if (!key.trim() || !deviceId) { setLicenseError("Invalid License"); return }
    setLicenseChecking(true); setLicenseError("")
    try { const activated=await invoke<LicenseState>("activate_license", { licenseKey: key }); setLicenseState(activated); const w = getCurrentWindow(); setKey(""); setLicensed(true)
      await invoke("expand_main_window"); await w.show(); await w.setFocus(); return
    } catch { setLicenseError("Server Unavailable") } finally { setLicenseChecking(false) }
  }
  const openLicensePurchase = () =>
    invoke("open_external_url", { url: LICENSE_PURCHASE_URL })
  if (licenseChecking && !licensed)
    return <div className="gate"><div className="gate-card"><Brand /><h1>Checking your license</h1><p>Connecting securely to Flowpilot License Server…</p></div></div>
  if (!licensed)
    return (
      <div className="gate">
        <div className="gate-card">
          <Brand />
          <h1>Enter your license</h1>
          <p>Activate Flowpilot with your license key.</p>
          <input
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Enter your license key"
            onKeyDown={(e) => e.key === "Enter" && activateLicense()}
          />
          <button className="primary wide" onClick={activateLicense}>
            {licenseChecking ? "Activating…" : "Activate Flowpilot →"}
          </button>
          {licenseError && <p className="dialog-error">{licenseError}</p>}
          <div className="link">
            Don't have a license?{" "}
            <a
              href={LICENSE_PURCHASE_URL}
              onClick={(e) => {
                e.preventDefault()
                void openLicensePurchase()
              }}
            >
              <u>Buy a license →</u>
            </a>
          </div>
          <small>
            🔒 Your Google account login is handled directly in Google Flow.
            <br />
            We never store your login details.
          </small>
        </div>
      </div>
    )
  if (view === "flow" && active)
    return (
      <div className={`app ${fullView ? "full" : ""}`}>
        {!fullView && <Sidebar view="flow" setView={setView} profile={profile} licenseState={licenseState} />}
        <main className="content flow-content">
          <FlowShell
            account={active}
            accounts={serviceAccounts}
            bookmarks={flowBookmarks}
            fullView={fullView}
            navigatorOpen={navigatorOpen}
            onToggleFullView={() => {
              setNavigatorOpen(false)
              setFullView((current) => !current)
            }}
            onToggleNavigator={() => setNavigatorOpen((current) => !current)}
            onSelectAccount={(account) => {
              setNavigatorOpen(false)
              if (account.id !== active.id) setActive(account)
            }}
            onAddBookmark={(name, url) => {
              const cleanName = name.trim()
              const cleanUrl = url.trim()
              if (!cleanName) return "Enter a bookmark name."
              if (cleanName.length > 50) return "Bookmark name must be 50 characters or fewer."
              if (cleanUrl.length > 2048 || !isFlowUrl(cleanUrl)) {
                return "Enter a valid Google Flow URL starting with https://labs.google/fx/tools/flow."
              }
              if (flowBookmarks.some((bookmark) => bookmark.url === cleanUrl)) {
                return "That Google Flow URL is already bookmarked."
              }
              setFlowBookmarks((current) => [
                ...current,
                { id: crypto.randomUUID(), name: cleanName, url: cleanUrl },
              ])
              return null
            }}
            onDeleteBookmark={(id) => {
              setFlowBookmarks((current) => current.filter((bookmark) => bookmark.id !== id))
            }}
            onBack={() => {
              void invoke("close_google_flow", { accountId: active.id, service: serviceOf(active) })
              setFullView(false)
              setNavigatorOpen(false)
              setView("accounts")
            }}
          />
        </main>
      </div>
    )
  return (
    <div className="app">
      <Sidebar view={view} setView={setView} profile={profile} licenseState={licenseState} />
      <main className="content">
        <header>
          <div>
            <div className="eyebrow">
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
                : view === "license"
                ? "License"
                : view === "updates"
                ? "Updates"
                : view === "info"
                ? "How to Use Flowpilot"
                : `${SERVICES[activeService].name} Accounts`}
            </h1>
            <p>
              {view === "settings"
                ? "Keep Flowpilot personal, private, and ready to use."
                : view === "favorites"
                ? `Your favorite ${SERVICES[activeService].name} accounts in one place.`
                : view === "license"
                ? "Choose the Flowpilot license that fits your needs."
                : view === "updates"
                ? "Keep Flowpilot up to date with the latest version."
                : view === "info"
                ? "A quick guide to managing your AI workspaces."
                : `Manage your ${SERVICES[activeService].name} accounts in one place.`}
            </p>
            {view === "accounts" && (
              <div className="account-count">
                {serviceAccounts.length}{" "}
                {serviceAccounts.length === 1 ? "Account" : "Accounts"}
              </div>
            )}
            {view === "favorites" && (
              <div className="account-count">{favoriteCount} Favorites</div>
            )}
          </div>
          {view === "accounts" && (
            <div className="header-actions">
              <div className="search">
                ⌕
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search accounts..."
                />
              </div>
              <button className="primary" onClick={handleAddAccount}>
                ＋ Add Account
              </button>
            </div>
          )}
        </header>
        {(view === "accounts" || view === "favorites") && (
          <nav className="service-switcher" aria-label="AI service">
            {(Object.keys(SERVICES) as ServiceId[]).map((serviceId) => (
              <button
                key={serviceId}
                className={activeService === serviceId ? "active" : ""}
                onClick={() => {
                  setActiveService(serviceId)
                  setQuery("")
                  setMenu(null)
                }}
              >
                <img src={SERVICES[serviceId].logo} alt="" />
                <span>{SERVICES[serviceId].shortName}</span>
                <b>{accounts.filter((account) => serviceOf(account) === serviceId).length}</b>
              </button>
            ))}
          </nav>
        )}
        {cacheNotice && (
          <div className="cache-status" role="status">
            <span>{cacheNotice}</span>
            <button type="button" aria-label="Dismiss cache status" onClick={() => setCacheNotice("")}>×</button>
          </div>
        )}
        {view === "settings" ? (
          <Settings
            profile={profile}
            onAvatarChange={updateProfileAvatar}
            accountCount={accounts.length}
            clearingAllCaches={clearingAllCaches}
            onClearAllCaches={() => void handleClearAllAccountCaches()}
          />
        ) : view === "license" ? (
          <LicensePage licenseState={licenseState} onBuy={() => void openLicensePurchase()} />
        ) : view === "updates" ? (
          <UpdatesPage />
        ) : view === "info" ? (
          <InfoPage />
        ) : (
          <>
            <div className="grid">
              {displayed.map((a) => (
                <Card
                  key={a.id}
                  a={a}
                  menuOpen={menu === a.id}
                  onMenu={() => setMenu(menu === a.id ? null : a.id)}
                  onOpen={() => {
                    setActive(a)
                    setView("flow")
                  }}
                  onFavorite={() => handleToggleFavorite(a)}
                  onDelete={() => handleDelete(a)}
                  onRename={() => handleRename(a)}
                  onClearCache={() => void handleClearAccountCache(a)}
                  cacheBusy={clearingCacheId === a.id || clearingAllCaches}
                  dragEnabled={view === "accounts" && !query.trim()}
                  isDragging={draggingId === a.id}
                  isDropTarget={dragTargetId === a.id}
                  onPointerDown={(event) => beginPointerDrag(a.id, event)}
                />
              ))}
              {view === "accounts" && (
                <AddAccountCard onAdd={handleAddAccount} service={activeService} />
              )}
            </div>
            {draggingId && <DragPreview account={accounts.find((a) => a.id === draggingId) || null} point={dragPoint} offset={dragOffset} />}
          </>
        )}
        {dialog && (
          <div className="overlay">
            <div className="dialog">
              <h2>Delete {dialog.name}?</h2>
              <p>
                This removes the account card from Flowpilot. Your Google
                account is not affected.
              </p>
              <div className="dialog-actions">
                <button className="secondary" onClick={() => setDialog(null)}>
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
        {addAccountOpen && (
          <div className="overlay">
            <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
              <h2 id="add-account-title">Add Account</h2>
              <p>Enter a name for this {SERVICES[activeService].name} account.</p>
              <input
                autoFocus
                value={newAccountName}
                onChange={(event) => {
                  setNewAccountName(event.target.value)
                  setAddAccountError("")
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createAccount()
                }}
                placeholder="Enter account name"
                maxLength={80}
              />
              {addAccountError && <p className="dialog-error">{addAccountError}</p>}
              <div className="dialog-actions">
                <button className="secondary" onClick={() => setAddAccountOpen(false)}>
                  Cancel
                </button>
                <button className="primary" onClick={createAccount}>
                  Add Account
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
  profile,
  licenseState,
}: {
  view: string
  setView: (v: any) => void
  profile: { name: string; avatar: string | null }
  licenseState: LicenseState | null
}) {
  return (
    <aside>
      <Brand />
      <div className="side-label">WORKSPACE</div>
      <button
        className={view === "accounts" ? "active" : ""}
        onClick={() => setView("accounts")}
      >
        <SidebarIcon name="accounts" /> <span>Accounts</span>
      </button>
      <button
        className={view === "favorites" ? "active" : ""}
        onClick={() => setView("favorites")}
      >
        <SidebarIcon name="favorites" /> <span>Favorites</span>
      </button>
      <div className="rule" />
      <div className="side-label">GENERAL</div>
      <button
        className={view === "license" ? "active" : ""}
        onClick={() => setView("license")}
      >
        <SidebarIcon name="license" /> <span>License</span>
      </button>
      <button
        className={view === "updates" ? "active" : ""}
        onClick={() => setView("updates")}
      >
        <SidebarIcon name="updates" /> <span>Updates</span>
      </button>
      <button
        className={view === "info" ? "active" : ""}
        onClick={() => setView("info")}
      >
        <SidebarIcon name="info" /> <span>Info</span>
      </button>
      <button
        className={view === "settings" ? "active" : ""}
        onClick={() => setView("settings")}
      >
        <SidebarIcon name="settings" /> <span>Settings</span>
      </button>
      <div className="side-bottom">
        <div className="avatar">
          {profile.avatar ? (
            <img src={profile.avatar} alt="Flowpilot profile" />
          ) : (
            "YK"
          )}
        </div>
        <div>
          <div className="side-license-info">
            <small>
              <span>License {licenseState ? licenseStatusLabel(licenseState.status) : "Unavailable"}: <b>{licenseState ? licensePlanLabel(licenseState.plan) : "—"}</b></span>
              <span>Expired: <b>{licenseExpiryLabel(licenseState)}</b></span>
            </small>
          </div>
        </div>
      </div>
    </aside>
  )
}
function SidebarIcon({ name }: { name: "accounts" | "favorites" | "license" | "updates" | "info" | "settings" }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true }
  const paths = {
    accounts: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    favorites: <path d="m12 4 2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8L12 4Z" />,
    license: <><path d="M7 4h10l2 3v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7l2-3Z" /><path d="M9 4v4h6V4M9 13h6M9 17h4" /></>,
    updates: <><path d="M20 11a8 8 0 0 0-14.7-4L4 9" /><path d="M4 4v5h5M4 13a8 8 0 0 0 14.7 4L20 15" /><path d="M20 20v-5h-5" /></>,
    info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.8" fill="currentColor" stroke="none" /></>,
  }
  return <svg className="sidebar-icon" {...common}>{paths[name]}</svg>
}
function LicensePage({ licenseState, onBuy }: { licenseState: LicenseState | null; onBuy: () => void }) {
  return (
    <div className="feature-page">
      <div className="plan-grid">
        {plans.map((plan) => (
          <section className="plan-card" key={plan.name}>
            <div className="eyebrow">{plan.name.toUpperCase()}</div>
            <s>{plan.originalPrice}</s>
            <strong>{plan.price}</strong>
            <p>{plan.description}.</p>
            <button className="primary" onClick={onBuy}>
              Buy License
            </button>
          </section>
        ))}
      </div>
      <section className="license-info">
        <div className="eyebrow">CURRENT LICENSE</div>
        <h2>Current License</h2>
        <div className="license-stats">
          <span>
            <b>Plan</b>
            {licenseState ? licensePlanLabel(licenseState.plan) : "—"}
          </span>
          <span>
            <b>Status</b>
            {licenseState ? licenseStatusLabel(licenseState.status) : "Unavailable"}
          </span>
          <span>
            <b>Expires</b>
            {licenseExpiryLabel(licenseState)}
          </span>
        </div>
      </section>
    </div>
  )
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
      "Enter Your License",
      "Enter your Flowpilot license on the initial screen to activate the application.",
    ],
    [
      "Add an Account",
      "Click + Add Account to add another Google Flow account.",
    ],
    [
      "Sign In to Google Flow",
      "Sign in directly through Google Flow. Flowpilot does not ask for or store your Google password.",
    ],
    [
      "Manage Your Accounts",
      "Use Account Cards to open, rename, favorite, remove, and reorder your Google Flow accounts.",
    ],
    [
      "Open Google Flow",
      "Click Open Google Flow to open the selected account.",
    ],
    [
      "Switch Between Accounts",
      "Use the mini navigation while Google Flow is open to quickly switch between your accounts.",
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

function AddAccountCard({ onAdd, service = "flow" }: { onAdd: () => void; service?: ServiceId }) {
  return (
    <button className="add-card" onClick={onAdd}>
      <span>＋</span>
      <b>Add Account</b>
      <small>Add another {SERVICES[service].name} account</small>
    </button>
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
  isDropTarget,
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
  isDropTarget: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
}) {
  const service = SERVICES[serviceOf(a)]
  return (
    <article data-account-id={a.id} onPointerDown={onPointerDown} className={`card ${dragEnabled ? "is-draggable" : ""} ${isDragging ? "is-dragging" : ""} ${isDropTarget ? "is-drop-target" : ""}`}>
      <div className="card-top">
        <button
          className={`star ${a.favorite ? "fav" : ""}`}
          onClick={onFavorite}
        >
          {a.favorite ? "★" : "☆"}
        </button>
        <div className="menu-wrap">
          <button className="more" onClick={onMenu}>
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
      <div className="avatar large">
        <img
          src={a.avatarUrl || service.logo}
          alt={`${service.name} account`}
          draggable={false}
        />
      </div>
      <h2>{a.name}</h2>
      <button className="primary wide" onClick={onOpen}>
        Open {service.shortName} <span>→</span>
      </button>
      <div className="card-links">
        <button onClick={onRename}>✎ Rename</button>
        <button onClick={onDelete}>⌫ Remove</button>
      </div>
    </article>
  )
}
function DragPreview({ account, point, offset }: { account: Account | null; point: { x: number; y: number }; offset: { x: number; y: number } }) {
  if (!account) return null
  const service = SERVICES[serviceOf(account)]
  return (
    <div className="custom-drag-layer" aria-hidden="true">
      <article className="drag-preview-card" style={{ transform: `translate3d(${point.x - offset.x}px, ${point.y - offset.y}px, 0) scale(1.04) rotate(2deg)` }}>
        <div className="card-top"><span className={`star ${account.favorite ? "fav" : ""}`}>{account.favorite ? "★" : "☆"}</span><span className="more">•••</span></div>
        <div className="avatar large"><img src={account.avatarUrl || service.logo} alt="" /></div>
        <h2>{account.name}</h2>
        <div className="primary wide">Open {service.shortName} <span>→</span></div>
      </article>
    </div>
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
            Flowpilot stores account metadata on this device. Google passwords
            and credentials are never captured.
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
function FlowShell({
  account,
  accounts,
  bookmarks,
  fullView,
  navigatorOpen,
  onToggleFullView,
  onToggleNavigator,
  onSelectAccount,
  onAddBookmark,
  onDeleteBookmark,
  onBack,
}: {
  account: Account
  accounts: Account[]
  bookmarks: FlowBookmark[]
  fullView: boolean
  navigatorOpen: boolean
  onToggleFullView: () => void
  onToggleNavigator: () => void
  onSelectAccount: (account: Account) => void
  onAddBookmark: (name: string, url: string) => string | null
  onDeleteBookmark: (id: string) => void
  onBack: () => void
}) {
  const serviceId = serviceOf(account)
  const service = SERVICES[serviceId]
  const [status, setStatus] = useState(`Loading ${service.name}...`)
  const [bookmarkManagerOpen, setBookmarkManagerOpen] = useState(false)
  const [bookmarkName, setBookmarkName] = useState("")
  const [bookmarkUrl, setBookmarkUrl] = useState("")
  const [bookmarkError, setBookmarkError] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setBookmarkManagerOpen(false)
    setBookmarkName("")
    setBookmarkUrl("")
    setBookmarkError("")
    let cancelled = false
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    invoke("open_google_flow", {
      accountId: account.id,
      service: serviceId,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    })
      .then(() => {
        if (!cancelled) setStatus(`${service.name} ready`)
        containerRef.current?.dispatchEvent(new Event("flowpilot-webview-ready"))
      })
      .catch((error) => {
        console.error(`${service.name} WebView failed`, error)
        if (!cancelled) setStatus(`Unable to open ${service.name}. Please try again.`)
      })
    return () => {
      cancelled = true
      void invoke("close_google_flow", { accountId: account.id, service: serviceId })
    }
  }, [account.id, serviceId])
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
  }, [navigatorOpen, fullView, account.id, serviceId])
  const showWebview = async () => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setBookmarkManagerOpen(false)
    setStatus(`Loading ${service.name}...`)
    try {
      await invoke("open_google_flow", {
        accountId: account.id,
        service: serviceId,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
      setStatus(`${service.name} ready`)
    } catch (error) {
      console.error(`${service.name} WebView failed`, error)
      setStatus(`Unable to open ${service.name}. Please try again.`)
    }
  }
  const navigateFlow = async (url: string, name: string) => {
    if (serviceId !== "flow") return
    try {
      if (navigatorOpen) onToggleNavigator()
      if (bookmarkManagerOpen) await showWebview()
      setStatus(`Opening ${name}...`)
      await invoke("navigate_google_flow", { accountId: account.id, url })
      setStatus(`${name} ready`)
    } catch (error) {
      console.error("Google Flow bookmark failed", error)
      setStatus(`Unable to open ${name}. Please check the bookmark URL.`)
    }
  }
  const openBookmarkManager = async () => {
    try {
      if (navigatorOpen) onToggleNavigator()
      await invoke("close_google_flow", { accountId: account.id, service: serviceId })
      setBookmarkManagerOpen(true)
      setBookmarkError("")
      setStatus("Manage Flow bookmarks")
    } catch (error) {
      console.error("Unable to open bookmark manager", error)
      setStatus("Unable to open bookmark manager. Please try again.")
    }
  }
  const submitBookmark = () => {
    const error = onAddBookmark(bookmarkName, bookmarkUrl)
    if (error) {
      setBookmarkError(error)
      return
    }
    setBookmarkName("")
    setBookmarkUrl("")
    setBookmarkError("")
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (bookmarkManagerOpen) {
        void showWebview()
      } else if (fullView) {
        onToggleFullView()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [bookmarkManagerOpen, fullView, onToggleFullView])
  return (
    <div className={`flow-shell ${navigatorOpen ? "navigator-open" : ""} ${serviceId === "flow" ? "has-bookmarks" : ""}`}>
      <div className="flow-bar">
        <button className="back" onClick={onBack}>‹ Accounts</button>
        <span>{status}</span>
        <div className="flow-controls">
          <div className="mini-navigator">
            <button className="navigator-trigger" onClick={onToggleNavigator} aria-expanded={navigatorOpen}>
              <img src={account.avatarUrl || service.logo} alt="" />
              <span>{account.name}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {navigatorOpen && (
              <div className="navigator-menu">
                {accounts.map((candidate) => (
                  <button
                    key={candidate.id}
                    className={candidate.id === account.id ? "selected" : ""}
                    onClick={() => onSelectAccount(candidate)}
                  >
                    <img src={candidate.avatarUrl || SERVICES[serviceOf(candidate)].logo} alt="" />
                    <span>{candidate.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="fullscreen" onClick={onToggleFullView}>
            {fullView ? "Exit Full View" : "Full View"}
          </button>
        </div>
      </div>
      {serviceId === "flow" && (
        <nav className="flow-bookmark-bar" aria-label="Google Flow bookmarks">
          <button type="button" className="flow-bookmark flow-bookmark-home" onClick={() => void navigateFlow(service.url, "Flow")}>
            <img src={service.logo} alt="" />
            <span>Flow</span>
          </button>
          {bookmarks.map((bookmark) => (
            <button
              type="button"
              className="flow-bookmark"
              key={bookmark.id}
              title={bookmark.url}
              onClick={() => void navigateFlow(bookmark.url, bookmark.name)}
            >
              {bookmark.name}
            </button>
          ))}
          <button
            type="button"
            className="flow-bookmark-add"
            title="Manage Flow bookmarks"
            aria-label="Manage Flow bookmarks"
            onClick={() => void openBookmarkManager()}
          >
            +
          </button>
        </nav>
      )}
      <div ref={containerRef} className="webview-host" aria-label={`${service.name} WebView`}>
        {bookmarkManagerOpen && serviceId === "flow" && (
          <section className="bookmark-manager" aria-labelledby="bookmark-manager-title">
            <div className="bookmark-manager-heading">
              <div>
                <h2 id="bookmark-manager-title">Flow bookmarks</h2>
                <p>Add shortcuts for private tools hosted inside Google Flow.</p>
              </div>
              <button type="button" className="bookmark-close" onClick={() => void showWebview()} aria-label="Close bookmark manager">×</button>
            </div>
            <div className="bookmark-form">
              <label>
                <span>Name</span>
                <input value={bookmarkName} maxLength={50} onChange={(event) => setBookmarkName(event.target.value)} placeholder="Tool name" />
              </label>
              <label>
                <span>Google Flow URL</span>
                <input
                  value={bookmarkUrl}
                  onChange={(event) => setBookmarkUrl(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && submitBookmark()}
                  placeholder="https://labs.google/fx/tools/flow/..."
                />
              </label>
              <button type="button" className="primary" onClick={submitBookmark}>Add bookmark</button>
            </div>
            {bookmarkError && <p className="bookmark-error" role="alert">{bookmarkError}</p>}
            <div className="bookmark-list">
              {bookmarks.length === 0 ? (
                <p className="bookmark-empty">No private tools saved. Add your first Google Flow URL above.</p>
              ) : bookmarks.map((bookmark) => (
                <div className="bookmark-row" key={bookmark.id}>
                  <div>
                    <strong>{bookmark.name}</strong>
                    <span>{bookmark.url}</span>
                  </div>
                  <button type="button" onClick={() => onDeleteBookmark(bookmark.id)}>Remove</button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
