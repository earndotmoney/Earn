import { useEffect, useRef } from 'react'

/**
 * What a dialog owes the keyboard: Escape closes it, focus moves inside when it opens, and goes
 * back to whatever had it when it closes. Returns the ref for the dialog element.
 */
export function useModal<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])')
    first?.focus()
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', on)
    return () => {
      window.removeEventListener('keydown', on)
      // After React has committed the close, so the opener is not mid re-render.
      setTimeout(() => before?.focus?.(), 0)
    }
  }, [open, onClose])
  return ref
}
