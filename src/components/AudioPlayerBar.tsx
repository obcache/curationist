import React, { useEffect, useRef, useState } from 'react'
import {
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { Mp3Track } from '../types'

interface AudioPlayerBarProps {
  currentTrack: Mp3Track | null
  onPrevTrack?: () => void
  onNextTrack?: () => void
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
  onPrevTrack,
  onNextTrack
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.85)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
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
  }, [currentTrack?.id, currentTrack?.filePath])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume
    }
  }, [volume, muted])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return
    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {})
    } else {
      audio.pause()
      setIsPlaying(false)
    }
  }

  const effectiveDuration = duration || currentTrack?.duration || 0
  const seekVal = Math.min(currentTime, effectiveDuration || 1)
  const seekPct =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (seekVal / effectiveDuration) * 100)) : 0
  const volVal = muted ? 0 : volume
  const volPct = Math.min(100, Math.max(0, volVal * 100))

  return (
    <div className="audio-player-bar">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || currentTrack?.duration || 0)}
        onEnded={() => {
          setIsPlaying(false)
          if (onNextTrack) onNextTrack()
        }}
      />

      <div className="player-track-info">
        <div className="player-thumb">
          {currentTrack?.coverArtBase64 ? (
            <img
              src={`data:${currentTrack.coverArtMime || 'image/jpeg'};base64,${currentTrack.coverArtBase64}`}
              alt="Cover"
            />
          ) : currentTrack?.coverArtMime ? (
            <img
              src={`curationist-media://artwork?trackId=${encodeURIComponent(currentTrack.id)}`}
              alt="Cover"
            />
          ) : (
            <Music size={15} color="#7d8590" />
          )}
        </div>
        {currentTrack ? (
          <div className="player-track-meta">
            <div className="player-track-title" title={currentTrack.title || currentTrack.filename}>
              {currentTrack.title || currentTrack.filename}
            </div>
            <div className="player-track-artist" title={currentTrack.artist}>
              {currentTrack.artist || 'Unknown Artist'}
              {currentTrack.album ? ` • ${currentTrack.album}` : ''}
            </div>
          </div>
        ) : (
          <span className="player-idle-hint">
            Double-click or press Play on any MP3 track or playlist to preview audio
          </span>
        )}
      </div>

      <div className="player-shuttle-deck">
        <div className="player-transport-btns">
          <button
            className="shuttle-btn"
            disabled={!currentTrack || !onPrevTrack}
            onClick={onPrevTrack}
            title="Previous Track"
          >
            <SkipBack size={15} />
          </button>
          <button
            className={`shuttle-btn play-toggle ${isPlaying ? 'playing' : ''}`}
            disabled={!currentTrack}
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="shuttle-btn"
            disabled={!currentTrack || !onNextTrack}
            onClick={onNextTrack}
            title="Next Track"
          >
            <SkipForward size={15} />
          </button>
        </div>

        <div className="player-timeline-group">
          <span className="player-time current">{formatSeconds(currentTime)}</span>
          <input
            type="range"
            className="shuttle-slider timeline-slider"
            style={{ '--slider-pct': `${seekPct.toFixed(1)}%` } as React.CSSProperties}
            min={0}
            max={effectiveDuration > 0 ? effectiveDuration : 1}
            step={0.1}
            value={seekVal}
            disabled={!currentTrack}
            onChange={(e) => {
              const val = Number.parseFloat(e.target.value)
              setCurrentTime(val)
              if (audioRef.current) {
                audioRef.current.currentTime = val
              }
            }}
          />
          <span className="player-time total">{formatSeconds(effectiveDuration)}</span>
        </div>

        <div className="player-volume-group">
          <button
            className="shuttle-btn volume-mute-btn"
            onClick={() => setMuted(!muted)}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input
            type="range"
            className="shuttle-slider volume-slider"
            style={{ '--slider-pct': `${volPct.toFixed(1)}%` } as React.CSSProperties}
            min={0}
            max={1}
            step={0.01}
            value={volVal}
            title={`Volume: ${Math.round(volVal * 100)}%`}
            onChange={(e) => {
              setMuted(false)
              setVolume(Number.parseFloat(e.target.value))
            }}
          />
        </div>
      </div>
    </div>
  )
}
