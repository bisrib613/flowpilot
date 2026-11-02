export type ProfileSortKey = "manual" | "added" | "opened" | "name"
export type ProfileSortDirection = "asc" | "desc"
export type ProfileSort = { key: ProfileSortKey; direction: ProfileSortDirection }

// Default mirrors the original saved order. Category + direction avoids
// duplicate items such as First Added / Last Added in the dropdown.
export const PROFILE_SORT_OPTIONS: { value: ProfileSortKey; label: string }[] = [
  { value: "manual", label: "Default" },
  { value: "added", label: "Added" },
  { value: "opened", label: "Opened" },
  { value: "name", label: "Name" },
]

export type SortableAccount = {
  id: string
  name: string
  order: number
  addedAt?: number
  lastOpenedAt?: number
}

export function defaultSortDirection(key: ProfileSortKey): ProfileSortDirection {
  return key === "name" ? "asc" : "desc"
}

export function sortProfileCards<T extends SortableAccount>(accounts: readonly T[], sort: ProfileSort): T[] {
  const list = [...accounts]
  const manual = (a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id)
  if (sort.key === "manual") return list.sort(manual)
  const multiplier = sort.direction === "asc" ? 1 : -1
  return list.sort((a, b) => {
    let comparison = 0
    if (sort.key === "name") {
      comparison = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
    } else if (sort.key === "added") {
      // Legacy accounts lack creation timestamps: their stored original order
      // is the best available approximation; newly created profiles have dates.
      comparison = (a.addedAt ?? a.order) - (b.addedAt ?? b.order)
    } else {
      // Never-opened profiles sort last for "recent first", first for oldest first.
      comparison = (a.lastOpenedAt ?? -1) - (b.lastOpenedAt ?? -1)
    }
    return comparison * multiplier || manual(a, b)
  })
}

export type ShareSource = { id: string; name: string }
export type LinkedAccount = {
  service?: string
  flowSessionId?: string
  order: number
}

export function availableSharedSources<T extends ShareSource>(
  flowSources: readonly T[],
  targetAccounts: readonly LinkedAccount[]
): T[] {
  const linked = new Set(targetAccounts.map(account => account.flowSessionId).filter(Boolean))
  return flowSources.filter(source => !linked.has(source.id))
}

export function readProfileSort(service: string): ProfileSort {
  const fallback: ProfileSort = { key: "manual", direction: "asc" }
  try {
    const stored = localStorage.getItem(`flowpilot-sort-${service}`)
    if (!stored || stored === "manual") return fallback
    const [key, direction] = stored.split(":")
    if (PROFILE_SORT_OPTIONS.some(option => option.value === key) &&
        (direction === "asc" || direction === "desc")) {
      return { key: key as ProfileSortKey, direction }
    }
    // Migrate any saved settings from earlier test builds.
    const legacy: Record<string, ProfileSort> = {
      newest: { key: "added", direction: "desc" },
      oldest: { key: "added", direction: "asc" },
      recent: { key: "opened", direction: "desc" },
      name_asc: { key: "name", direction: "asc" },
      name_desc: { key: "name", direction: "desc" },
    }
    return legacy[stored] || fallback
  } catch {
    return fallback
  }
}
