import { useLayoutEffect, useRef, useState } from "react"

type Profile = { id: string; name: string }

export default function ProfileSwitcher<T extends Profile>({ accounts, activeId, disabled = false, onSelect }: {
  accounts: T[]
  activeId?: string
  disabled?: boolean
  onSelect: (account: T) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ before: false, after: false })
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const update = () => {
      const before = list.scrollLeft > 1
      const after = list.scrollLeft + list.clientWidth < list.scrollWidth - 1
      setEdges(current => current.before === before && current.after === after ? current : { before, after })
    }
    const wheel = (event: WheelEvent) => {
      // Native horizontal/trackpad gestures and zoom keep their normal behavior.
      if (event.ctrlKey || event.shiftKey || event.deltaX !== 0 || event.deltaY === 0) return
      const maximum = list.scrollWidth - list.clientWidth
      const delta = event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? list.clientWidth : 1)
      const next = Math.max(0, Math.min(maximum, list.scrollLeft + delta))
      if (Math.abs(next - list.scrollLeft) < 1) return
      event.preventDefault()
      list.scrollLeft = next
    }
    const observer = new ResizeObserver(update)
    observer.observe(list)
    list.addEventListener("scroll", update, { passive: true })
    list.addEventListener("wheel", wheel, { passive: false })
    update()
    return () => { observer.disconnect(); list.removeEventListener("scroll", update); list.removeEventListener("wheel", wheel) }
  }, [accounts])
  useLayoutEffect(() => {
    const list = listRef.current
    const selected = list?.querySelector<HTMLElement>("[aria-current]")
    if (!list || !selected) return
    const parent = list.getBoundingClientRect()
    const child = selected.getBoundingClientRect()
    if (child.left < parent.left) list.scrollLeft -= parent.left - child.left + 4
    else if (child.right > parent.right) list.scrollLeft += child.right - parent.right + 4
  }, [activeId, accounts])
  const scroll = (direction: number) => {
    const list = listRef.current
    if (!list) return
    list.scrollBy({ left: direction * Math.max(142, list.clientWidth * .8), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
  }
  return <nav className="account-shortcuts" aria-label="Profile switcher">
    <button type="button" className="shortcut-more" disabled={disabled || !edges.before} onClick={() => scroll(-1)} aria-label="Scroll profiles left" title="Scroll profiles left">
      <img src="/icons/next.svg" width="16" height="16" alt="" className="previous-arrow" />
    </button>
    <div className="shortcut-list" ref={listRef} onKeyDown={event => {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (index < 0) return
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowRight" ? Math.min(index + 1, buttons.length - 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : -1
      if (next < 0) return
      event.preventDefault()
      buttons[next]?.focus()
    }}>
      {accounts.map(account => <button type="button" key={account.id} className={account.id === activeId ? "active" : ""} aria-current={account.id === activeId ? "true" : undefined} disabled={disabled} title={account.name} onClick={() => onSelect(account)}><span>{account.name}</span></button>)}
    </div>
    <button type="button" className="shortcut-more" disabled={disabled || !edges.after} onClick={() => scroll(1)} aria-label="Scroll profiles right" title="Scroll profiles right">
      <img src="/icons/next.svg" width="16" height="16" alt="" />
    </button>
  </nav>
}
