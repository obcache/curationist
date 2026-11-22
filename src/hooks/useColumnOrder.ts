import React, { useCallback, useState } from 'react'

export function useColumnOrder<T extends string>(
  storageKey: string,
  defaultOrder: readonly T[]
) {
  const [columnOrder, setColumnOrder] = useState<T[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return [...defaultOrder]
      const parsed = JSON.parse(raw) as T[]
      if (!Array.isArray(parsed)) return [...defaultOrder]
      const validSet = new Set(defaultOrder)
      const kept = parsed.filter((col) => validSet.has(col))
      const keptSet = new Set(kept)
      const missing = defaultOrder.filter((col) => !keptSet.has(col))
      return [...kept, ...missing]
    } catch {
      return [...defaultOrder]
    }
  })

  const [dragOverCol, setDragOverCol] = useState<T | null>(null)

  const moveColumn = useCallback(
    (fromCol: T, toCol: T) => {
      if (fromCol === toCol) return
      setColumnOrder((prev) => {
        const fromIdx = prev.indexOf(fromCol)
        const toIdx = prev.indexOf(toCol)
        if (fromIdx === -1 || toIdx === -1) return prev
        const next = [...prev]
        next.splice(fromIdx, 1)
        next.splice(toIdx, 0, fromCol)
        try {
          localStorage.setItem(storageKey, JSON.stringify(next))
        } catch {
          // ignore
        }
        return next
      })
    },
    [storageKey]
  )

  const resetColumnOrder = useCallback(() => {
    const next = [...defaultOrder]
    setColumnOrder(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // ignore
    }
  }, [storageKey, defaultOrder])

  const getHeaderDragProps = useCallback(
    (col: T) => ({
      draggable: true,
      className: dragOverCol === col ? 'col-drag-over' : '',
      onDragStart: (e: React.DragEvent<HTMLTableCellElement>) => {
        if ((e.target as HTMLElement)?.classList?.contains('col-resize-handle')) {
          e.preventDefault()
          return
        }
        e.dataTransfer.setData('application/x-curationist-col-order', col)
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (e: React.DragEvent<HTMLTableCellElement>) => {
        if (e.dataTransfer.types.includes('application/x-curationist-col-order')) {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          setDragOverCol(col)
        }
      },
      onDragLeave: () => {
        setDragOverCol((prev) => (prev === col ? null : prev))
      },
      onDrop: (e: React.DragEvent<HTMLTableCellElement>) => {
        setDragOverCol(null)
        const fromCol = e.dataTransfer.getData('application/x-curationist-col-order') as T
        if (fromCol && fromCol !== col && defaultOrder.includes(fromCol)) {
          e.preventDefault()
          e.stopPropagation()
          moveColumn(fromCol, col)
        }
      }
    }),
    [defaultOrder, dragOverCol, moveColumn]
  )

  return {
    order: columnOrder,
    columnOrder,
    dragOverCol,
    getHeaderDragProps,
    resetColumnOrder
  }
}
