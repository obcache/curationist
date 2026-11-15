import { useCallback, useEffect, useState } from 'react'

export function useResizableColumns<T extends Record<string, number>>(
  storageKey: string,
  defaultWidths: T,
  minWidths?: Partial<Record<keyof T, number>>
) {
  const [widths, setWidths] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          return { ...defaultWidths, ...parsed }
        }
      }
    } catch {
      // ignore
    }
    return defaultWidths
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths))
    } catch {
      // ignore
    }
  }, [storageKey, widths])

  const startResize = useCallback(
    (colKey: keyof T, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const startX = e.clientX
      const startWidth = widths[colKey] ?? defaultWidths[colKey] ?? 100
      const minW = minWidths?.[colKey] ?? 42

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX
        const nextWidth = Math.max(minW, Math.round(startWidth + delta))
        setWidths((prev) => ({
          ...prev,
          [colKey]: nextWidth
        }))
      }

      const onMouseUp = () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [widths, defaultWidths, minWidths]
  )

  return { widths, startResize }
}
