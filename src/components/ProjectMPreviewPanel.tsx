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

interface ProjectMPreviewPanelProps {
  activePresetPath?: string | null
  activePresetLabel?: string | null
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
}

export const ProjectMPreviewPanel: React.FC<ProjectMPreviewPanelProps> = ({
  activePresetPath,
  activePresetLabel,
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
  onTogglePlaylistPlay
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

  const lastSentPathRef = useRef<string | null>(null)

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
        const currentPath = activePresetPathRef.current
        if (currentPath) {
          ws.send(JSON.stringify({ type: 'load', path: currentPath }))
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

  // Load new preset when path changes
  useEffect(() => {
    if (activePresetPath) {
      lastSentPathRef.current = activePresetPath
      sendCommand({ type: 'load', path: activePresetPath })
      if (activePresetLabel) {
        setPresetName(activePresetLabel)
      }
    }
  }, [activePresetPath, activePresetLabel, sendCommand])

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
    const next = !isPlaying
    setIsPlaying(next)
    sendCommand({ type: next ? 'play' : 'pause' })
    onNotify?.(next ? 'projectM visualizer resumed' : 'projectM visualizer paused')
  }

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
              title={presetName}
            >
              {presetName}
            </span>
            {isPlaylistPlaying && playingPlaylistName && (
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            className="icon-btn"
            disabled={!hasPrevPreset}
            onClick={onPrevPreset}
            title="Previous Preset in Playlist"
          >
            <SkipBack size={12} />
          </button>
          <button
            className="icon-btn accent"
            onClick={handleTogglePlay}
            title={isPlaying ? 'Pause Visualizer Rendering' : 'Resume Visualizer Rendering'}
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            className="icon-btn"
            disabled={!hasNextPreset}
            onClick={onNextPreset}
            title="Next Preset in Playlist"
          >
            <SkipForward size={12} />
          </button>

          {onTogglePlaylistPlay && (
            <button
              className={`vscode-btn ${isPlaylistPlaying ? 'primary' : ''}`}
              style={{ height: 20, padding: '0 6px', fontSize: 10.5, marginLeft: 2 }}
              onClick={onTogglePlaylistPlay}
              title={
                isPlaylistPlaying
                  ? 'Stop Auto-Playing Preset Playlist'
                  : 'Auto-Play Selected Preset Playlist'
              }
            >
              {isPlaylistPlaying ? <Square size={10} /> : <ListVideo size={11} />}
              <span>{isPlaylistPlaying ? 'Stop Set' : 'Play Set'}</span>
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
    </div>
  )
}
