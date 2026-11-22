import React, { useEffect, useRef, useState } from 'react'
import {
  ExternalLink,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { DetachablePortal } from './DetachablePortal'
import { MasterObToggle } from './MasterObToggle'
import { ObsAudioSettingsModal, ObsLedToggle } from './ObsSourceSettingsModal'
import { UniversalPresetModule } from './UniversalPresetModule'
import { UniversalVideoModule } from './UniversalVideoModule'
import type {
  Mp3Track,
  ObsConnectionState,
  ObsQueue,
  ObsStatus,
  PresetWorkspaceState,
  VideoWorkspaceState
} from '../types'

interface FocusTrackTarget {
  trackId?: string
  title?: string
  artist?: string
}

interface AudioPlayerBarProps {
  currentTrack: Mp3Track | null
  videoState: VideoWorkspaceState
  presetState: PresetWorkspaceState
  onPrevTrack?: () => void
  onNextTrack?: () => void
  onFocusTrackInLibrary?: (target: FocusTrackTarget) => void
  obsAudioMode: boolean
  onToggleObsAudioMode: () => void
  obsClipMode: boolean
  onToggleObsClipMode: () => void
  obsVideoMode: boolean
  onToggleObsVideoMode: () => void
  onSetAllObsModes: (enabled: boolean) => void
  obsConnection: ObsConnectionState
  selectedObsAudioSourceId: string
  onSelectObsAudioSourceId: (id: string) => void
  selectedObsClipSourceId: string
  onSelectObsClipSourceId: (id: string) => void
  selectedObsVideoSourceId: string
  onSelectObsVideoSourceId: (id: string) => void
  onNotify: (msg: string) => void
}

function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const mins = Math.floor(total / 60)
  const rem = total % 60
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  currentTrack,
  videoState,
  presetState,
  onPrevTrack,
  onNextTrack,
  onFocusTrackInLibrary,
  obsAudioMode,
  onToggleObsAudioMode,
  obsClipMode,
  onToggleObsClipMode,
  obsVideoMode,
  onToggleObsVideoMode,
  onSetAllObsModes,
  obsConnection,
  selectedObsAudioSourceId,
  onSelectObsAudioSourceId,
  selectedObsClipSourceId,
  onSelectObsClipSourceId,
  selectedObsVideoSourceId,
  onSelectObsVideoSourceId,
  onNotify
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const deckPopoutWinRef = useRef<Window | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.85)
  const [muted, setMuted] = useState(false)

  // Detach whole bottom navbar & Performance Mode (fullscreen)
  const [deckDetached, setDeckDetached] = useState(false)
  const [performanceMode, setPerformanceMode] = useState(false)

  // OBS Remote state when obsAudioMode ('OB' LED) is ON
  const [obsStatus, setObsStatus] = useState<ObsStatus | null>(null)
  const [obsQueue, setObsQueue] = useState<ObsQueue | null>(null)
  const [obsSeekingSec, setObsSeekingSec] = useState<number | null>(null)
  const obsSeekOriginRef = useRef<{ epoch: number; mediaId: string } | null>(null)
  const [showObsAudioSettings, setShowObsAudioSettings] = useState(false)

  const audioSources = obsConnection.sources.filter((s) => s.kind === 'audio')
  const activeObsSourceId =
    selectedObsAudioSourceId &&
    (audioSources.length === 0 || audioSources.some((s) => s.sourceId === selectedObsAudioSourceId))
      ? selectedObsAudioSourceId
      : audioSources[0]?.sourceId || ''

  // Exit Performance Mode on Escape key
  useEffect(() => {
    if (!performanceMode) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPerformanceMode(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    const popWin = deckPopoutWinRef.current
    if (popWin && !popWin.closed) {
      popWin.addEventListener('keydown', onKeyDown)
    }
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (popWin && !popWin.closed) {
        popWin.removeEventListener('keydown', onKeyDown)
      }
    }
  }, [performanceMode, deckDetached])

  // Immediately stop local preview audio when OB mode is turned ON
  useEffect(() => {
    if (obsAudioMode && audioRef.current) {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }, [obsAudioMode])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (obsAudioMode) {
      audio.pause()
      setIsPlaying(false)
      return
    }
    if (!currentTrack) {
      audio.pause()
      audio.removeAttribute('src')
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      return
    }
    const mediaUrl = `curationist-media://local?path=${encodeURIComponent(currentTrack.filePath)}`
    audio.src = mediaUrl
    audio.volume = muted ? 0 : volume
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false))
  }, [currentTrack?.id, currentTrack?.filePath, obsAudioMode])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume
    }
  }, [volume, muted])

  // Poll OBS Curationist Audio source when OB LED is ON and connected
  useEffect(() => {
    if (!obsAudioMode || !obsConnection.connected || !activeObsSourceId) {
      setObsStatus(null)
      setObsQueue(null)
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let signature = ''

    const poll = async () => {
      try {
        const st = await window.curationist.getObsSourceStatus(activeObsSourceId)
        if (disposed) return
        setObsStatus(st)
        const sig = `${st.revision}:${st.playbackEpoch}:${st.remaining}:${st.state}`
        if (sig !== signature) {
          const q = await window.curationist.getObsSourceQueue(activeObsSourceId)
          if (!disposed) {
            setObsQueue(q)
            signature = sig
          }
        }
      } catch {
        // source may not be active yet
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
  }, [obsAudioMode, obsConnection.connected, activeObsSourceId])

  const sendObsCommand = async (
    action: 'play' | 'pause' | 'stop' | 'restart' | 'next' | 'previous'
  ) => {
    if (!obsConnection.connected) {
      onNotify('OBS WebSocket is not connected. Open Preferences -> OBS Integration to connect.')
      return
    }
    if (!activeObsSourceId) {
      onNotify(
        'No Curationist Audio source found in OBS. Add a "Curationist Audio" source in OBS first.'
      )
      return
    }
    try {
      const nextSt = await window.curationist.controlObsSource({
        sourceId: activeObsSourceId,
        action
      })
      setObsStatus(nextSt)
    } catch (err: any) {
      onNotify(`OBS Audio control error: ${err?.message || String(err)}`)
    }
  }

  const togglePlay = () => {
    if (obsAudioMode) {
      const nextAction = obsStatus?.state === 'playing' ? 'pause' : 'play'
      void sendObsCommand(nextAction)
      return
    }
    const audio = audioRef.current
    if (!audio || !currentTrack) return
    if (audio.paused) {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {})
    } else {
      audio.pause()
      setIsPlaying(false)
    }
  }

  const handlePrev = () => {
    if (obsAudioMode) {
      void sendObsCommand('previous')
      return
    }
    if (onPrevTrack) onPrevTrack()
  }

  const handleNext = () => {
    if (obsAudioMode) {
      void sendObsCommand('next')
      return
    }
    if (onNextTrack) onNextTrack()
  }

  const obsCurrentItem = obsQueue?.current ?? obsQueue?.stopped ?? null
  const obsDurationSec = (obsStatus?.durationMs || obsCurrentItem?.durationMs || 0) / 1000
  const obsCursorSec =
    obsSeekingSec !== null ? obsSeekingSec : (obsStatus?.cursorMs || 0) / 1000

  const effectiveCurrentSec = obsAudioMode ? obsCursorSec : currentTime
  const effectiveDuration = obsAudioMode
    ? obsDurationSec
    : duration || currentTrack?.duration || 0
  const effectiveIsPlaying = obsAudioMode ? obsStatus?.state === 'playing' : isPlaying

  const seekVal = Math.min(effectiveCurrentSec, effectiveDuration || 1)
  const seekPct =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (seekVal / effectiveDuration) * 100)) : 0
  const volVal = muted ? 0 : volume
  const volPct = Math.min(100, Math.max(0, volVal * 100))

  const beginObsSeek = () => {
    if (obsAudioMode && obsStatus?.activeMediaId) {
      obsSeekOriginRef.current = {
        epoch: obsStatus.playbackEpoch,
        mediaId: obsStatus.activeMediaId
      }
    }
  }

  const commitObsSeek = async () => {
    if (!obsAudioMode || obsSeekingSec === null || !activeObsSourceId) {
      setObsSeekingSec(null)
      return
    }
    const origin = obsSeekOriginRef.current
    const targetMs = Math.round(obsSeekingSec * 1000)
    obsSeekOriginRef.current = null
    setObsSeekingSec(null)
    try {
      const nextSt = await window.curationist.controlObsSource({
        action: 'seek',
        sourceId: activeObsSourceId,
        cursorMs: targetMs,
        expectedEpoch: origin?.epoch,
        expectedMediaId: origin?.mediaId
      })
      setObsStatus(nextSt)
    } catch (err: any) {
      onNotify(`OBS seek error: ${err?.message || String(err)}`)
    }
  }

  const canHyperlinkSong = Boolean(
    onFocusTrackInLibrary &&
      ((obsAudioMode && obsCurrentItem?.title) || (!obsAudioMode && currentTrack))
  )

  const handleClickSongHyperlink = () => {
    if (!onFocusTrackInLibrary) return
    if (obsAudioMode && obsCurrentItem) {
      onFocusTrackInLibrary({
        trackId: obsCurrentItem.mediaId || undefined,
        title: obsCurrentItem.title || undefined,
        artist: obsCurrentItem.artist || undefined
      })
      if (performanceMode) setPerformanceMode(false)
    } else if (currentTrack) {
      onFocusTrackInLibrary({
        trackId: currentTrack.id,
        title: currentTrack.title || currentTrack.filename,
        artist: currentTrack.artist
      })
      if (performanceMode) setPerformanceMode(false)
    }
  }

  const toggleOsFullscreen = () => {
    const targetDoc =
      deckDetached && deckPopoutWinRef.current && !deckPopoutWinRef.current.closed
        ? deckPopoutWinRef.current.document
        : document
    if (targetDoc.fullscreenElement) {
      void targetDoc.exitFullscreen().catch(() => {})
    } else {
      void targetDoc.documentElement.requestFullscreen().catch(() => {})
    }
  }

  const renderAudioSection = (isPerf: boolean) => (
    <div className={`ucs-audio-section ${isPerf ? 'perf' : ''}`}>
      <div className="ucs-audio-top-row">
        <div className="player-track-info compact">
          <div className="player-thumb">
            {!obsAudioMode && currentTrack?.coverArtBase64 ? (
              <img
                src={`data:${currentTrack.coverArtMime || 'image/jpeg'};base64,${currentTrack.coverArtBase64}`}
                alt="Cover"
              />
            ) : !obsAudioMode && currentTrack?.coverArtMime ? (
              <img
                src={`curationist-media://artwork?trackId=${encodeURIComponent(currentTrack.id)}`}
                alt="Cover"
              />
            ) : (
              <Music size={15} color={obsAudioMode ? '#22d3ee' : '#7d8590'} />
            )}
          </div>
          {obsAudioMode ? (
            <div className="player-track-meta">
              {canHyperlinkSong ? (
                <button
                  type="button"
                  className="player-track-title song-hyperlink"
                  onClick={handleClickSongHyperlink}
                  title={`Click to locate & focus "${obsCurrentItem?.title}" in MP3 Library`}
                >
                  {obsCurrentItem?.title}
                </button>
              ) : (
                <div
                  className="player-track-title"
                  title={
                    obsCurrentItem?.title ||
                    (obsConnection.connected
                      ? 'OBS Curationist Audio Ready'
                      : 'OBS WebSocket Disconnected')
                  }
                >
                  {obsCurrentItem?.title ||
                    (obsConnection.connected
                      ? 'OBS Curationist Audio (Idle)'
                      : 'OBS WebSocket Disconnected')}
                </div>
              )}
              <div className="player-track-artist">
                {obsCurrentItem?.artist
                  ? `${obsCurrentItem.artist} • OBS ${(obsStatus?.state || 'idle').toUpperCase()}`
                  : obsConnection.connected
                    ? `Broadcast Shuttle -> OBS (${obsStatus?.state || 'stopped'})`
                    : 'Connect to OBS in Preferences'}
              </div>
            </div>
          ) : currentTrack ? (
            <div className="player-track-meta">
              <button
                type="button"
                className="player-track-title song-hyperlink"
                onClick={handleClickSongHyperlink}
                title={`Click to locate & focus "${currentTrack.title || currentTrack.filename}" in MP3 Library`}
              >
                {currentTrack.title || currentTrack.filename}
              </button>
              <div className="player-track-artist" title={currentTrack.artist}>
                {currentTrack.artist || 'Unknown Artist'}
                {currentTrack.album ? ` • ${currentTrack.album}` : ''}
              </div>
            </div>
          ) : (
            <span className="player-idle-hint">
              Double-click or press Play on any MP3 track or playlist
            </span>
          )}
        </div>

        <div className="ucs-audio-transport-row">
          <ObsLedToggle
            active={obsAudioMode}
            connected={obsConnection.connected}
            kind="audio"
            onToggle={onToggleObsAudioMode}
            onOpenSettings={() => setShowObsAudioSettings(true)}
          />
          <div className="player-transport-btns compact">
            <button
              className="shuttle-btn"
              disabled={obsAudioMode ? !obsConnection.connected : !currentTrack || !onPrevTrack}
              onClick={handlePrev}
              title={obsAudioMode ? 'Previous Track in OBS' : 'Previous Track'}
            >
              <SkipBack size={14} />
            </button>
            <button
              className={`shuttle-btn play-toggle ${effectiveIsPlaying ? 'playing' : ''}`}
              disabled={obsAudioMode ? !obsConnection.connected : !currentTrack}
              onClick={togglePlay}
              title={
                obsAudioMode
                  ? effectiveIsPlaying
                    ? 'Pause OBS Audio'
                    : 'Play OBS Audio'
                  : effectiveIsPlaying
                    ? 'Pause'
                    : 'Play'
              }
            >
              {effectiveIsPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              className="shuttle-btn"
              disabled={obsAudioMode ? !obsConnection.connected : !currentTrack || !onNextTrack}
              onClick={handleNext}
              title={obsAudioMode ? 'Next Track in OBS' : 'Next Track'}
            >
              <SkipForward size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="ucs-audio-sliders-row">
        <div className="player-timeline-group compact">
          <span className="player-time current">{formatSeconds(effectiveCurrentSec)}</span>
          <input
            type="range"
            className="shuttle-slider timeline-slider"
            style={{ '--slider-pct': `${seekPct.toFixed(1)}%` } as React.CSSProperties}
            min={0}
            max={effectiveDuration > 0 ? effectiveDuration : 1}
            step={0.1}
            value={seekVal}
            disabled={
              obsAudioMode
                ? !obsConnection.connected || !obsStatus?.activeMediaId
                : !currentTrack
            }
            onPointerDown={beginObsSeek}
            onPointerUp={() => {
              if (obsAudioMode) void commitObsSeek()
            }}
            onChange={(e) => {
              const val = Number.parseFloat(e.target.value)
              if (obsAudioMode) {
                setObsSeekingSec(val)
              } else {
                setCurrentTime(val)
                if (audioRef.current) {
                  audioRef.current.currentTime = val
                }
              }
            }}
          />
          <span className="player-time total">{formatSeconds(effectiveDuration)}</span>
        </div>

        <div className="player-volume-group compact">
          <button
            className="shuttle-btn volume-mute-btn"
            disabled={obsAudioMode}
            onClick={() => setMuted(!muted)}
            title={
              obsAudioMode
                ? 'Local Preview Muted while OB Remote Mode is Active'
                : muted
                  ? 'Unmute'
                  : 'Mute'
            }
          >
            {obsAudioMode || muted || volume === 0 ? (
              <VolumeX size={13} />
            ) : (
              <Volume2 size={13} />
            )}
          </button>
          <input
            type="range"
            className="shuttle-slider volume-slider"
            style={
              {
                '--slider-pct': `${(obsAudioMode ? 0 : volPct).toFixed(1)}%`
              } as React.CSSProperties
            }
            min={0}
            max={1}
            step={0.01}
            value={obsAudioMode ? 0 : volVal}
            disabled={obsAudioMode}
            title={
              obsAudioMode
                ? 'Local Preview Stopped while OB Remote Mode is Active'
                : `Volume: ${Math.round(volVal * 100)}%`
            }
            onChange={(e) => {
              setMuted(false)
              setVolume(Number.parseFloat(e.target.value))
            }}
          />
        </div>
      </div>
    </div>
  )

  const renderControlDeck = (isPerf: boolean, isDetachedHost: boolean) => {
    if (isPerf) {
      return (
        <div className={`ucs-performance-shell ${isDetachedHost ? 'detached' : ''}`}>
          <div className="ucs-perf-topbar">
            <div className="ucs-perf-brand">
              <MonitorPlay size={16} color="#00f0b5" />
              <span className="ucs-perf-title">CURATIONIST PERFORMANCE MODE</span>
              <span
                className={`badge ${obsConnection.connected ? 'synced' : ''}`}
                style={{ fontSize: 10 }}
              >
                {obsConnection.connected
                  ? `OBS CONNECTED (${obsConnection.sources.length} SOURCES)`
                  : 'OBS STANDBY'}
              </span>
            </div>
            <div className="ucs-perf-actions">
              <button
                type="button"
                className="vscode-btn"
                onClick={toggleOsFullscreen}
                title="Toggle Fullscreen Monitor (F11 / Fullscreen)"
              >
                <Maximize2 size={12} /> Fullscreen Display
              </button>
              <button
                type="button"
                className="vscode-btn"
                onClick={() => setDeckDetached((d) => !d)}
                title={
                  deckDetached
                    ? 'Re-dock Control Deck into Main Window'
                    : 'Detach Performance Deck into Separate Window'
                }
              >
                <ExternalLink size={12} /> {deckDetached ? 'Re-dock Deck' : 'Detach Window'}
              </button>
              <button
                type="button"
                className="vscode-btn primary"
                onClick={() => setPerformanceMode(false)}
                title="Exit Performance Mode (Esc)"
              >
                <Minimize2 size={12} /> Exit Performance Mode
              </button>
            </div>
          </div>

          <div className="ucs-perf-monitors">
            <UniversalVideoModule
              videoState={videoState}
              obsClipMode={obsClipMode}
              onToggleObsClipMode={onToggleObsClipMode}
              obsConnection={obsConnection}
              selectedObsClipSourceId={selectedObsClipSourceId}
              onSelectObsClipSourceId={onSelectObsClipSourceId}
              onNotify={onNotify}
              performanceMode
            />
            <UniversalPresetModule
              presetState={presetState}
              obsVideoMode={obsVideoMode}
              onToggleObsVideoMode={onToggleObsVideoMode}
              obsConnection={obsConnection}
              selectedObsVideoSourceId={selectedObsVideoSourceId}
              onSelectObsVideoSourceId={onSelectObsVideoSourceId}
              onNotify={onNotify}
              performanceMode
            />
          </div>

          <div className="ucs-perf-bottom-deck">
            <MasterObToggle
              obsAudioMode={obsAudioMode}
              obsClipMode={obsClipMode}
              obsVideoMode={obsVideoMode}
              obsConnected={obsConnection.connected}
              onSetAllObsModes={onSetAllObsModes}
            />
            {renderAudioSection(true)}
          </div>
        </div>
      )
    }

    return (
      <div className={`audio-player-bar universal-control-surface ${isDetachedHost ? 'detached-bar' : ''}`}>
        {/* Far-Left 3-Position Industrial Master OB Toggle */}
        <MasterObToggle
          obsAudioMode={obsAudioMode}
          obsClipMode={obsClipMode}
          obsVideoMode={obsVideoMode}
          obsConnected={obsConnection.connected}
          onSetAllObsModes={onSetAllObsModes}
          compact
        />

        {/* Compacted MP3 Audio Shuttle + Song Hyperlink */}
        {renderAudioSection(false)}

        {/* Right Side: Live Video & Preset Preview Modules with individual OB & controls */}
        <div className="ucs-previews-dock">
          <UniversalVideoModule
            videoState={videoState}
            obsClipMode={obsClipMode}
            onToggleObsClipMode={onToggleObsClipMode}
            obsConnection={obsConnection}
            selectedObsClipSourceId={selectedObsClipSourceId}
            onSelectObsClipSourceId={onSelectObsClipSourceId}
            onNotify={onNotify}
          />
          <UniversalPresetModule
            presetState={presetState}
            obsVideoMode={obsVideoMode}
            onToggleObsVideoMode={onToggleObsVideoMode}
            obsConnection={obsConnection}
            selectedObsVideoSourceId={selectedObsVideoSourceId}
            onSelectObsVideoSourceId={onSelectObsVideoSourceId}
            onNotify={onNotify}
          />
        </div>

        {/* Far-Right Universal Deck Actions (Performance Mode & Detach Whole Deck) */}
        <div className="ucs-deck-actions">
          <button
            type="button"
            className="ucs-deck-action-btn perf"
            onClick={() => setPerformanceMode(true)}
            title="Enter Fullscreen Performance Mode for live command & monitoring of all 3 OBS plugins"
          >
            <MonitorPlay size={13} />
            <span>Live</span>
          </button>
          <button
            type="button"
            className={`ucs-deck-action-btn ${deckDetached ? 'active' : ''}`}
            onClick={() => setDeckDetached((d) => !d)}
            title={
              deckDetached
                ? 'Re-dock Universal Control Deck into Main Window'
                : 'Detach Universal Control Deck into a Separate Window'
            }
          >
            {deckDetached ? <X size={13} /> : <ExternalLink size={13} />}
            <span>{deckDetached ? 'Dock' : 'Popout'}</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Persistent local <audio> element stays mounted in the main window so detaching never interrupts playback */}
      <audio
        ref={audioRef}
        style={{ display: 'none' }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) =>
          setDuration(e.currentTarget.duration || currentTrack?.duration || 0)
        }
        onEnded={() => {
          setIsPlaying(false)
          if (!obsAudioMode && onNextTrack) onNextTrack()
        }}
      />

      {deckDetached ? (
        <>
          <div className="ucs-docked-strip-detached">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <MonitorPlay size={14} color="#00f0b5" />
              <span>
                <strong>Universal Control Deck Detached</strong> — controlling Audio, Video &amp;
                Presets in standalone window
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="vscode-btn"
                onClick={() => setPerformanceMode((p) => !p)}
              >
                <Maximize2 size={11} /> {performanceMode ? 'Compact Detached Deck' : 'Performance Mode'}
              </button>
              <button
                type="button"
                className="vscode-btn primary"
                onClick={() => setDeckDetached(false)}
              >
                Re-dock Control Surface
              </button>
            </div>
          </div>

          <DetachablePortal
            name="universal-control-deck"
            title={
              performanceMode
                ? 'Curationist — Performance Mode (Audio • Video • Visualizer)'
                : 'Curationist — Universal OBS Control Deck'
            }
            width={performanceMode ? 1280 : 1240}
            height={performanceMode ? 760 : 148}
            onWindowReady={(w) => {
              deckPopoutWinRef.current = w
            }}
            onClose={() => {
              setDeckDetached(false)
              setPerformanceMode(false)
            }}
          >
            {renderControlDeck(performanceMode, true)}
          </DetachablePortal>
        </>
      ) : performanceMode ? (
        <div className="ucs-performance-fullscreen-overlay">
          {renderControlDeck(true, false)}
        </div>
      ) : (
        renderControlDeck(false, false)
      )}

      {showObsAudioSettings && (
        <ObsAudioSettingsModal
          sourceId={activeObsSourceId}
          sources={obsConnection.sources}
          onSelectSourceId={onSelectObsAudioSourceId}
          onClose={() => setShowObsAudioSettings(false)}
          onNotify={onNotify}
        />
      )}
    </>
  )
}
