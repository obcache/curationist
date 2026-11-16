import React, { useEffect, useRef, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { BrandLogo } from './BrandLogo'
import type { WorkspaceMode } from '../types'

export interface PanelViewItem {
  id: string
  label: string
  visible: boolean
}

interface TitleBarProps {
  workspace: WorkspaceMode
  onSwitchWorkspace: (mode: WorkspaceMode) => void
  onOpenPreferences: () => void
  onResetLayout: () => void
  showOutputLog: boolean
  onToggleOutputLog: () => void
  panels: PanelViewItem[]
  onTogglePanel: (id: string) => void
  onShowAllPanels: () => void
  musicModified: boolean
  presetModified: boolean
  onPublishMusic: () => void
  onPublishPresets: () => void
}

export const TitleBar: React.FC<TitleBarProps> = ({
  workspace,
  onSwitchWorkspace,
  onOpenPreferences,
  onResetLayout,
  showOutputLog,
  onToggleOutputLog,
  panels,
  onTogglePanel,
  onShowAllPanels,
  musicModified,
  presetModified,
  onPublishMusic,
  onPublishPresets
}) => {
  const [openMenu, setOpenMenu] = useState<'file' | 'view' | 'publish' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-left" ref={menuRef}>
        <div className="app-brand">
          <BrandLogo size={19} className="app-brand-logo" />
          <span>CURATIONIST</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#8b949e',
              fontFamily: 'var(--font-mono)',
              letterSpacing: 0
            }}
          >
            v1.2.0
          </span>
        </div>

        <nav className="menubar">
          <div className="menu-item-wrapper">
            <button
              className={`menu-btn ${openMenu === 'file' ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
            >
              File
            </button>
            {openMenu === 'file' && (
              <div className="menu-dropdown">
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpenMenu(null)
                    onOpenPreferences()
                  }}
                >
                  <span>Preferences...</span>
                  <span className="menu-shortcut">Ctrl+,</span>
                </button>
                <div className="menu-dropdown-sep" />
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpenMenu(null)
                    onPublishMusic()
                  }}
                >
                  <span>Publish nowPlaylisting JSON</span>
                  {musicModified && <span className="badge modified">Draft</span>}
                </button>
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpenMenu(null)
                    onPublishPresets()
                  }}
                >
                  <span>Publish obSpiltMilk Library &amp; Playlist</span>
                  {presetModified && <span className="badge modified">Draft</span>}
                </button>
                <div className="menu-dropdown-sep" />
                <button
                  className="menu-dropdown-item"
                  onClick={() => window.curationist.closeWindow()}
                >
                  <span>Exit</span>
                  <span className="menu-shortcut">Alt+F4</span>
                </button>
              </div>
            )}
          </div>

          <div className="menu-item-wrapper">
            <button
              className={`menu-btn ${openMenu === 'view' ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
            >
              View
            </button>
            {openMenu === 'view' && (
              <div className="menu-dropdown">
                <div className="menu-dropdown-header">Workspace</div>
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpenMenu(null)
                    onSwitchWorkspace('music')
                  }}
                >
                  <div className="menu-dropdown-item-left">
                    <span className="menu-check">{workspace === 'music' ? '✓' : ''}</span>
                    <span>nowPlaylisting (MP3 Workspace)</span>
                  </div>
                  <span className="menu-shortcut">Ctrl+1</span>
                </button>
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpenMenu(null)
                    onSwitchWorkspace('presets')
                  }}
                >
                  <div className="menu-dropdown-item-left">
                    <span className="menu-check">{workspace === 'presets' ? '✓' : ''}</span>
                    <span>obSpiltMilk (Presets Workspace)</span>
                  </div>
                  <span className="menu-shortcut">Ctrl+2</span>
                </button>

                <div className="menu-dropdown-sep" />
                <div className="menu-dropdown-header">Sidebar Panels</div>
                {panels.map((p) => (
                  <button
                    key={p.id}
                    className="menu-dropdown-item"
                    onClick={() => onTogglePanel(p.id)}
                    title={p.visible ? `Hide "${p.label}"` : `Show "${p.label}"`}
                  >
                    <div className="menu-dropdown-item-left">
                      <span className="menu-check">{p.visible ? '✓' : ''}</span>
                      <span>{p.label}</span>
                    </div>
                  </button>
                ))}
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpenMenu(null)
                    onShowAllPanels()
                  }}
                  title="Show all sidebar panels in current workspace"
                >
                  <div className="menu-dropdown-item-left">
                    <span className="menu-check" />
                    <span style={{ color: '#4ec9b0', fontWeight: 500 }}>Show All Panels</span>
                  </div>
                </button>

                <div className="menu-dropdown-sep" />
                <div className="menu-dropdown-header">Diagnostics &amp; Layout</div>
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpenMenu(null)
                    onToggleOutputLog()
                  }}
                >
                  <div className="menu-dropdown-item-left">
                    <span className="menu-check">{showOutputLog ? '✓' : ''}</span>
                    <span>{showOutputLog ? 'Hide Output & Activity Log' : 'Show Output & Activity Log'}</span>
                  </div>
                  <span className="menu-shortcut">Ctrl+`</span>
                </button>
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpenMenu(null)
                    window.curationist.openLogFile()
                  }}
                >
                  <div className="menu-dropdown-item-left">
                    <span className="menu-check" />
                    <span>Open Log File on Disk (.log)</span>
                  </div>
                </button>
                <div className="menu-dropdown-sep" />
                <button
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpenMenu(null)
                    onResetLayout()
                  }}
                >
                  <div className="menu-dropdown-item-left">
                    <span className="menu-check" />
                    <span>Reset Dockable Panel Layout</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </nav>
      </div>

      <div className="titlebar-center">
        <span>
          {workspace === 'music'
            ? 'nowPlaylisting — MP3 Library & Multi-Playlist Studio'
            : 'obSpiltMilk — projectM Preset Validation & Playlist Studio'}
        </span>
        {(musicModified || presetModified) && (
          <span className="badge modified">Unpublished Draft Changes</span>
        )}
      </div>

      <div className="titlebar-right">
        <button
          className="win-btn"
          onClick={() => window.curationist.minimizeWindow()}
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          className="win-btn"
          onClick={() => window.curationist.maximizeWindow()}
          title="Maximize / Restore"
        >
          <Square size={12} />
        </button>
        <button
          className="win-btn close"
          onClick={() => window.curationist.closeWindow()}
          title="Close"
        >
          <X size={15} />
        </button>
      </div>
    </header>
  )
}
