import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink,
  Film,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X
} from 'lucide-react'
import { DetachablePortal } from './DetachablePortal'
import { ObsClipSettingsModal, ObsLedToggle } from './ObsSourceSettingsModal'
import type { ObsConnectionState, ObsQueue, ObsStatus, VideoWorkspaceState } from '../types'

interface UniversalVideoModuleProps {
  videoState: VideoWorkspaceState
  obsClipMode: boolean
  onToggleObsClipMode: () => void
  obsConnection: ObsConnectionState
  selectedObsClipSourceId: string
  onSelectObsClipSourceId: (id: string) => void
  onNotify: (msg: string) => void
  performanceMode?: boolean
}

export const UniversalVideoModule: React.FC<UniversalVideoModuleProps> = ({
  videoState,
  obsClipMode,
  onToggleObsClipMode,
  obsConnection,
  selectedObsClipSourceId,
  onSelectObsClipSourceId,
  onNotify,
  performanceMode = false
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const popoutWinRef = useRef<Window | null>(null)

  const [obsStatus, setObsStatus] = useState<ObsStatus | null>(null)
  const [obsQueue, setObsQueue] = useState<ObsQueue | null>(null)
  const [obsMirroredPath, setObsMirroredPath] = useState<string | null>(null)
  const [localIndex, setLocalIndex] = useState(0)
  const [localPlaying, setLocalPlaying] = useState(false)
  const [detached, setDetached] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const clipSources = useMemo(
    () => obsConnection.sources.filter((s) => s.kind === 'clip'),
    [obsConnection.sources]
  )
  const activeObsClipSourceId =
    selectedObsClipSourceId &&
    (clipSources.length === 0 || clipSources.some((s) => s.sourceId === selectedObsClipSourceId))
      ? selectedObsClipSourceId
      : clipSources[0]?.sourceId || ''

  // Local fallback list from active OBS video playlist (or first playlist / library clips)
  const localPlaylistClips = useMemo(() => {
    const activePl =
      videoState.playlists.find((p) => p.isActive) || videoState.playlists[0] || null
    if (activePl && activePl.items && activePl.items.length > 0) {
      return activePl.items.map((it) => ({
        id: it.clipId || it.id,
        title: it.title,
        filePath: it.value
      }))
    }
    return videoState.clips.slice(0, 50).map((c) => ({
      id: c.id,
      title: c.title,
      filePath: c.filePath
    }))
  }, [videoState])

  const localClip =
    localPlaylistClips.length > 0
      ? localPlaylistClips[((localIndex % localPlaylistClips.length) + localPlaylistClips.length) % localPlaylistClips.length]
      : null

  // Poll OBS Curationist Video source when OB mode is ON & connected
  useEffect(() => {
    if (!obsClipMode || !obsConnection.connected || !activeObsClipSourceId) {
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
        const st = await window.curationist.getObsSourceStatus(activeObsClipSourceId)
        if (disposed) return
        setObsStatus(st)
        const sig = `${st.revision}:${st.playbackEpoch}:${st.remaining}:${st.state}`
        if (sig !== signature) {
          const q = await window.curationist.getObsSourceQueue(activeObsClipSourceId)
          if (!disposed) {
            setObsQueue(q)
            signature = sig
          }
        }
      } catch {
        // ignore transient poll error
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
  }, [obsClipMode, obsConnection.connected, activeObsClipSourceId])

  const obsCurrentItem = obsQueue?.current ?? obsQueue?.stopped ?? null

  // Resolve mirrored OBS asset path for live <video> preview
  useEffect(() => {
    if (!obsClipMode || !obsCurrentItem?.asset) {
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
      const matched = videoState.clips.find(
        (c) =>
          c.title.toLowerCase() === (obsCurrentItem.title || '').toLowerCase() ||
          c.filePath.toLowerCase() === obsCurrentItem.asset.toLowerCase()
      )
      if (!cancelled) {
        setObsMirroredPath(matched?.filePath || null)
      }
    }
    void resolveAsset()
    return () => {
      cancelled = true
    }
  }, [obsClipMode, obsCurrentItem?.asset, obsCurrentItem?.title, videoState.clips])

  const effectivePath = obsClipMode ? obsMirroredPath : localClip?.filePath || null
  const effectiveTitle = obsClipMode
    ? obsCurrentItem?.title ||
      (obsConnection.connected ? 'OBS Video (Idle)' : 'OBS Disconnected')
    : localClip?.title || 'No Video Selected'
  const effectivePlaying = obsClipMode ? obsStatus?.state === 'playing' : localPlaying

  // Keep <video> source synced
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    if (!effectivePath) {
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
      return
    }
    const nextUrl = `curationist-media://local?path=${encodeURIComponent(effectivePath)}`
    if (vid.dataset.loadedPath !== effectivePath) {
      vid.dataset.loadedPath = effectivePath
      vid.src = nextUrl
      vid.muted = true
      vid.loop = false
      vid.load()
    }
    if (effectivePlaying) {
      vid.play().catch(() => {})
    } else {
      vid.pause()
    }
  }, [effectivePath, effectivePlaying, detached, maximized, performanceMode])

  // Keep OBS cursor roughly aligned when OB mode is active
  useEffect(() => {
    const vid = videoRef.current
    if (!vid || !obsClipMode || !obsStatus) return
    const targetSec = (obsStatus.cursorMs || 0) / 1000
    if (
      vid.readyState >= 1 &&
      Number.isFinite(vid.duration) &&
      vid.duration > 0 &&
      Math.abs(vid.currentTime - targetSec) > 1.35
    ) {
      try {
        vid.currentTime = Math.min(targetSec, Math.max(0, vid.duration - 0.1))
      } catch {
        // ignore seek before ready
      }
    }
  }, [obsClipMode, obsStatus?.cursorMs, obsStatus?.playbackEpoch])

  const sendObsCommand = async (action: 'play' | 'pause' | 'next' | 'previous') => {
    if (!obsConnection.connected) {
      onNotify('OBS WebSocket is not connected. Open Preferences -> OBS Integration to connect.')
      return
    }
    if (!activeObsClipSourceId) {
      onNotify('No Curationist Video source found in OBS.')
      return
    }
    try {
      const next = await window.curationist.controlObsSource({
        sourceId: activeObsClipSourceId,
        action
      })
      setObsStatus(next)
    } catch (err: any) {
      onNotify(`OBS Video control error: ${err?.message || String(err)}`)
    }
  }

  const handlePrev = () => {
    if (obsClipMode) {
      void sendObsCommand('previous')
      return
    }
    if (localPlaylistClips.length > 0) {
      setLocalIndex((i) => (i - 1 + localPlaylistClips.length) % localPlaylistClips.length)
      setLocalPlaying(true)
    }
  }

  const handleTogglePlay = () => {
    if (obsClipMode) {
      void sendObsCommand(obsStatus?.state === 'playing' ? 'pause' : 'play')
      return
    }
    if (!localClip) return
    setLocalPlaying((p) => !p)
  }

  const handleNext = () => {
    if (obsClipMode) {
      void sendObsCommand('next')
      return
    }
    if (localPlaylistClips.length > 0) {
      setLocalIndex((i) => (i + 1) % localPlaylistClips.length)
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
      <div className={`ucs-preview-card video ${mode}`}>
        <div className="ucs-preview-header">
          <div className="ucs-preview-label-group">
            <span className="ucs-layer-badge video">VIDEO</span>
            <span className="ucs-preview-title" title={effectiveTitle}>
              {effectiveTitle}
            </span>
          </div>
          <div className="ucs-preview-win-actions">
            {obsClipMode && (
              <span className={`ucs-state-pill ${obsStatus?.state === 'playing' ? 'live' : ''}`}>
                {(obsStatus?.state || 'IDLE').toUpperCase()}
              </span>
            )}
            <button
              type="button"
              className="ucs-mini-btn"
              onClick={handleToggleMaximize}
              title={maximized ? 'Restore Video Preview' : 'Maximize Video Preview'}
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
              title={detached ? 'Re-dock Video Preview into Bottom Deck' : 'Detach Video Preview into Separate Window'}
            >
              {detached ? <X size={11} /> : <ExternalLink size={11} />}
            </button>
          </div>
        </div>

        <div
          className={`ucs-preview-viewport ${isLarge ? 'large' : ''}`}
          onDoubleClick={handleToggleMaximize}
          title="Double-click to maximize/restore Video Monitor"
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: effectivePath ? 'block' : 'none'
            }}
            onEnded={() => {
              if (!obsClipMode && localPlaylistClips.length > 0) {
                setLocalIndex((i) => (i + 1) % localPlaylistClips.length)
              }
            }}
          />
          {!effectivePath && (
            <div className="ucs-preview-empty">
              <Film size={isLarge ? 26 : 15} color="#4d85bd" />
              {isLarge && <span>No active video clip</span>}
            </div>
          )}
        </div>

        <div className="ucs-preview-controls">
          <ObsLedToggle
            active={obsClipMode}
            connected={obsConnection.connected}
            kind="clip"
            onToggle={onToggleObsClipMode}
            onOpenSettings={() => setShowSettings(true)}
          />
          <div className="ucs-transport-cluster">
            <button
              type="button"
              className="ucs-transport-btn"
              onClick={handlePrev}
              disabled={obsClipMode ? !obsConnection.connected : localPlaylistClips.length === 0}
              title={obsClipMode ? 'Previous Video in OBS' : 'Previous Local Video'}
            >
              <SkipBack size={11} />
            </button>
            <button
              type="button"
              className={`ucs-transport-btn play ${effectivePlaying ? 'playing' : ''}`}
              onClick={handleTogglePlay}
              disabled={obsClipMode ? !obsConnection.connected : !localClip}
              title={effectivePlaying ? 'Pause Video' : 'Play Video'}
            >
              {effectivePlaying ? <Pause size={11} /> : <Play size={11} />}
            </button>
            <button
              type="button"
              className="ucs-transport-btn"
              onClick={handleNext}
              disabled={obsClipMode ? !obsConnection.connected : localPlaylistClips.length === 0}
              title={obsClipMode ? 'Next Video in OBS' : 'Next Local Video'}
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
            title="Video Preview is detached in its own window — click to re-dock"
          >
            <span className="ucs-layer-badge video">VIDEO</span>
            <span className="ucs-detached-text">Detached Window</span>
            <ObsLedToggle
              active={obsClipMode}
              connected={obsConnection.connected}
              kind="clip"
              onToggle={onToggleObsClipMode}
              onOpenSettings={() => setShowSettings(true)}
            />
          </div>
          <DetachablePortal
            name="video-monitor"
            title={`Curationist Video Monitor — ${effectiveTitle}`}
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
            title="Video Preview is maximized — click to restore"
          >
            <span className="ucs-layer-badge video">VIDEO</span>
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
        <ObsClipSettingsModal
          sourceId={activeObsClipSourceId}
          sources={obsConnection.sources}
          onSelectSourceId={onSelectObsClipSourceId}
          onClose={() => setShowSettings(false)}
          onNotify={onNotify}
        />
      )}
    </>
  )
}
