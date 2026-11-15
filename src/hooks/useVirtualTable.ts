import { useCallback, useEffect, useRef, useState } from 'react'

export interface VirtualTableSlice {
  containerRef: React.RefObject<HTMLDivElement | null>
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
  startIndex: number
  endIndex: number
  topSpacerHeight: number
  bottomSpacerHeight: number
}

export function useVirtualTable(
  itemCount: number,
  rowHeight = 26,
  overscan = 24
): VirtualTableSlice {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(650)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateHeight = () => {
      if (el.clientHeight > 0) {
        setViewportHeight(el.clientHeight)
      }
    }
    updateHeight()
    const ro = new ResizeObserver(updateHeight)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  if (itemCount <= 100) {
    return {
      containerRef,
      onScroll,
      startIndex: 0,
      endIndex: itemCount,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0
    }
  }

  const maxScrollTop = Math.max(0, itemCount * rowHeight - viewportHeight)
  const clampedScrollTop = Math.min(scrollTop, maxScrollTop)

  const startIndex = Math.max(0, Math.floor(clampedScrollTop / rowHeight) - overscan)
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2
  const endIndex = Math.min(itemCount, startIndex + visibleCount)

  const topSpacerHeight = startIndex * rowHeight
  const bottomSpacerHeight = Math.max(0, (itemCount - endIndex) * rowHeight)

  return {
    containerRef,
    onScroll,
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight
  }
}
