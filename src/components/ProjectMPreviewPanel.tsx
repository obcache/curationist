import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  Clock,
  ListVideo,
  Lock,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Unlock,
  WifiOff
} from 'lucide-react'
import { ObsLedToggle, ObsVideoSettingsModal } from './ObsSourceSettingsModal'
import type { ObsConnectionState, ObsQueue, ObsStatus } from '../types'

interface ProjectMPreviewPanelProps {
  activePresetPath?: string | null
  activePresetLabel?: string | null
  previewNonce?: number
  onPrevPreset?: () => void
  onNextPreset?: () => void
  hasPrevPreset?: boolean
  hasNextPreset?: boolean
  isCollapsed?: boolean
  onNotify?: (msg: string) => void
  isPlaylistPlaying?: boolean
  playingPlaylistName?: string | null
  presetDurationSec?: number
  onChangePresetDurationSec?: (sec: number) => void
  onTogglePlaylistPlay?: () => void
  obsVideoMode?: boolean
  onToggleObsVideoMode?: () => void
  obsConnection?: ObsConnectionState
  selectedObsVideoSourceId?: string
  onSelectObsVideoSourceId?: (id: string) => void
}

export const ProjectMPreviewPanel: React.FC<ProjectMPreviewPanelProps> = ({
  activePresetPath,
  activePresetLabel,
  previewNonce = 0,
  onPrevPreset,
  onNextPreset,
  hasPrevPreset = false,
  hasNextPreset = false,
  isCollapsed = false,
  onNotify,
  isPlaylistPlaying = false,
  playingPlaylistName = null,
  presetDurationSec = 15,
  onChangePresetDurationSec,
  onTogglePlaylistPlay,
  obsVideoMode = false,
  onToggleObsVideoMode,
  obsConnection,
  selectedObsVideoSourceId = '',
  onSelectObsVideoSourceId
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const unmountedRef = useRef(false)

  const activePresetPathRef = useRef<string | null>(activePresetPath ?? null)
  activePresetPathRef.current = activePresetPath ?? null

  const activePresetLabelRef = useRef<string | null>(activePresetLabel ?? null)
  activePresetLabelRef.current = activePresetLabel ?? null

  const [connected, setConnected] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)
  const [isLocked, setIsLocked] = useState(true)
  const [smoothTransition, setSmoothTransition] = useState(false)
  const [currentFps, setCurrentFps] = useState<number>(30)
  const [currentResolution, setCurrentResolution] = useState<{ w: number; h: number }>({
    w: 400,
    h: 300
  })
  const [presetName, setPresetName] = useState<string>(activePresetLabel || '(Ready)')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [frameCounter, setFrameCounter] = useState(0)

  const [obsStatus, setObsStatus] = useState<ObsStatus | null>(null)
  const [obsQueue, setObsQueue] = useState<ObsQueue | null>(null)
  const [showObsVideoSettings, setShowObsVideoSettings] = useState(false)

  const videoSources = obsConnection?.sources.filter((s) => s.kind === 'video') || []
  const activeObsVideoSourceId =
    selectedObsVideoSourceId &&
    (videoSources.length === 0 || videoSources.some((s) => s.sourceId === selectedObsVideoSourceId))
      ? selectedObsVideoSourceId
      : videoSources[0]?.sourceId || ''

  // Poll OBS milkyWay Video source when OB LED is ON and connected
  useEffect(() => {
    if (!obsVideoMode || !obsConnection?.connected || !activeObsVideoSourceId) {
      setObsStatus(null)
      setObsQueue(null)
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
        // ignore
      } finally {
        if (!disposed) {
          timer = setTimeout(() => {
            void poll()
          }, 350)
        }
      }
    }

    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [obsVideoMode, obsConnection?.connected, activeObsVideoSourceId])

  const sendObsVideoCommand = async (
    action: 'play' | 'pause' | 'stop' | 'restart' | 'next' | 'previous'
  ) => {
    if (!obsConnection?.connected) {
      onNotify?.('OBS WebSocket is not connected. Open Preferences -> OBS Integration to connect.')
      return
    }
    if (!activeObsVideoSourceId) {
      onNotify?.('No Curationist Visualizer source found in OBS. Add a "Curationist Visualizer" source in OBS first.')
      return
    }
    try {
      const st = await window.curationist.controlObsSource({
        sourceId: activeObsVideoSourceId,
        action
      })
      setObsStatus(st)
    } catch (err: any) {
      onNotify?.(`OBS Visualizer control error: ${err?.message || String(err)}`)
    }
  }

  const lastSentPathRef = useRef<string | null>(null)
  const obsMirroredPathRef = useRef<string | null>(null)

  const sendCommand = useCallback((cmd: Record<string, any>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd))
    }
  }, [])

  // Persistent WebSocket connection — does NOT depend on activePresetPath so switching
  // presets never disconnects or spawns duplicate reconnect loops!
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
        reconnectTimerRef.current = setTimeout(connectWebSocket, 2000)
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
        setConnected(true)
        const currentPath = obsMirroredPathRef.current || activePresetPathRef.current
        if (currentPath) {
          ws.send(JSON.stringify({ type: 'load', path: currentPath }))
          ws.send(JSON.stringify({ type: 'play' }))
          lastSentPathRef.current = currentPath
          if (activePresetLabelRef.current) {
            setPresetName(activePresetLabelRef.current)
          }
        }
      }

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'status') {
              if (data.preset && !activePresetLabelRef.current) setPresetName(data.preset)
              if (data.isPlaying !== undefined) setIsPlaying(data.isPlaying)
              if (data.fps) setCurrentFps(data.fps)
            } else if (data.type === 'presetChanged') {
              if (activePresetLabelRef.current) {
                setPresetName(activePresetLabelRef.current)
              } else if (data.preset) {
                setPresetName(data.preset)
              }
            }
          } catch {
            // ignore
          }
          return
        }

        // Binary frame payload
        if (event.data instanceof ArrayBuffer) {
          const buf = event.data
          if (buf.byteLength < 18) return

          const view = new DataView(buf)
          // Magic check: 'P','M','4','F'
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
          const fps = view.getFloat32(12, true)
          const nameLen = view.getUint16(16, true)

          if (nameLen > 0 && buf.byteLength >= 18 + nameLen && !activePresetLabelRef.current) {
            const nameBytes = new Uint8Array(buf, 18, nameLen)
            const decodedName = new TextDecoder('utf-8').decode(nameBytes)
            if (decodedName && decodedName !== '(None)') {
              setPresetName(decodedName)
            }
          }

          setCurrentFps(Math.round(fps * 10) / 10)
          setCurrentResolution({ w, h })
          setFrameCounter((c) => (c + 1) % 1000)

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
        }
      }

      ws.onclose = () => {
        if (wsRef.current !== ws) return
        setConnected(false)
        wsRef.current = null
        if (!unmountedRef.current) {
          reconnectTimerRef.current = setTimeout(connectWebSocket, 1500)
        }
      }

      ws.onerror = () => {
        if (wsRef.current !== ws) return
        setConnected(false)
      }
    } catch {
      if (!unmountedRef.current) {
        reconnectTimerRef.current = setTimeout(connectWebSocket, 2000)
      }
    }
  }, [])

  useEffect(() => {
    unmountedRef.current = false
    connectWebSocket()
    return () => {
      unmountedRef.current = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        const ws = wsRef.current
        wsRef.current = null
        ws.close()
      }
    }
  }, [connectWebSocket])

  // Load new preset when local path or previewNonce changes (or when returning from OBS mode to local mode)
  useEffect(() => {
    if (!obsVideoMode) {
      obsMirroredPathRef.current = null
      if (activePresetPath) {
        lastSentPathRef.current = activePresetPath
        sendCommand({ type: 'load', path: activePresetPath })
        if (!isCollapsed) {
          setIsPlaying(true)
          sendCommand({ type: 'play' })
        }
        if (activePresetLabel) {
          setPresetName(activePresetLabel)
        }
      }
    } else if (activePresetPath && !obsQueue?.current?.asset) {
      // Optimistically load the clicked preset immediately while waiting for OBS status poll
      lastSentPathRef.current = activePresetPath
      sendCommand({ type: 'load', path: activePresetPath })
      if (!isCollapsed) {
        sendCommand({ type: 'play' })
      }
      if (activePresetLabel) {
        setPresetName(activePresetLabel)
      }
    }
  }, [activePresetPath, activePresetLabel, previewNonce, obsVideoMode, isCollapsed, sendCommand])

  // When OB Remote LED is ON, mirror the active preset playing in OBS Curationist Visualizer
  const obsCurrentAsset = obsQueue?.current?.asset || obsQueue?.stopped?.asset || ''
  useEffect(() => {
    if (!obsVideoMode || !obsCurrentAsset) return
    let cancelled = false
    void window.curationist
      .resolveObsPublishedAssetPath(obsCurrentAsset)
      .then((resolvedPath) => {
        if (cancelled || !resolvedPath) return
        obsMirroredPathRef.current = resolvedPath
        if (lastSentPathRef.current !== resolvedPath) {
          lastSentPathRef.current = resolvedPath
          sendCommand({ type: 'load', path: resolvedPath })
          if (!isCollapsed) {
            sendCommand({ type: 'play' })
          }
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [obsVideoMode, obsCurrentAsset, isCollapsed, sendCommand])

  // Pause when collapsed to save GPU cycles, resume when expanded
  useEffect(() => {
    if (isCollapsed) {
      sendCommand({ type: 'pause' })
    } else if (isPlaying) {
      sendCommand({ type: 'play' })
    }
  }, [isCollapsed, isPlaying, sendCommand])

  // Auto-resize renderer when container size changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let timeoutId: NodeJS.Timeout
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width < 80 || height < 60) return

        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          const targetW = Math.max(160, Math.min(1280, Math.round(width / 2) * 2))
          const targetH = Math.max(120, Math.min(960, Math.round(height / 2) * 2))
          sendCommand({ type: 'resize', width: targetW, height: targetH })
        }, 120)
      }
    })

    observer.observe(container)
    return () => {
      observer.disconnect()
      clearTimeout(timeoutId)
    }
  }, [sendCommand])

  const handleTogglePlay = () => {
    if (obsVideoMode) {
      const nextAction = obsStatus?.state === 'playing' ? 'pause' : 'play'
      void sendObsVideoCommand(nextAction)
      return
    }
    const next = !isPlaying
    setIsPlaying(next)
    sendCommand({ type: next ? 'play' : 'pause' })
    onNotify?.(next ? 'projectM visualizer resumed' : 'projectM visualizer paused')
  }

  const handlePrev = () => {
    if (obsVideoMode) {
      void sendObsVideoCommand('previous')
      return
    }
    onPrevPreset?.()
  }

  const handleNext = () => {
    if (obsVideoMode) {
      void sendObsVideoCommand('next')
      return
    }
    onNextPreset?.()
  }

  const handleSetPlayToggle = () => {
    if (obsVideoMode) {
      const nextAction = obsStatus?.state === 'playing' ? 'pause' : 'play'
      void sendObsVideoCommand(nextAction)
      return
    }
    onTogglePlaylistPlay?.()
  }

  const obsActivePresetTitle = obsQueue?.current?.title || obsQueue?.stopped?.title || null
  const displayedPresetName =
    obsVideoMode && obsActivePresetTitle
      ? `OBS: ${obsActivePresetTitle}`
      : presetName
  const effectiveIsPlaying = obsVideoMode ? obsStatus?.state === 'playing' : isPlaying

  const handleToggleLock = () => {
    const next = !isLocked
    setIsLocked(next)
    sendCommand({ type: 'lock', locked: next })
    onNotify?.(next ? 'Preset locked (manual/playlist transitions only)' : 'Preset unlocked')
  }

  const handleToggleSmooth = () => {
    const next = !smoothTransition
    setSmoothTransition(next)
    sendCommand({ type: 'transition', smooth: next })
    onNotify?.(next ? 'Smooth crossfade transitions enabled' : 'Instant cut transitions enabled')
  }

  return (
    <div
      ref={containerRef}
      className={`projectm-preview-container ${isFullscreen ? 'fullscreen' : ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 140,
        background: '#0a0a0c',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Live Visualizer Canvas */}
      <div
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: connected ? 'block' : 'none',
            imageRendering: 'auto'
          }}
        />

        {!connected && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              color: '#8b949e',
              fontSize: 12,
              padding: 16,
              textAlign: 'center'
            }}
          >
            <WifiOff size={22} color="#f14c4c" />
            <span>Connecting to in-app projectM engine...</span>
          </div>
        )}

        {connected && frameCounter === 0 && !activePresetPath && (
          <div
            style={{
              position: 'absolute',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              color: '#8b949e',
              fontSize: 12,
              padding: 14,
              textAlign: 'center',
              pointerEvents: 'none'
            }}
          >
            <Sparkles size={24} color="#0078d4" />
            <span>Click any preset in the library or playlist to preview live</span>
          </div>
        )}

        {/* Top HUD Overlay Banner */}
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 8,
            right: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(15, 17, 24, 0.82)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 4,
              padding: '2px 8px',
              backdropFilter: 'blur(4px)',
              maxWidth: '72%',
              overflow: 'hidden'
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: connected ? (isPlaying ? '#4ec9b0' : '#e5c07b') : '#f14c4c',
                boxShadow: connected && isPlaying ? '0 0 6px #4ec9b0' : 'none',
                flexShrink: 0
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#e6edf3',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={displayedPresetName}
            >
              {displayedPresetName}
            </span>
            {obsVideoMode && (
              <span
                className="badge synced"
                style={{ fontSize: 9.5, padding: '0 5px', flexShrink: 0 }}
              >
                OBS {(obsStatus?.state || 'IDLE').toUpperCase()}
              </span>
            )}
            {!obsVideoMode && isPlaylistPlaying && playingPlaylistName && (
              <span
                className="badge synced"
                style={{ fontSize: 9.5, padding: '0 5px', flexShrink: 0 }}
              >
                {playingPlaylistName}
              </span>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(15, 17, 24, 0.82)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: '#9cdcfe',
              backdropFilter: 'blur(4px)'
            }}
          >
            <span>{currentFps} FPS</span>
            <span style={{ color: '#6e7681' }}>•</span>
            <span>
              {currentResolution.w}×{currentResolution.h}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Interactive Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          flexWrap: 'wrap',
          padding: '4px 8px',
          background: 'var(--vscode-bg-panel)',
          borderTop: '1px solid var(--vscode-border)',
          fontSize: 11
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {onToggleObsVideoMode && (
            <ObsLedToggle
              active={obsVideoMode}
              connected={Boolean(obsConnection?.connected)}
              kind="video"
              onToggle={onToggleObsVideoMode}
              onOpenSettings={() => setShowObsVideoSettings(true)}
            />
          )}

          <button
            className="icon-btn"
            disabled={obsVideoMode ? !obsConnection?.connected : !hasPrevPreset}
            onClick={handlePrev}
            title={obsVideoMode ? 'Previous Preset in OBS' : 'Previous Preset in Playlist'}
          >
            <SkipBack size={12} />
          </button>
          <button
            className="icon-btn accent"
            onClick={handleTogglePlay}
            title={
              obsVideoMode
                ? effectiveIsPlaying
                  ? 'Pause OBS Preset Visualizer'
                  : 'Play OBS Preset Visualizer'
                : effectiveIsPlaying
                  ? 'Pause Visualizer Rendering'
                  : 'Resume Visualizer Rendering'
            }
          >
            {effectiveIsPlaying ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            className="icon-btn"
            disabled={obsVideoMode ? !obsConnection?.connected : !hasNextPreset}
            onClick={handleNext}
            title={obsVideoMode ? 'Next Preset in OBS' : 'Next Preset in Playlist'}
          >
            <SkipForward size={12} />
          </button>

          {onTogglePlaylistPlay && (
            <button
              className={`vscode-btn ${
                (obsVideoMode ? effectiveIsPlaying : isPlaylistPlaying) ? 'primary' : ''
              }`}
              style={{ height: 20, padding: '0 6px', fontSize: 10.5, marginLeft: 2 }}
              onClick={handleSetPlayToggle}
              title={
                obsVideoMode
                  ? 'Play or Pause Preset Queue in OBS'
                  : isPlaylistPlaying
                    ? 'Stop Auto-Playing Preset Playlist'
                    : 'Auto-Play Selected Preset Playlist'
              }
            >
              {(obsVideoMode ? effectiveIsPlaying : isPlaylistPlaying) ? (
                <Square size={10} />
              ) : (
                <ListVideo size={11} />
              )}
              <span>
                {(obsVideoMode ? effectiveIsPlaying : isPlaylistPlaying)
                  ? 'Stop Set'
                  : 'Play Set'}
              </span>
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {onChangePresetDurationSec && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 3 }}
              title="How many seconds each preset plays before advancing to the next preset in the playlist"
            >
              <Clock size={11} color="#9cdcfe" />
              <input
                type="number"
                min={3}
                max={600}
                value={presetDurationSec}
                onChange={(e) => {
                  const val = Math.max(3, Math.min(600, Number(e.target.value) || 15))
                  onChangePresetDurationSec(val)
                  if (obsVideoMode && obsConnection?.connected && activeObsVideoSourceId) {
                    void window.curationist
                      .setObsPresetTiming(
                        activeObsVideoSourceId,
                        val * 1000,
                        obsStatus?.autoAdvance ?? true
                      )
                      .then(setObsStatus)
                      .catch(() => {})
                  }
                }}
                className="vscode-input"
                style={{ width: 44, height: 20, padding: '0 4px', fontSize: 10.5, textAlign: 'center' }}
              />
              <span style={{ fontSize: 10, color: '#9da5b4' }}>s</span>
            </div>
          )}

          <button
            className={`icon-btn ${isLocked ? 'accent' : ''}`}
            onClick={handleToggleLock}
            title={isLocked ? 'Preset is locked (click to unlock)' : 'Lock current preset'}
          >
            {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <button
            className={`icon-btn ${smoothTransition ? 'accent' : ''}`}
            onClick={handleToggleSmooth}
            title={
              smoothTransition
                ? 'Smooth crossfade transitions (Active)'
                : 'Instant cut transitions (Active)'
            }
          >
            <Sparkles size={12} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setIsFullscreen((prev) => !prev)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Preview'}
          >
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      {showObsVideoSettings && obsConnection && (
        <ObsVideoSettingsModal
          sourceId={activeObsVideoSourceId}
          sources={obsConnection.sources}
          onSelectSourceId={(id) => onSelectObsVideoSourceId?.(id)}
          onClose={() => setShowObsVideoSettings(false)}
          onNotify={(msg) => onNotify?.(msg)}
        />
      )}
    </div>
  )
}
