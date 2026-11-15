import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'

export type ContextMenuEntry =
  | {
      type?: 'item'
      id: string
      label: string
      icon?: React.ReactNode
      hint?: string
      disabled?: boolean
      danger?: boolean
      onClick: () => void
    }
  | {
      type: 'separator'
      id: string
    }
  | {
      type: 'rating'
      id: string
      label: string
      currentRating: number
      onSelectRating: (rating: number) => void
    }

interface ContextMenuProps {
  x: number
  y: number
  headerLabel?: string
  entries: ContextMenuEntry[]
  onClose: () => void
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  headerLabel,
  entries,
  onClose
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y })
  const [hoverStar, setHoverStar] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (left + rect.width > vw - 8) {
      left = Math.max(8, vw - rect.width - 8)
    }
    if (top + rect.height > vh - 8) {
      top = Math.max(8, vh - rect.height - 8)
    }
    setPos({ left, top })
  }, [x, y, entries])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    const onScrollOrBlur = () => {
      onClose()
    }

    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onScrollOrBlur)
    window.addEventListener('scroll', onScrollOrBlur, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onScrollOrBlur)
      window.removeEventListener('scroll', onScrollOrBlur, true)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="vscode-context-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {headerLabel && <div className="vscode-context-menu-header">{headerLabel}</div>}
      {entries.map((entry) => {
        if (entry.type === 'separator') {
          return <div key={entry.id} className="vscode-context-menu-separator" />
        }
        if (entry.type === 'rating') {
          const activeVal = hoverStar !== null ? hoverStar : entry.currentRating
          return (
            <div key={entry.id} className="vscode-context-menu-rating-row">
              <span className="vscode-context-menu-rating-label">{entry.label}</span>
              <div
                className="vscode-context-menu-stars"
                onMouseLeave={() => setHoverStar(null)}
              >
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`star-btn ${star <= activeVal ? 'active' : ''}`}
                    onMouseEnter={() => setHoverStar(star)}
                    onClick={() => {
                      const next = entry.currentRating === star ? 0 : star
                      entry.onSelectRating(next)
                      onClose()
                    }}
                    title={
                      entry.currentRating === star
                        ? `Clear rating (${star}★)`
                        : `Rate ${star} star${star === 1 ? '' : 's'}`
                    }
                  >
                    <Star
                      size={13}
                      fill={star <= activeVal ? '#f59e0b' : 'transparent'}
                      color={star <= activeVal ? '#f59e0b' : '#71717a'}
                    />
                  </button>
                ))}
                {entry.currentRating > 0 && (
                  <button
                    type="button"
                    className="star-clear-btn"
                    onClick={() => {
                      entry.onSelectRating(0)
                      onClose()
                    }}
                    title="Clear rating"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )
        }
        return (
          <button
            key={entry.id}
            type="button"
            disabled={entry.disabled}
            className={`vscode-context-menu-item ${entry.danger ? 'danger' : ''}`}
            onClick={() => {
              if (entry.disabled) return
              const fn = entry.onClick
              onClose()
              fn()
            }}
          >
            <span className="vscode-context-menu-icon">{entry.icon}</span>
            <span className="vscode-context-menu-label">{entry.label}</span>
            {entry.hint && <span className="vscode-context-menu-hint">{entry.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
