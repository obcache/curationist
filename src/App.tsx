import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityBar } from './components/ActivityBar'
import { AudioPlayerBar } from './components/AudioPlayerBar'
import { BrandLogo } from './components/BrandLogo'
import { MusicWorkspace } from './components/MusicWorkspace'
import { OutputLogPanel } from './components/OutputLogPanel'
import { PreferencesModal } from './components/PreferencesModal'
import { PresetWorkspace } from './components/PresetWorkspace'
import { StatusBar } from './components/StatusBar'
import { TitleBar, type PanelViewItem } from './components/TitleBar'
import type {
  AppSettings,
  LogEntry,
  Mp3Track,
  MusicWorkspaceState,
  PresetWorkspaceState,
  WorkspaceMode
} from './types'

export const App: React.FC = () => {
  const [workspace, setWorkspace] = useState<WorkspaceMode>('music')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [musicState, setMusicState] = useState<MusicWorkspaceState | null>(null)
  const [presetState, setPresetState] = useState<PresetWorkspaceState | null>(null)
  const [showPreferences, setShowPreferences] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Ready')
  const [layoutResetCounter, setLayoutResetCounter] = useState(0)

  // Output & Activity Log state
  const [showOutputLog, setShowOutputLog] = useState(false)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [logFilePath, setLogFilePath] = useState('')
  const recentBackendMsgRef = useRef<string>('')

  // Panels for View Menu
  const [musicPanels, setMusicPanels] = useState<PanelViewItem[]>([])
  const [presetPanels, setPresetPanels] = useState<PanelViewItem[]>([])
  const musicActionRef = useRef<{ togglePanel: (id: string) => void; showAllPanels: () => void } | null>(null)
  const presetActionRef = useRef<{ togglePanel: (id: string) => void; showAllPanels: () => void } | null>(null)

  const activePanels = workspace === 'music' ? musicPanels : presetPanels
  const handleTogglePanel = (id: string) => {
    if (workspace === 'music') {
      musicActionRef.current?.togglePanel(id)
    } else {
      presetActionRef.current?.togglePanel(id)
    }
  }
  const handleShowAllPanels = () => {
    if (workspace === 'music') {
      musicActionRef.current?.showAllPanels()
    } else {
      presetActionRef.current?.showAllPanels()
    }
  }

  // Audio player state
  const [currentTrack, setCurrentTrack] = useState<Mp3Track | null>(null)
  const [playQueue, setPlayQueue] = useState<Mp3Track[]>([])

  const notify = useCallback((msg: string) => {
    setStatusMessage(msg)
    const isError = /\berror\b|\bfailed\b|\bdeclined\b/i.test(msg)
    const isWarn = /\bwarn(?:ing|s)?\b|\brejected\b/i.test(msg)
    if (isError) {
      setShowOutputLog(true)
    }
    if (recentBackendMsgRef.current !== msg) {
      const level = isError ? 'error' : isWarn ? 'warn' : 'info'
      window.curationist.appendLog(level, 'Activity', msg).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const loadAll = async () => {
      const [s, m, p, logs] = await Promise.all([
        window.curationist.getSettings(),
        window.curationist.getMusicState(),
        window.curationist.getPresetState(),
        window.curationist.getLogsSnapshot()
      ])
      setSettings(s)
      setMusicState(m)
      setPresetState(p)
      setLogEntries(logs.entries)
      setLogFilePath(logs.logFilePath)
    }
    loadAll()

    const unsubscribeMenu = window.curationist.onOpenPreferencesMenu(() => {
      setShowPreferences(true)
    })
    const unsubscribeLogToggle = window.curationist.onToggleOutputLogMenu(() => {
      setShowOutputLog((prev) => !prev)
    })
    const unsubscribeLogEntry = window.curationist.onLogEntry((entry) => {
      if (entry.category !== 'Activity') {
        recentBackendMsgRef.current = entry.message
      }
      if (entry.level === 'error') {
        setShowOutputLog(true)
      }
      setLogEntries((prev) => {
        if (prev.some((e) => e.id === entry.id)) return prev
        const next = [...prev, entry]
        return next.length > 600 ? next.slice(next.length - 600) : next
      })
    })
    return () => {
      unsubscribeMenu()
      unsubscribeLogToggle()
      unsubscribeLogEntry()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setShowPreferences(true)
      } else if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault()
        setWorkspace('music')
      } else if ((e.ctrlKey || e.metaKey) && e.key === '2') {
        e.preventDefault()
        setWorkspace('presets')
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.key.toLowerCase() === 'j')) {
        e.preventDefault()
        setShowOutputLog((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const logCounts = useMemo(() => {
    let warn = 0
    let error = 0
    for (const e of logEntries) {
      if (e.level === 'warn') warn++
      else if (e.level === 'error') error++
    }
    return { total: logEntries.length, warn, error }
  }, [logEntries])

  const handlePlayTrack = (track: Mp3Track, queue?: Mp3Track[]) => {
    setCurrentTrack(track)
    if (queue && queue.length > 0) {
      setPlayQueue(queue)
    } else if (musicState) {
      setPlayQueue(musicState.tracks)
    }
  }

  const handleStepTrack = (delta: -1 | 1) => {
    if (!currentTrack || playQueue.length === 0) return
    const idx = playQueue.findIndex((t) => t.id === currentTrack.id)
    if (idx === -1) return
    const nextIdx = (idx + delta + playQueue.length) % playQueue.length
    setCurrentTrack(playQueue[nextIdx])
  }

  const handleUpdateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const next = await window.curationist.updateSettings(partial)
    setSettings(next)
    return next
  }, [])

  const handlePublishMusic = async () => {
    try {
      const res = await window.curationist.publishMusicPlaylists()
      setMusicState(res.state)
      setStatusMessage(
        `Published ${res.publishedPlaylists} playlist(s) to saved-playlists.json`
      )
    } catch (err: any) {
      notify(`Publish error: ${err?.message || String(err)}`)
    }
  }

  const handlePublishPresets = async () => {
    try {
      const res = await window.curationist.publishPresets()
      setPresetState(res.state)
      setStatusMessage(
        `Published ${res.libraryPresetsWritten} library presets & ${res.playlistItemsWritten} playlist.dat items`
      )
    } catch (err: any) {
      notify(`Publish error: ${err?.message || String(err)}`)
    }
  }

  if (!settings || !musicState || !presetState) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1e1e1e',
          color: '#cccccc'
        }}
      >
        <BrandLogo size={54} />
        <span>Initializing Curationist SQLite Studio &amp; Discovering OBS Plugin Data...</span>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <TitleBar
        workspace={workspace}
        onSwitchWorkspace={setWorkspace}
        onOpenPreferences={() => setShowPreferences(true)}
        onResetLayout={() => setLayoutResetCounter((c) => c + 1)}
        showOutputLog={showOutputLog}
        onToggleOutputLog={() => setShowOutputLog((prev) => !prev)}
        panels={activePanels}
        onTogglePanel={handleTogglePanel}
        onShowAllPanels={handleShowAllPanels}
        musicModified={musicState.isModified}
        presetModified={presetState.isModified}
        onPublishMusic={handlePublishMusic}
        onPublishPresets={handlePublishPresets}
      />

      <div className="workbench">
        <ActivityBar
          workspace={workspace}
          onSelectWorkspace={setWorkspace}
          onOpenPreferences={() => setShowPreferences(true)}
          musicModified={musicState.isModified}
          presetModified={presetState.isModified}
        />

        {workspace === 'music' ? (
          <MusicWorkspace
            state={musicState}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onStateChange={setMusicState}
            onPlayTrack={handlePlayTrack}
            playingTrackId={currentTrack?.id}
            onNotify={notify}
            layoutResetCounter={layoutResetCounter}
            onPanelsChange={setMusicPanels}
            panelActionRef={musicActionRef}
          />
        ) : (
          <PresetWorkspace
            state={presetState}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onStateChange={setPresetState}
            onNotify={notify}
            layoutResetCounter={layoutResetCounter}
            onPanelsChange={setPresetPanels}
            panelActionRef={presetActionRef}
          />
        )}
      </div>

      {showOutputLog && (
        <OutputLogPanel
          entries={logEntries}
          logFilePath={logFilePath}
          onClear={async () => {
            const snap = await window.curationist.clearLogs()
            setLogEntries(snap.entries)
          }}
          onClose={() => setShowOutputLog(false)}
        />
      )}

      <AudioPlayerBar
        currentTrack={currentTrack}
        onPrevTrack={() => handleStepTrack(-1)}
        onNextTrack={() => handleStepTrack(1)}
      />

      <StatusBar
        workspace={workspace}
        musicState={musicState}
        presetState={presetState}
        statusMessage={statusMessage}
        showOutputLog={showOutputLog}
        onToggleOutputLog={() => setShowOutputLog((prev) => !prev)}
        logTotalCount={logCounts.total}
        logWarnCount={logCounts.warn}
        logErrorCount={logCounts.error}
        onPublishMusic={handlePublishMusic}
        onPublishPresets={handlePublishPresets}
      />

      {showPreferences && (
        <PreferencesModal
          settings={settings}
          onClose={() => setShowPreferences(false)}
          onSave={async (updated) => {
            const nextSettings = await window.curationist.updateSettings(updated)
            setSettings(nextSettings)
            const [m, p] = await Promise.all([
              window.curationist.getMusicState(),
              window.curationist.getPresetState()
            ])
            setMusicState(m)
            setPresetState(p)
            setStatusMessage('Saved Preferences')
          }}
        />
      )}
    </div>
  )
}
