import { useLayoutEffect, type RefObject } from "react"

export function useDialogFocus(open: boolean, returnFocus: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    if (!open) return
    const dialogs = document.querySelectorAll<HTMLElement>('.dialog[role="dialog"]')
    const dialog = dialogs[dialogs.length - 1]
    if (!dialog) return
    const previous = returnFocus.current || document.activeElement as HTMLElement | null
    const protectedSiblings: { element: Element; wasInert: boolean }[] = []
    // Inert every sibling on the path to the root, without making the dialog inert.
    let branch: Element = dialog.closest(".overlay") || dialog
    while (branch.parentElement && branch.parentElement !== document.body) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling === branch) continue
        protectedSiblings.push({ element: sibling, wasInert: sibling.hasAttribute("inert") })
        sibling.setAttribute("inert", "")
      }
      branch = branch.parentElement
    }
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length > 0)
    const initial = dialog.querySelector<HTMLElement>("[autofocus]") || controls()[0]
    initial?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return
      const items = controls()
      const first = items[0], last = items[items.length - 1]
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }
    document.addEventListener("keydown", trap)
    return () => {
      document.removeEventListener("keydown", trap)
      for (const { element, wasInert } of protectedSiblings) if (!wasInert) element.removeAttribute("inert")
      if (previous?.isConnected) previous.focus()
    }
  }, [open, returnFocus])
}
