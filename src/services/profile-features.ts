export type ProfileSort = "newest" | "recent" | "oldest" | "name_asc" | "name_desc" | "manual"

export const PROFILE_SORT_OPTIONS: { value: ProfileSort; label: string }[] = [
  { value: "manual", label: "Manual (Drag & Drop)" },
  { value: "newest", label: "Last Added" },
  { value: "recent", label: "Last Opened" },
  { value: "oldest", label: "First Added" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
]

export type SortableAccount = {
  id: string
  name: string
  order: number
  addedAt?: number
  lastOpenedAt?: number
}
export type ShareSource = { id: string; name: string }
export type LinkedAccount = {
  service?: string
  flowSessionId?: string
  order: number
}

export function sortProfileCards<T extends SortableAccount>(accounts: readonly T[], sort: ProfileSort): T[] {
  const list = [...accounts]
  const fallbackOrder = (a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id)
  switch (sort) {
    case "newest": return list.sort((a, b) =>
      (b.addedAt ?? b.order) - (a.addedAt ?? a.order) || fallbackOrder(a, b))
    case "oldest": return list.sort((a, b) =>
      (a.addedAt ?? a.order) - (b.addedAt ?? b.order) || fallbackOrder(a, b))
    case "recent": return list.sort((a, b) =>
      (b.lastOpenedAt ?? -1) - (a.lastOpenedAt ?? -1) ||
      (b.addedAt ?? b.order) - (a.addedAt ?? a.order) || fallbackOrder(a, b))
    case "name_asc": return list.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || fallbackOrder(a, b))
    case "name_desc": return list.sort((a, b) =>
      b.name.localeCompare(a.name, undefined, { sensitivity: "base", numeric: true }) || fallbackOrder(a, b))
    case "manual": return list.sort(fallbackOrder)
  }
}

export function availableSharedSources<T extends ShareSource>(
  flowSources: readonly T[],
  targetAccounts: readonly LinkedAccount[]
): T[] {
  const linked = new Set(targetAccounts.map(account => account.flowSessionId).filter(Boolean))
  return flowSources.filter(source => !linked.has(source.id))
}

export function readProfileSort(service: string): ProfileSort {
  try {
    const stored = localStorage.getItem(`flowpilot-sort-${service}`)
    return PROFILE_SORT_OPTIONS.find(item => item.value === stored)?.value || "manual"
  } catch {
    return "manual"
  }
}
