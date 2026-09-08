// Profile order controls both neighbors and shortcuts; their limits are independent.
export function neighborIndices(count: number, active: number, perSide: number): number[] {
  if (active < 0 || active >= count) return []
  const result: number[] = []
  const limit = Math.max(0, Math.min(5, Math.floor(perSide)))
  for (let distance = 1; distance <= limit; distance++) {
    if (active + distance < count) result.push(active + distance)
    if (active - distance >= 0) result.push(active - distance)
  }
  return result
}
export function shortcutBounds(count: number, active: number, before = 0, after = 0): [number, number] {
  return [Math.max(0, active - 5 - before), Math.min(count, active + 6 + after)]
}
export function readPreloadSides(): number {
  try {
    const saved = localStorage.getItem("flowpilot-preload-sides")
    const value = saved === null ? 2 : Number(saved)
    return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 2
  } catch { return 2 }
}
