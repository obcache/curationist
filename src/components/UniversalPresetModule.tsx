import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  X
} from 'lucide-react'
import { DetachablePortal } from './DetachablePortal'
import { ObsLedToggle, ObsVideoSettingsModal } from './ObsSourceSettingsModal'
import type { ObsConnectionState, ObsQueue, ObsStatus, PresetWorkspaceState } from '../types'

interface UniversalPresetModuleProps {
  presetState: PresetWorkspaceState
  obsVideoMode: boolean
  onToggleObsVideoMode: () => void
  obsConnection: ObsConnectionState
  selectedObsVideoSourceId: string
  onSelectObsVideoSourceId: (id: string) => void
  onNotify: (msg: string) => void
  performanceMode?: boolean
}

export const UniversalPresetModule: React.FC<UniversalPresetModuleProps> = ({
  presetState,
  obsVideoMode,
  onToggleObsVideoMode,
  obsConnection,
  selectedObsVideoSourceId,
  onSelectObsVideoSourceId,
  onNotify,
  performanceMode = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmountedRef = useRef(false)
  const lastSentPathRef = useRef<string | null>(null)
  const popoutWinRef = useRef<Window | null>(null)

  const [wsConnected, setWsConnected] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const [obsStatus, setObsStatus] = useState<ObsStatus | null>(null)
  const [obsQueue, setObsQueue] = useState<ObsQueue | null>(null)
  const [obsMirroredPath, setObsMirroredPath] = useState<string | null>(null)
  const [localIndex, setLocalIndex] = useState(0)
  const [localPlaying, setLocalPlaying] = useState(true)
  const [detached, setDetached] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const videoSources = useMemo(
    () => obsConnection.sources.filter((s) => s.kind === 'video'),
    [obsConnection.sources]
  )
  const activeObsVideoSourceId =
    selectedObsVideoSourceId &&
    (videoSources.length === 0 || videoSources.some((s) => s.sourceId === selectedObsVideoSourceId))
      ? selectedObsVideoSourceId
      : videoSources[0]?.sourceId || ''

  const localPlaylistPresets = useMemo(() => {
    const activePl =
      presetState.playlists.find((p) => p.isActiveDat) || presetState.playlists[0] || null
    if (activePl && activePl.items && activePl.items.length > 0) {
      return activePl.items.map((it) => ({
        id: it.presetId || it.id,
        label: it.label,
        path: it.managedPath || it.originalPath
      }))
    }
    return presetState.presets.slice(0, 80).map((p) => ({
      id: p.id,
      label: p.label,
      path: p.managedPath || p.originalPath
    }))
  }, [presetState])

  const localPreset =
    localPlaylistPresets.length > 0
      ? localPlaylistPresets[
          ((localIndex % localPlaylistPresets.length) + localPlaylistPresets.length) %
            localPlaylistPresets.length
        ]
      : null

  // Poll OBS Curationist Visualizer when OB mode is ON
  useEffect(() => {
    if (!obsVideoMode || !obsConnection.connected || !activeObsVideoSourceId) {
      setObsStatus(null)
      setObsQueue(null)
      setObsMirroredPath(null)
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let signature = ''

    const poll = async () => {
      try {
        const st = await window.curationist.getObsSourceStatus(activeObsVideoSourceId)
        if (disposed) return
        setObsStatus(st)
        const sig = `${st.revision}:${st.playbackEpoch}:${st.remaining}:${st.state}`
        if (sig !== signature) {
          const q = await window.curationist.getObsSourceQueue(activeObsVideoSourceId)
          if (!disposed) {
            setObsQueue(q)
            signature = sig
          }
        }
      } catch {
        // ignore transient error
      } finally {
        if (!disposed) {
          timer = setTimeout(() => {
            void poll()
          }, 450)
        }
      }
    }

    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [obsVideoMode, obsConnection.connected, activeObsVideoSourceId])

  const obsCurrentItem = obsQueue?.current ?? obsQueue?.stopped ?? null

  // Resolve mirrored OBS .milk preset asset path
  useEffect(() => {
    if (!obsVideoMode || !obsCurrentItem?.asset) {
      setObsMirroredPath(null)
      return
    }
    let cancelled = false
    const resolveAsset = async () => {
      try {
        const abs = await window.curationist.resolveObsPublishedAssetPath(obsCurrentItem.asset)
        if (!cancelled && abs) {
          setObsMirroredPath(abs)
          return
        }
      } catch {
        // fallback below
      }
      const matched = presetState.presets.find(
        (p) => p.label.toLowerCase() === (obsCurrentItem.title || '').toLowerCase()
      )
      if (!cancelled) {
        setObsMirroredPath(matched ? matched.managedPath || matched.originalPath : null)
      }
    }
    void resolveAsset()
    return () => {
      cancelled = true
    }
  }, [obsVideoMode, obsCurrentItem?.asset, obsCurrentItem?.title, presetState.presets])

  const effectivePath = obsVideoMode ? obsMirroredPath : localPreset?.path || null
  const effectiveLabel = obsVideoMode
    ? obsCurrentItem?.title ||
      (obsConnection.connected ? 'OBS Visualizer (Idle)' : 'OBS Disconnected')
    : localPreset?.label || 'No Preset Loaded'
  const effectivePlaying = obsVideoMode ? obsStatus?.state === 'playing' : localPlaying

  const sendProjectMCmd = useCallback((cmd: Record<string, any>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd))
    }
  }, [])

  // Persistent projectM WebSocket stream receiver for live visualizer frames
  const connectWebSocket = useCallback(async () => {
    if (unmountedRef.current) return
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    try {
      const port = await window.curationist.getProjectMPort()
      if (unmountedRef.current) return
      if (!port) {
        reconnectTimerRef.current = setTimeout(() => void connectWebSocket(), 2500)
        return
      }
      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        if (wsRef.current !== ws) {
          ws.close()
          return
        }
        setWsConnected(true)
        if (effectivePath) {
          ws.send(JSON.stringify({ type: 'load', path: effectivePath }))
          ws.send(JSON.stringify({ type: 'play' }))
          lastSentPathRef.current = effectivePath
        }
      }

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return
        if (!(event.data instanceof ArrayBuffer)) return
        const buf = event.data
        if (buf.byteLength < 18) return
        const view = new DataView(buf)
        if (
          view.getUint8(0) !== 0x50 ||
          view.getUint8(1) !== 0x4d ||
          view.getUint8(2) !== 0x34 ||
          view.getUint8(3) !== 0x46
        ) {
          return
        }
        const w = view.getUint16(4, true)
        const h = view.getUint16(6, true)
        const nameLen = view.getUint16(16, true)
        const pixelOffset = 18 + nameLen
        const pixelByteLength = w * h * 4
        if (buf.byteLength < pixelOffset + pixelByteLength) return

        const canvas = canvasRef.current
        if (!canvas) return
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
        }
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) return
        const pixelData = new Uint8ClampedArray(buf, pixelOffset, pixelByteLength)
        const imgData = new ImageData(pixelData, w, h)
        ctx.putImageData(imgData, 0, 0)
        setHasFrame(true)
      }

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null
          setWsConnected(false)
          if (!unmountedRef.current) {
            reconnectTimerRef.current = setTimeout(() => void connectWebSocket(), 2500)
          }
        }
      }

      ws.onerror = () => {
        // handled by onclose
      }
    } catch {
      if (!unmountedRef.current) {
        reconnectTimerRef.current = setTimeout(() => void connectWebSocket(), 2500)
      }
    }
  }, [effectivePath])

  useEffect(() => {
    unmountedRef.current = false
    void connectWebSocket()
    return () => {
      unmountedRef.current = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  // Push preset path updates to projectM host whenever OBS/local active preset changes
  useEffect(() => {
    if (!wsConnected || !effectivePath) return
    if (lastSentPathRef.current !== effectivePath) {
      lastSentPathRef.current = effectivePath
      sendProjectMCmd({ type: 'load', path: effectivePath })
      if (effectivePlaying) {
        sendProjectMCmd({ type: 'play' })
      }
    }
  }, [wsConnected, effectivePath, effectivePlaying, sendProjectMCmd])

  const sendObsCommand = async (action: 'play' | 'pause' | 'next' | 'previous') => {
    if (!obsConnection.connected) {
      onNotify('OBS WebSocket is not connected. Open Preferences -> OBS Integration to connect.')
      return
    }
    if (!activeObsVideoSourceId) {
      onNotify('No Curationist Visualizer source found in OBS.')
      return
    }
    try {
      const next = await window.curationist.controlObsSource({
        sourceId: activeObsVideoSourceId,
        action
      })
      setObsStatus(next)
    } catch (err: any) {
      onNotify(`OBS Visualizer control error: ${err?.message || String(err)}`)
    }
  }

  const handlePrev = () => {
    if (obsVideoMode) {
      void sendObsCommand('previous')
      return
    }
    if (localPlaylistPresets.length > 0) {
      setLocalIndex((i) => (i - 1 + localPlaylistPresets.length) % localPlaylistPresets.length)
      setLocalPlaying(true)
    }
  }

  const handleTogglePlay = () => {
    if (obsVideoMode) {
      void sendObsCommand(obsStatus?.state === 'playing' ? 'pause' : 'play')
      return
    }
    const next = !localPlaying
    setLocalPlaying(next)
    sendProjectMCmd({ type: next ? 'play' : 'pause' })
  }

  const handleNext = () => {
    if (obsVideoMode) {
      void sendObsCommand('next')
      return
    }
    if (localPlaylistPresets.length > 0) {
      setLocalIndex((i) => (i + 1) % localPlaylistPresets.length)
      setLocalPlaying(true)
    }
  }

  const handleToggleMaximize = () => {
    if (detached && popoutWinRef.current && !popoutWinRef.current.closed) {
      const doc = popoutWinRef.current.document
      if (doc.fullscreenElement) {
        void doc.exitFullscreen().catch(() => {})
      } else {
        void doc.documentElement.requestFullscreen().catch(() => {})
      }
      return
    }
    setMaximized((m) => !m)
  }

  const renderSurface = (mode: 'compact' | 'expanded' | 'detached') => {
    const isLarge = mode !== 'compact'
    return (
      <div className={`ucs-preview-card preset ${mode}`}>
        <div className="ucs-preview-header">
          <div className="ucs-preview-label-group">
            <span className="ucs-layer-badge preset">PRESETS</span>
            <span className="ucs-preview-title" title={effectiveLabel}>
              {effectiveLabel}
            </span>
          </div>
          <div className="ucs-preview-win-actions">
            {obsVideoMode && (
              <span className={`ucs-state-pill ${obsStatus?.state === 'playing' ? 'live' : ''}`}>
                {(obsStatus?.state || 'IDLE').toUpperCase()}
              </span>
            )}
            <button
              type="button"
              className="ucs-mini-btn"
              onClick={handleToggleMaximize}
              title={maximized ? 'Restore Preset Preview' : 'Maximize Preset Preview'}
            >
              {maximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            </button>
            <button
              type="button"
              className={`ucs-mini-btn ${detached ? 'active' : ''}`}
              onClick={() => {
                setMaximized(false)
                setDetached((d) => !d)
              }}
              title={
                detached
                  ? 'Re-dock Preset Preview into Bottom Deck'
                  : 'Detach Preset Preview into Separate Window'
              }
            >
              {detached ? <X size={11} /> : <ExternalLink size={11} />}
            </button>
          </div>
        </div>

        <div
          className={`ucs-preview-viewport ${isLarge ? 'large' : ''}`}
          onDoubleClick={handleToggleMaximize}
          title="Double-click to maximize/restore Preset Visualizer Monitor"
        >
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: hasFrame ? 'block' : 'none'
            }}
          />
          {!hasFrame && (
            <div className="ucs-preview-empty">
              <Sparkles size={isLarge ? 26 : 15} color="#a855f7" />
              {isLarge && <span>{wsConnected ? 'Awaiting preset frame...' : 'Connecting projectM...'}</span>}
            </div>
          )}
        </div>

        <div className="ucs-preview-controls">
          <ObsLedToggle
            active={obsVideoMode}
            connected={obsConnection.connected}
            kind="video"
            onToggle={onToggleObsVideoMode}
            onOpenSettings={() => setShowSettings(true)}
          />
          <div className="ucs-transport-cluster">
            <button
              type="button"
              className="ucs-transport-btn"
              onClick={handlePrev}
              disabled={obsVideoMode ? !obsConnection.connected : localPlaylistPresets.length === 0}
              title={obsVideoMode ? 'Previous Preset in OBS' : 'Previous Local Preset'}
            >
              <SkipBack size={11} />
            </button>
            <button
              type="button"
              className={`ucs-transport-btn play ${effectivePlaying ? 'playing' : ''}`}
              onClick={handleTogglePlay}
              disabled={obsVideoMode ? !obsConnection.connected : !localPreset}
              title={effectivePlaying ? 'Pause Visualizer' : 'Play Visualizer'}
            >
              {effectivePlaying ? <Pause size={11} /> : <Play size={11} />}
            </button>
            <button
              type="button"
              className="ucs-transport-btn"
              onClick={handleNext}
              disabled={obsVideoMode ? !obsConnection.connected : localPlaylistPresets.length === 0}
              title={obsVideoMode ? 'Next Preset in OBS' : 'Next Local Preset'}
            >
              <SkipForward size={11} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {detached ? (
        <>
          <div
            className="ucs-detached-placeholder"
            onClick={() => setDetached(false)}
            title="Preset Preview is detached in its own window — click to re-dock"
          >
            <span className="ucs-layer-badge preset">PRESETS</span>
            <span className="ucs-detached-text">Detached Window</span>
            <ObsLedToggle
              active={obsVideoMode}
              connected={obsConnection.connected}
              kind="video"
              onToggle={onToggleObsVideoMode}
              onOpenSettings={() => setShowSettings(true)}
            />
          </div>
          <DetachablePortal
            name="preset-monitor"
            title={`Curationist Visualizer Monitor — ${effectiveLabel}`}
            width={680}
            height={440}
            onWindowReady={(w) => {
              popoutWinRef.current = w
            }}
            onClose={() => setDetached(false)}
          >
            {renderSurface('detached')}
          </DetachablePortal>
        </>
      ) : maximized ? (
        <>
          <div
            className="ucs-detached-placeholder"
            onClick={() => setMaximized(false)}
            title="Preset Preview is maximized — click to restore"
          >
            <span className="ucs-layer-badge preset">PRESETS</span>
            <span className="ucs-detached-text">Maximized</span>
          </div>
          <div className="ucs-maximized-overlay" onClick={() => setMaximized(false)}>
            <div className="ucs-maximized-stage" onClick={(e) => e.stopPropagation()}>
              {renderSurface('expanded')}
            </div>
          </div>
        </>
      ) : (
        renderSurface(performanceMode ? 'expanded' : 'compact')
      )}

      {showSettings && (
        <ObsVideoSettingsModal
          sourceId={activeObsVideoSourceId}
          sources={obsConnection.sources}
          onSelectSourceId={onSelectObsVideoSourceId}
          onClose={() => setShowSettings(false)}
          onNotify={onNotify}
        />
      )}
    </>
  )
}
