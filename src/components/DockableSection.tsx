import React from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  PanelLeftOpen,
  PanelRightOpen,
  X
} from 'lucide-react'
import type { SidebarSide } from '../types'

interface DockableSectionProps {
  id: string
  title: string
  count?: number
  badgeText?: string
  badgeVariant?: 'modified' | 'synced' | 'managed' | 'warning'
  side: SidebarSide
  collapsed: boolean
  onToggleCollapse: (id: string) => void
  onSwapSide: (id: string) => void
  onHide?: (id: string) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveOrder?: (id: string, delta: -1 | 1) => void
  actions?: React.ReactNode
  style?: React.CSSProperties
  children: React.ReactNode
}

export const DockableSection: React.FC<DockableSectionProps> = ({
  id,
  title,
  count,
  badgeText,
  badgeVariant = 'modified',
  side,
  collapsed,
  onToggleCollapse,
  onSwapSide,
  onHide,
  canMoveUp = false,
  canMoveDown = false,
  onMoveOrder,
  actions,
  style,
  children
}) => {
  return (
    <div
      className={`dockable-section ${collapsed ? 'collapsed' : 'expanded'}`}
      style={style}
    >
      <div
        className="section-header"
        onClick={() => onToggleCollapse(id)}
        title="Click to expand/collapse section"
      >
        <div className="section-header-left">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="section-title">{title}</span>
          {count !== undefined && <span className="section-count-pill">{count}</span>}
          {badgeText && <span className={`badge ${badgeVariant}`}>{badgeText}</span>}
        </div>
        <div
          className="section-header-actions"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
          {onMoveOrder && (canMoveUp || canMoveDown) && (
            <>
              <button
                className="icon-btn"
                disabled={!canMoveUp}
                onClick={() => onMoveOrder(id, -1)}
                title="Move panel up"
              >
                <ArrowUp size={12} />
              </button>
              <button
                className="icon-btn"
                disabled={!canMoveDown}
                onClick={() => onMoveOrder(id, 1)}
                title="Move panel down"
              >
                <ArrowDown size={12} />
              </button>
            </>
          )}
          <button
            className="icon-btn"
            onClick={() => onSwapSide(id)}
            title={
              side === 'left'
                ? 'Relocate section to Right Sidebar'
                : 'Relocate section to Left Sidebar'
            }
          >
            {side === 'left' ? <PanelRightOpen size={13} /> : <PanelLeftOpen size={13} />}
          </button>
          {onHide && (
            <button
              className="icon-btn"
              onClick={() => onHide(id)}
              title="Hide panel from sidebar (re-enable in View menu)"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div className="section-body">{children}</div>}
    </div>
  )
}
