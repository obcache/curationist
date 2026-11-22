import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityBar } from './components/ActivityBar'
import { AudioPlayerBar } from './components/AudioPlayerBar'
import { BrandLogo } from './components/BrandLogo'
import { MusicWorkspace } from './components/MusicWorkspace'
import { OutputLogPanel } from './components/OutputLogPanel'
import { PreferencesModal } from './components/PreferencesModal'
import { PresetWorkspace } from './components/PresetWorkspace'
import { SetupWizardModal } from './components/SetupWizardModal'
import { StatusBar } from './components/StatusBar'
import { TitleBar, type PanelViewItem } from './components/TitleBar'
import { VideoWorkspace } from './components/VideoWorkspace'
import type {
  AppSettings,
  LogEntry,
  Mp3Track,
  MusicWorkspaceState,
  ObsConnectionState,
  PresetWorkspaceState,
  VideoWorkspaceState,
  WorkspaceMode
} from './types'

export const App: React.FC = () => {
  const [workspace, setWorkspace] = useState<WorkspaceMode>('music')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [musicState, setMusicState] = useState<MusicWorkspaceState | null>(null)
  const [videoState, setVideoState] = useState<VideoWorkspaceState | null>(null)
  const [presetState, setPresetState] = useState<PresetWorkspaceState | null>(null)
  const [showPreferences, setShowPreferences] = useState(false)
  const [showSetupWizard, setShowSetupWizard] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Ready')
  const [layoutResetCounter, setLayoutResetCounter] = useState(0)

  // Independent "OB" Remote Mode LED toggles for Audio, Video, and Visualizer Shuttles
  const [obsAudioMode, setObsAudioMode] = useState(false)
  const [obsClipMode, setObsClipMode] = useState(false)
  const [obsVideoMode, setObsVideoMode] = useState(false)
  const [obsConnection, setObsConnection] = useState<ObsConnectionState>({
    connected: false,
    sessionId: null,
    endpoint: 'ws://127.0.0.1:4455',
    capabilities: null,
    sources: []
  })

  // Output & Activity Log state
  const [showOutputLog, setShowOutputLog] = useState(false)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [logFilePath, setLogFilePath] = useState('')
  const recentBackendMsgRef = useRef<string>('')

  // Panels for View Menu
  const [musicPanels, setMusicPanels] = useState<PanelViewItem[]>([])
  const [videoPanels, setVideoPanels] = useState<PanelViewItem[]>([])
  const [presetPanels, setPresetPanels] = useState<PanelViewItem[]>([])
  const musicActionRef = useRef<{
    togglePanel: (id: string) => void
    showAllPanels: () => void
  } | null>(null)
  const videoActionRef = useRef<{
    togglePanel: (id: string) => void
    showAllPanels: () => void
  } | null>(null)
  const presetActionRef = useRef<{
    togglePanel: (id: string) => void
    showAllPanels: () => void
  } | null>(null)
  const milkLabActionRef = useRef<{
    openNew: () => void
    openEditSelected: () => void
    getSelectedPresetId: () => string | null
  } | null>(null)

  const activePanels =
    workspace === 'music'
      ? musicPanels
      : workspace === 'video'
        ? videoPanels
        : presetPanels
  const handleTogglePanel = (id: string) => {
    if (workspace === 'music') {
      musicActionRef.current?.togglePanel(id)
    } else if (workspace === 'video') {
      videoActionRef.current?.togglePanel(id)
    } else {
      presetActionRef.current?.togglePanel(id)
    }
  }
  const handleShowAllPanels = () => {
    if (workspace === 'music') {
      musicActionRef.current?.showAllPanels()
    } else if (workspace === 'video') {
      videoActionRef.current?.showAllPanels()
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
      const [s, m, v, p, logs, obsConn] = await Promise.all([
        window.curationist.getSettings(),
        window.curationist.getMusicState(),
        window.curationist.getVideoState(),
        window.curationist.getPresetState(),
        window.curationist.getLogsSnapshot(),
        window.curationist.getObsConnectionState()
      ])
      setSettings(s)
      setMusicState(m)
      setVideoState(v)
      setPresetState(p)
      setLogEntries(logs.entries)
      setLogFilePath(logs.logFilePath)
      setObsConnection(obsConn)
      if (s.showSetupWizardOnStartup !== false || !s.setupWizardCompleted) {
        setShowSetupWizard(true)
      }
    }
    void loadAll()

    const unsubscribeMenu = window.curationist.onOpenPreferencesMenu(() => {
      setShowPreferences(true)
    })
    const unsubscribeLogToggle = window.curationist.onToggleOutputLogMenu(() => {
      setShowOutputLog((prev) => !prev)
    })
    const unsubscribePresetState = window.curationist.onPresetStateChanged((nextPresetState) => {
      setPresetState(nextPresetState)
      setStatusMessage('Preset library updated from milkLab Preset IDE')
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
      unsubscribePresetState()
      unsubscribeLogEntry()
    }
  }, [])

  const handleNewPresetInMilkLab = useCallback(async () => {
    if (milkLabActionRef.current) {
      milkLabActionRef.current.openNew()
      return
    }
    try {
      const res = await window.curationist.openMilkLab({ mode: 'new' })
      notify(res.message)
    } catch (err: any) {
      notify(`milkLab error: ${err?.message || String(err)}`)
    }
  }, [notify])

  const handleEditSelectedPresetInMilkLab = useCallback(async () => {
    if (milkLabActionRef.current) {
      milkLabActionRef.current.openEditSelected()
      return
    }
    const firstId = presetState?.presets[0]?.id
    if (!firstId) {
      notify('Select a preset in the Preset Workspace to edit in milkLab')
      return
    }
    try {
      const res = await window.curationist.openMilkLab({
        mode: 'edit',
        presetId: firstId
      })
      notify(res.message)
    } catch (err: any) {
      notify(`milkLab error: ${err?.message || String(err)}`)
    }
  }, [presetState?.presets, notify])

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
        setWorkspace('video')
      } else if ((e.ctrlKey || e.metaKey) && e.key === '3') {
        e.preventDefault()
        setWorkspace('presets')
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.key.toLowerCase() === 'j')) {
        e.preventDefault()
        setShowOutputLog((prev) => !prev)
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'n' &&
        !(e.target as HTMLElement)?.closest('input, textarea, select')
      ) {
        e.preventDefault()
        void handleNewPresetInMilkLab()
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'e' &&
        !(e.target as HTMLElement)?.closest('input, textarea, select')
      ) {
        e.preventDefault()
        void handleEditSelectedPresetInMilkLab()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleNewPresetInMilkLab, handleEditSelectedPresetInMilkLab])

  // Persistent OBS WebSocket auto-connect & 3-second source endpoint polling
  useEffect(() => {
    if (!settings || settings.obsPersistentConnect === false) return
    let disposed = false
    let busyPolling = false

    const pollConnection = async () => {
      if (disposed || busyPolling) return
      busyPolling = true
      try {
        const cur = await window.curationist.getObsConnectionState()
        if (disposed) return
        if (!cur.connected) {
          const connected = await window.curationist.connectObs(
            settings.obsWebsocketUrl || 'ws://127.0.0.1:4455',
            settings.obsWebsocketPassword || ''
          )
          if (!disposed) {
            setObsConnection(connected)
            const nextSettings = await window.curationist.getSettings()
            if (!disposed) setSettings(nextSettings)
          }
        } else {
          await window.curationist.refreshObsSources()
          const refreshed = await window.curationist.getObsConnectionState()
          if (!disposed) {
            setObsConnection((prev) => {
              const prevSig = `${prev.connected}:${prev.endpoint}:${prev.sources.map((s) => `${s.sourceId}:${s.name}:${s.kind}`).join('|')}`
              const nextSig = `${refreshed.connected}:${refreshed.endpoint}:${refreshed.sources.map((s) => `${s.sourceId}:${s.name}:${s.kind}`).join('|')}`
              return prevSig === nextSig ? prev : refreshed
            })
          }
        }
      } catch {
        // Silent retry on next poll interval when OBS is closed or unreachable
        try {
          const fallback = await window.curationist.getObsConnectionState()
          if (!disposed) {
            setObsConnection((prev) => (prev.connected !== fallback.connected ? fallback : prev))
          }
        } catch {
          // ignore
        }
      } finally {
        busyPolling = false
      }
    }

    void pollConnection()
    const timer = setInterval(() => {
      void pollConnection()
    }, 3000)

    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [
    settings?.obsPersistentConnect,
    settings?.obsWebsocketUrl,
    settings?.obsWebsocketPassword
  ])

  const ensureObsConnectedForToggle = useCallback(
    async (label: string) => {
      if (obsConnection.connected) return true
      try {
        const next = await window.curationist.connectObs(
          settings?.obsWebsocketUrl || 'ws://127.0.0.1:4455',
          settings?.obsWebsocketPassword || ''
        )
        setObsConnection(next)
        const nextSettings = await window.curationist.getSettings()
        setSettings(nextSettings)
        notify(`OB Remote Active (${label}) — Connected to OBS WebSocket`)
        return true
      } catch {
        notify(
          `OB Remote Enabled (${label}) — OBS WebSocket not connected yet (configure in Preferences -> OBS Integration)`
        )
        return false
      }
    },
    [obsConnection.connected, settings?.obsWebsocketUrl, settings?.obsWebsocketPassword, notify]
  )

  const handleToggleObsAudioMode = useCallback(() => {
    setObsAudioMode((prev) => {
      const next = !prev
      if (next) {
        void ensureObsConnectedForToggle('Curationist Audio')
      } else {
        notify('OB Audio Remote OFF — Shuttle controls returned to local preview')
      }
      return next
    })
  }, [ensureObsConnectedForToggle, notify])

  const handleToggleObsClipMode = useCallback(() => {
    setObsClipMode((prev) => {
      const next = !prev
      if (next) {
        void ensureObsConnectedForToggle('Curationist Video')
      } else {
        notify('OB Video Remote OFF — Video shuttle controls returned to local preview')
      }
      return next
    })
  }, [ensureObsConnectedForToggle, notify])

  const handleToggleObsVideoMode = useCallback(() => {
    setObsVideoMode((prev) => {
      const next = !prev
      if (next) {
        void ensureObsConnectedForToggle('Curationist Visualizer')
      } else {
        notify('OB Visualizer Remote OFF — Preset shuttle controls returned to local projectM preview')
      }
      return next
    })
  }, [ensureObsConnectedForToggle, notify])

  const handleSetAllObsModes = useCallback(
    (enabled: boolean) => {
      setObsAudioMode(enabled)
      setObsClipMode(enabled)
      setObsVideoMode(enabled)
      if (enabled) {
        void ensureObsConnectedForToggle('All 3 OBS Plugins')
        notify('Master OB Toggle ON — Audio, Video & Visualizer linked to OBS')
      } else {
        notify('Master OB Toggle OFF — All 3 plugins returned to local preview')
      }
    },
    [ensureObsConnectedForToggle, notify]
  )

  const [focusTrackRequest, setFocusTrackRequest] = useState<{
    trackId?: string
    title?: string
    artist?: string
    nonce: number
  } | null>(null)

  const handleFocusTrackInLibrary = useCallback(
    (target: { trackId?: string; title?: string; artist?: string }) => {
      setWorkspace('music')
      setFocusTrackRequest({ ...target, nonce: Date.now() })
    },
    []
  )

  const logCounts = useMemo(() => {
    let warn = 0
    let error = 0
    for (const e of logEntries) {
      if (e.level === 'warn') warn++
      else if (e.level === 'error') error++
    }
    return { total: logEntries.length, warn, error }
  }, [logEntries])

  const handlePlayTrack = (
    track: Mp3Track,
    queue?: Mp3Track[],
    mode: 'play_now' | 'play_next' | 'append' = 'play_now'
  ) => {
    if (obsAudioMode) {
      const obsQueue = queue && queue.length > 0 ? queue : [track]
      let targetTracks = obsQueue
      if (mode === 'play_now') {
        const idx = obsQueue.findIndex(
          (t) => t.id === track.id || t.filePath === track.filePath
        )
        targetTracks =
          idx >= 0
            ? obsQueue.slice(idx).concat(obsQueue.slice(0, idx))
            : [track]
      }
      const targetSourceId =
        settings?.selectedObsAudioSourceId ||
        obsConnection.sources.find((s) => s.kind === 'audio')?.sourceId

      void window.curationist
        .publishObsAudioQueue({
          sourceId: targetSourceId,
          trackIds: targetTracks.map((t) => t.id || t.filePath),
          mode
        })
        .then(() => {
          if (mode === 'play_now') {
            notify(
              obsConnection.connected
                ? `Playing "${track.title || track.filename}" now in OBS Curationist Audio (${targetTracks.length} in queue)`
                : `Published "${track.title || track.filename}" (${targetTracks.length} tracks) to OBS Curationist Audio queue`
            )
          } else if (mode === 'play_next') {
            notify(
              `Staged ${targetTracks.length} track(s) to play next in OBS Curationist Audio (current track uninterrupted)`
            )
          } else {
            notify(
              `Added ${targetTracks.length} track(s) to end of OBS Curationist Audio live queue (current track uninterrupted)`
            )
          }
        })
        .catch((err: any) => {
          notify(`OBS Audio broadcast error: ${err?.message || String(err)}`)
        })
      return
    }

    const incoming = queue && queue.length > 0 ? queue : [track]
    if (mode === 'play_next') {
      if (!currentTrack) {
        setCurrentTrack(incoming[0])
        setPlayQueue(incoming)
      } else {
        setPlayQueue((prev) => {
          const idx = prev.findIndex((t) => t.id === currentTrack.id)
          const insertAt = idx >= 0 ? idx + 1 : 1
          const next = [...prev]
          next.splice(insertAt, 0, ...incoming)
          return next
        })
      }
      notify(`Staged ${incoming.length} track(s) to play next in local preview queue`)
      return
    }
    if (mode === 'append') {
      if (!currentTrack) {
        setCurrentTrack(incoming[0])
        setPlayQueue(incoming)
      } else {
        setPlayQueue((prev) => [...prev, ...incoming])
      }
      notify(`Added ${incoming.length} track(s) to end of local preview queue`)
      return
    }

    const effectiveQueue =
      queue && queue.length > 0 ? queue : musicState?.tracks || [track]
    setCurrentTrack(track)
    setPlayQueue(effectiveQueue)
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
        `Published active audio playlist to saved-playlists.json & OBS Curationist Audio`
      )
    } catch (err: any) {
      notify(`Publish error: ${err?.message || String(err)}`)
    }
  }

  const handlePublishVideos = async () => {
    try {
      const res = await window.curationist.publishVideoPlaylists()
      setVideoState(res.state)
      setStatusMessage(
        `Published video playlist "${res.playlistName}" (${res.itemCount} videos) to OBS Curationist Video`
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
        `Published ${res.libraryPresetsWritten} library presets, ${res.playlistItemsWritten} playlist.dat items & Curationist Visualizer`
      )
    } catch (err: any) {
      notify(`Publish error: ${err?.message || String(err)}`)
    }
  }

  if (!settings || !musicState || !videoState || !presetState) {
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
        onOpenSetupWizard={() => setShowSetupWizard(true)}
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
        onNewPresetInMilkLab={() => void handleNewPresetInMilkLab()}
        onEditSelectedPresetInMilkLab={() => void handleEditSelectedPresetInMilkLab()}
        canEditSelectedPreset={presetState.presets.length > 0}
      />

      <div className="workbench">
        <ActivityBar
          workspace={workspace}
          onSelectWorkspace={setWorkspace}
          onOpenPreferences={() => setShowPreferences(true)}
          musicModified={musicState.isModified}
          videoModified={videoState.isModified}
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
            focusTrackRequest={focusTrackRequest}
            onNotify={notify}
            layoutResetCounter={layoutResetCounter}
            onPanelsChange={setMusicPanels}
            panelActionRef={musicActionRef}
          />
        ) : workspace === 'video' ? (
          <VideoWorkspace
            state={videoState}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onStateChange={setVideoState}
            onNotify={notify}
            layoutResetCounter={layoutResetCounter}
            onPanelsChange={setVideoPanels}
            panelActionRef={videoActionRef}
            obsClipMode={obsClipMode}
            onToggleObsClipMode={handleToggleObsClipMode}
            obsConnection={obsConnection}
            selectedObsClipSourceId={settings.selectedObsClipSourceId || ''}
            onSelectObsClipSourceId={(id) => {
              void handleUpdateSettings({ selectedObsClipSourceId: id })
            }}
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
            milkLabActionRef={milkLabActionRef}
            obsVideoMode={obsVideoMode}
            onToggleObsVideoMode={handleToggleObsVideoMode}
            obsConnection={obsConnection}
            selectedObsVideoSourceId={settings.selectedObsVideoSourceId || ''}
            onSelectObsVideoSourceId={(id) => {
              void handleUpdateSettings({ selectedObsVideoSourceId: id })
            }}
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
        videoState={videoState}
        presetState={presetState}
        onPrevTrack={() => handleStepTrack(-1)}
        onNextTrack={() => handleStepTrack(1)}
        onFocusTrackInLibrary={handleFocusTrackInLibrary}
        obsAudioMode={obsAudioMode}
        onToggleObsAudioMode={handleToggleObsAudioMode}
        obsClipMode={obsClipMode}
        onToggleObsClipMode={handleToggleObsClipMode}
        obsVideoMode={obsVideoMode}
        onToggleObsVideoMode={handleToggleObsVideoMode}
        onSetAllObsModes={handleSetAllObsModes}
        obsConnection={obsConnection}
        selectedObsAudioSourceId={settings.selectedObsAudioSourceId || ''}
        onSelectObsAudioSourceId={(id) => {
          void handleUpdateSettings({ selectedObsAudioSourceId: id })
        }}
        selectedObsClipSourceId={settings.selectedObsClipSourceId || ''}
        onSelectObsClipSourceId={(id) => {
          void handleUpdateSettings({ selectedObsClipSourceId: id })
        }}
        selectedObsVideoSourceId={settings.selectedObsVideoSourceId || ''}
        onSelectObsVideoSourceId={(id) => {
          void handleUpdateSettings({ selectedObsVideoSourceId: id })
        }}
        onNotify={notify}
      />

      <StatusBar
        workspace={workspace}
        musicState={musicState}
        videoState={videoState}
        presetState={presetState}
        statusMessage={statusMessage}
        showOutputLog={showOutputLog}
        onToggleOutputLog={() => setShowOutputLog((prev) => !prev)}
        logTotalCount={logCounts.total}
        logWarnCount={logCounts.warn}
        logErrorCount={logCounts.error}
        onPublishMusic={handlePublishMusic}
        onPublishVideos={handlePublishVideos}
        onPublishPresets={handlePublishPresets}
      />

      {showPreferences && (
        <PreferencesModal
          settings={settings}
          obsConnection={obsConnection}
          onObsConnectionChange={setObsConnection}
          onOpenSetupWizard={() => {
            setShowPreferences(false)
            setShowSetupWizard(true)
          }}
          onNotify={notify}
          onClose={() => setShowPreferences(false)}
          onSave={async (updated) => {
            const nextSettings = await window.curationist.updateSettings(updated)
            setSettings(nextSettings)
            const [m, v, p] = await Promise.all([
              window.curationist.getMusicState(),
              window.curationist.getVideoState(),
              window.curationist.getPresetState()
            ])
            setMusicState(m)
            setVideoState(v)
            setPresetState(p)
            setStatusMessage('Saved Preferences')
          }}
        />
      )}

      {showSetupWizard && (
        <SetupWizardModal
          settings={settings}
          obsConnection={obsConnection}
          onObsConnectionChange={setObsConnection}
          onUpdateSettings={handleUpdateSettings}
          onNotify={notify}
          onClose={() => setShowSetupWizard(false)}
        />
      )}
    </div>
  )
}
