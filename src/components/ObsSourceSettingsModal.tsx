import React, { useEffect, useState } from 'react'
import { Check, RefreshCw, RotateCcw, Sliders, X } from 'lucide-react'
import type {
  ObsAudioDriver,
  ObsAudioSettings,
  ObsSource,
  ObsStatus,
  ObsVideoSettings
} from '../types'

interface ObsLedToggleProps {
  active: boolean
  connected: boolean
  kind: 'audio' | 'clip' | 'video'
  onToggle: () => void
  onOpenSettings?: () => void
}

export const ObsLedToggle: React.FC<ObsLedToggleProps> = ({
  active,
  connected,
  kind,
  onToggle,
  onOpenSettings
}) => {
  const labelText =
    kind === 'audio'
      ? 'Curationist Audio'
      : kind === 'clip'
        ? 'Curationist Video'
        : 'Curationist Visualizer'
  const stateClass = !active ? 'off' : connected ? 'on-connected' : 'on-standby'

  return (
    <div className="obs-led-control-cluster">
      <button
        type="button"
        className={`obs-led-toggle-btn ${stateClass}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        title={
          active
            ? `OB Remote Active (${labelText}) — Shuttle controls broadcast to OBS via WebSocket. Click to return to local preview.`
            : `Toggle OB Remote Mode (${labelText}) — Routes shuttle controls to OBS via WebSocket and stops local preview.`
        }
      >
        <span className="obs-led-bezel">
          <span className="obs-led-lamp" />
        </span>
        <span className="obs-led-text">OB</span>
      </button>
      {onOpenSettings && (
        <button
          type="button"
          className="icon-btn obs-led-gear-btn"
          onClick={(e) => {
            e.stopPropagation()
            onOpenSettings()
          }}
          title={`Configure OBS ${labelText} Source Settings`}
        >
          <Sliders size={12} />
        </button>
      )}
    </div>
  )
}

interface ObsAudioSettingsModalProps {
  sourceId: string
  sources: ObsSource[]
  onSelectSourceId: (id: string) => void
  onClose: () => void
  onNotify: (msg: string) => void
}

export const ObsAudioSettingsModal: React.FC<ObsAudioSettingsModalProps> = ({
  sourceId,
  sources,
  onSelectSourceId,
  onClose,
  onNotify
}) => {
  const audioSources = sources.filter((s) => s.kind === 'audio')
  const effectiveSourceId =
    sourceId && (audioSources.length === 0 || audioSources.some((s) => s.sourceId === sourceId))
      ? sourceId
      : audioSources[0]?.sourceId || ''
  const [settings, setSettings] = useState<ObsAudioSettings | null>(null)
  const [status, setStatus] = useState<ObsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadSettings = async (targetId: string) => {
    if (!targetId) return
    setBusy(true)
    setError('')
    try {
      const [art, st] = await Promise.all([
        window.curationist.getObsAudioSettings(targetId),
        window.curationist.getObsSourceStatus(targetId)
      ])
      setSettings(art)
      setStatus(st)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (effectiveSourceId) {
      void loadSettings(effectiveSourceId)
    }
  }, [effectiveSourceId])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings || !effectiveSourceId) return
    setBusy(true)
    setError('')
    try {
      await window.curationist.setObsAudioSettings(settings)
      if (status) {
        await window.curationist.setObsPlaybackModes(
          effectiveSourceId,
          status.loop,
          status.shuffle
        )
      }
      onNotify('Saved Curationist Audio artwork & playback settings in OBS')
      onClose()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const sliders: Array<[keyof ObsAudioSettings, string, number, number]> = [
    ['brightness', 'Brightness', -100, 100],
    ['contrast', 'Contrast', -100, 100],
    ['saturation', 'Saturation', 0, 300],
    ['glowSize', 'Glow Size', 0, 48],
    ['glowIntensity', 'Glow Intensity', 0, 200],
    ['vignetteStrength', 'Vignette', 0, 100],
    ['vignetteRoundness', 'Vignette Roundness', 25, 200],
    ['bounce', 'Audio Bounce', 0, 100],
    ['shake', 'Camera Shake', 0, 100]
  ]

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form
        className="modal-window"
        style={{ width: 560 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
      >
        <div className="modal-header">
          <span>Curationist Audio — OBS Source &amp; Artwork Effects</span>
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="form-label" style={{ minWidth: 115 }}>
              OBS Audio Source:
            </label>
            <select
              className="vscode-select"
              style={{ flex: 1 }}
              value={effectiveSourceId}
              onChange={(e) => onSelectSourceId(e.target.value)}
            >
              {audioSources.length === 0 ? (
                <option value="">(No Curationist Audio source detected in OBS)</option>
              ) : (
                audioSources.map((s) => (
                  <option key={s.sourceId} value={s.sourceId}>
                    {s.name} ({s.sourceId.slice(0, 8)}…)
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              className="vscode-btn"
              disabled={busy || !effectiveSourceId}
              onClick={() => void loadSettings(effectiveSourceId)}
              title="Refresh source settings from OBS"
            >
              <RefreshCw size={12} />
            </button>
          </div>

          {error && (
            <div
              style={{
                padding: '6px 10px',
                background: 'rgba(241, 76, 76, 0.14)',
                border: '1px solid rgba(241, 76, 76, 0.45)',
                color: '#fca5a5',
                borderRadius: 3,
                fontSize: 11.5
              }}
            >
              {error}
            </div>
          )}

          {settings ? (
            <>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: '8px 12px',
                  background: '#1a1b1f',
                  border: '1px solid #343740',
                  borderRadius: 3
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      className="subtle-checkbox"
                      checked={status?.loop ?? true}
                      onChange={(e) =>
                        setStatus((prev) =>
                          prev ? { ...prev, loop: e.target.checked } : prev
                        )
                      }
                    />
                    <span>Loop Queue in OBS</span>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      className="subtle-checkbox"
                      checked={status?.shuffle ?? false}
                      onChange={(e) =>
                        setStatus((prev) =>
                          prev ? { ...prev, shuffle: e.target.checked } : prev
                        )
                      }
                    />
                    <span>Shuffle Queue in OBS</span>
                  </label>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    paddingTop: 6,
                    borderTop: '1px solid #2b2e37'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span className="form-label" style={{ marginBottom: 0 }}>
                      Crossfade / Auto-Fade Time (-15s to +15s):
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10.5,
                        color:
                          (settings.crossfadeSec || 0) > 0
                            ? '#4ec9b0'
                            : (settings.crossfadeSec || 0) < 0
                              ? '#e2c08d'
                              : '#8b949e'
                      }}
                    >
                      {(settings.crossfadeSec || 0) === 0
                        ? '0s — Standard Advancement'
                        : (settings.crossfadeSec || 0) > 0
                          ? `+${settings.crossfadeSec}s — Overlap Crossfade`
                          : `${settings.crossfadeSec}s — Fade Out → Fade In (No Overlap)`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 10, color: '#8b949e', fontFamily: 'var(--font-mono)' }}>-15s</span>
                    <input
                      type="range"
                      className="shuttle-slider"
                      style={
                        {
                          flex: 1,
                          '--slider-pct': `${((((settings.crossfadeSec || 0) + 15) / 30) * 100).toFixed(1)}%`
                        } as React.CSSProperties
                      }
                      min={-15}
                      max={15}
                      step={1}
                      disabled={busy}
                      value={settings.crossfadeSec || 0}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          crossfadeSec: Number(e.target.value)
                        })
                      }
                    />
                    <span style={{ fontSize: 10, color: '#8b949e', fontFamily: 'var(--font-mono)' }}>+15s</span>
                    <input
                      type="number"
                      className="vscode-input"
                      style={{ width: 58, textAlign: 'center', padding: '2px 6px' }}
                      min={-15}
                      max={15}
                      step={1}
                      disabled={busy}
                      value={settings.crossfadeSec || 0}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          crossfadeSec: Math.max(
                            -15,
                            Math.min(15, Math.round(Number(e.target.value) || 0))
                          )
                        })
                      }
                    />
                  </div>
                  <div style={{ fontSize: 10.5, color: '#8b949e', lineHeight: 1.35 }}>
                    <strong>0s</strong> = standard advance • <strong>Positive (+1..+15s)</strong> = auto-fade edges with overlap • <strong>Negative (-1..-15s)</strong> = sequential fade-out then fade-in (no overlap).
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '10px 16px'
                }}
              >
                {sliders.map(([key, label, min, max]) => {
                  const val = Number(settings[key]) || 0
                  const pct = ((val - min) / (max - min)) * 100
                  return (
                    <div key={key} className="form-field">
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 11
                        }}
                      >
                        <span className="form-label">{label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: '#d4d8de' }}>
                          {val}
                        </span>
                      </div>
                      <input
                        type="range"
                        className="shuttle-slider"
                        style={{ '--slider-pct': `${pct.toFixed(1)}%` } as React.CSSProperties}
                        min={min}
                        max={max}
                        step={1}
                        disabled={busy}
                        value={val}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            [key]: Number(e.target.value)
                          })
                        }
                      />
                    </div>
                  )
                })}

                <div className="form-field">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11
                    }}
                  >
                    <span className="form-label">Glow Color</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#d4d8de' }}>
                      #{settings.glowColor.toString(16).padStart(6, '0')}
                    </span>
                  </div>
                  <input
                    type="color"
                    value={`#${settings.glowColor.toString(16).padStart(6, '0')}`}
                    disabled={busy}
                    style={{
                      width: '100%',
                      height: 24,
                      background: '#252529',
                      border: '1px solid #52525b',
                      borderRadius: 3,
                      cursor: 'pointer'
                    }}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        glowColor: Number.parseInt(e.target.value.slice(1), 16)
                      })
                    }
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="empty-placeholder">
              <span>
                {effectiveSourceId
                  ? 'Reading Curationist Audio settings from OBS...'
                  : 'Connect to OBS WebSocket in Preferences and add a "Curationist Audio" source in OBS.'}
              </span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {settings && (
            <button
              type="button"
              className="vscode-btn"
              disabled={busy}
              onClick={() =>
                setSettings({
                  ...settings,
                  brightness: 0,
                  contrast: 0,
                  saturation: 100,
                  glowColor: 0xffffff,
                  glowSize: 0,
                  glowIntensity: 0,
                  vignetteStrength: 0,
                  vignetteRoundness: 100,
                  bounce: 0,
                  shake: 0
                })
              }
            >
              <RotateCcw size={12} /> Reset Effects
            </button>
          )}
          <button
            type="button"
            className="vscode-btn"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="vscode-btn primary"
            disabled={busy || !settings}
          >
            <Check size={12} /> Save Source Settings
          </button>
        </div>
      </form>
    </div>
  )
}

interface ObsVideoSettingsModalProps {
  sourceId: string
  sources: ObsSource[]
  onSelectSourceId: (id: string) => void
  onClose: () => void
  onNotify: (msg: string) => void
}

export const ObsVideoSettingsModal: React.FC<ObsVideoSettingsModalProps> = ({
  sourceId,
  sources,
  onSelectSourceId,
  onClose,
  onNotify
}) => {
  const videoSources = sources.filter((s) => s.kind === 'video')
  const effectiveSourceId =
    sourceId && (videoSources.length === 0 || videoSources.some((s) => s.sourceId === sourceId))
      ? sourceId
      : videoSources[0]?.sourceId || ''
  const [settings, setSettings] = useState<ObsVideoSettings | null>(null)
  const [drivers, setDrivers] = useState<ObsAudioDriver[]>([])
  const [status, setStatus] = useState<ObsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadSettings = async (targetId: string) => {
    if (!targetId) return
    setBusy(true)
    setError('')
    try {
      const [vs, drv, st] = await Promise.all([
        window.curationist.getObsVideoSettings(targetId),
        window.curationist.getObsAudioDrivers(targetId),
        window.curationist.getObsSourceStatus(targetId)
      ])
      setSettings(vs)
      setDrivers(drv)
      setStatus(st)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (effectiveSourceId) {
      void loadSettings(effectiveSourceId)
    }
  }, [effectiveSourceId])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings || !effectiveSourceId) return
    setBusy(true)
    setError('')
    try {
      await window.curationist.setObsVideoSettings(settings)
      if (status) {
        await window.curationist.setObsPlaybackModes(
          effectiveSourceId,
          status.loop,
          status.shuffle,
          status.advanceOnSongChange
        )
        await window.curationist.setObsPresetTiming(
          effectiveSourceId,
          status.presetIntervalMs,
          status.autoAdvance,
          status.advanceOnSongChange
        )
      }
      onNotify('Saved Curationist Visualizer settings & audio driver in OBS')
      onClose()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form
        className="modal-window"
        style={{ width: 520 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
      >
        <div className="modal-header">
          <span>Curationist Visualizer — OBS Audio Driver &amp; projectM Settings</span>
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="form-label" style={{ minWidth: 115 }}>
              OBS Visualizer:
            </label>
            <select
              className="vscode-select"
              style={{ flex: 1 }}
              value={effectiveSourceId}
              onChange={(e) => onSelectSourceId(e.target.value)}
            >
              {videoSources.length === 0 ? (
                <option value="">(No Curationist Visualizer source detected in OBS)</option>
              ) : (
                videoSources.map((s) => (
                  <option key={s.sourceId} value={s.sourceId}>
                    {s.name} ({s.sourceId.slice(0, 8)}…)
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              className="vscode-btn"
              disabled={busy || !effectiveSourceId}
              onClick={() => void loadSettings(effectiveSourceId)}
              title="Refresh source settings from OBS"
            >
              <RefreshCw size={12} />
            </button>
          </div>

          {error && (
            <div
              style={{
                padding: '6px 10px',
                background: 'rgba(241, 76, 76, 0.14)',
                border: '1px solid rgba(241, 76, 76, 0.45)',
                color: '#fca5a5',
                borderRadius: 3,
                fontSize: 11.5
              }}
            >
              {error}
            </div>
          )}

          {settings ? (
            <>
              <div className="form-field full">
                <label className="form-label">Visualization Audio Driver (OBS Source or Scene)</label>
                <select
                  className="vscode-select"
                  value={settings.audioDriverId}
                  disabled={busy}
                  onChange={(e) =>
                    setSettings({ ...settings, audioDriverId: e.target.value })
                  }
                >
                  <option value="">Silence (Internal Time Driven)</option>
                  {drivers.map((drv) => (
                    <option key={drv.sourceId} value={drv.sourceId}>
                      {drv.name} {drv.type === 'scene' ? '(Scene Mix)' : '(Audio Source)'}
                    </option>
                  ))}
                  {settings.audioDriverId &&
                    !drivers.some((d) => d.sourceId === settings.audioDriverId) && (
                      <option value={settings.audioDriverId}>
                        Unavailable Source ({settings.audioDriverId.slice(0, 8)}…)
                      </option>
                    )}
                </select>
              </div>

              <div className="form-grid">
                <div className="form-field">
                  <label className="form-label">Width (px)</label>
                  <input
                    type="number"
                    className="vscode-input"
                    min={16}
                    max={1920}
                    value={settings.width}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        width: Math.max(16, Math.min(1920, Number(e.target.value) || 1280))
                      })
                    }
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Height (px)</label>
                  <input
                    type="number"
                    className="vscode-input"
                    min={16}
                    max={1080}
                    value={settings.height}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        height: Math.max(16, Math.min(1080, Number(e.target.value) || 720))
                      })
                    }
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Frame Rate (FPS)</label>
                  <input
                    type="number"
                    className="vscode-input"
                    min={10}
                    max={60}
                    value={settings.fps}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        fps: Math.max(10, Math.min(60, Number(e.target.value) || 30))
                      })
                    }
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Soft-Cut Transition (ms)</label>
                  <input
                    type="number"
                    className="vscode-input"
                    min={0}
                    max={30000}
                    value={settings.transitionMs}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        transitionMs: Math.max(
                          0,
                          Math.min(30000, Number(e.target.value) || 0)
                        )
                      })
                    }
                  />
                </div>
              </div>

              {status && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 16,
                    padding: '8px 10px',
                    background: '#1a1b1f',
                    border: '1px solid #343740',
                    borderRadius: 3
                  }}
                >
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      className="subtle-checkbox"
                      checked={status.autoAdvance}
                      onChange={(e) =>
                        setStatus({ ...status, autoAdvance: e.target.checked })
                      }
                    />
                    <span>Auto-Advance</span>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      className="subtle-checkbox"
                      checked={status.loop}
                      onChange={(e) => setStatus({ ...status, loop: e.target.checked })}
                    />
                    <span>Loop</span>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      className="subtle-checkbox"
                      checked={status.shuffle}
                      onChange={(e) =>
                        setStatus({ ...status, shuffle: e.target.checked })
                      }
                    />
                    <span>Shuffle</span>
                  </label>
                  <label
                    className="checkbox-row"
                    title="Automatically transition to the next preset whenever Curationist Audio changes songs"
                  >
                    <input
                      type="checkbox"
                      className="subtle-checkbox"
                      checked={Boolean(status.advanceOnSongChange)}
                      onChange={(e) =>
                        setStatus({ ...status, advanceOnSongChange: e.target.checked })
                      }
                    />
                    <span>Advance on Song Change</span>
                  </label>
                </div>
              )}
            </>
          ) : (
            <div className="empty-placeholder">
              <span>
                {effectiveSourceId
                  ? 'Reading Curationist Visualizer settings from OBS...'
                  : 'Connect to OBS WebSocket in Preferences and add a "Curationist Visualizer" source in OBS.'}
              </span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="vscode-btn"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="vscode-btn primary"
            disabled={busy || !settings}
          >
            <Check size={12} /> Save Source Settings
          </button>
        </div>
      </form>
    </div>
  )
}

interface ObsClipSettingsModalProps {
  sourceId: string
  sources: ObsSource[]
  onSelectSourceId: (id: string) => void
  onClose: () => void
  onNotify: (msg: string) => void
}

export const ObsClipSettingsModal: React.FC<ObsClipSettingsModalProps> = ({
  sourceId,
  sources,
  onSelectSourceId,
  onClose,
  onNotify
}) => {
  const clipSources = sources.filter((s) => s.kind === 'clip')
  const effectiveSourceId =
    sourceId && (clipSources.length === 0 || clipSources.some((s) => s.sourceId === sourceId))
      ? sourceId
      : clipSources[0]?.sourceId || ''
  const [status, setStatus] = useState<ObsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadSettings = async (targetId: string) => {
    if (!targetId) return
    setBusy(true)
    setError('')
    try {
      const st = await window.curationist.getObsSourceStatus(targetId)
      setStatus(st)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (effectiveSourceId) {
      void loadSettings(effectiveSourceId)
    }
  }, [effectiveSourceId])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!status || !effectiveSourceId) return
    setBusy(true)
    setError('')
    try {
      await window.curationist.setObsPlaybackModes(
        effectiveSourceId,
        status.loop,
        status.shuffle,
        status.advanceOnSongChange,
        status.crossfadeSec ?? 0
      )
      onNotify('Saved Curationist Video playback & crossfade settings in OBS')
      onClose()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form
        className="modal-window"
        style={{ width: 480 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
      >
        <div className="modal-header">
          <span>Curationist Video — OBS Video Player Settings</span>
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="form-label" style={{ minWidth: 115 }}>
              OBS Video Source:
            </label>
            <select
              className="vscode-select"
              style={{ flex: 1 }}
              value={effectiveSourceId}
              onChange={(e) => onSelectSourceId(e.target.value)}
            >
              {clipSources.length === 0 ? (
                <option value="">(No Curationist Video source detected in OBS)</option>
              ) : (
                clipSources.map((s) => (
                  <option key={s.sourceId} value={s.sourceId}>
                    {s.name} ({s.sourceId.slice(0, 8)}…)
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              className="vscode-btn"
              disabled={busy || !effectiveSourceId}
              onClick={() => void loadSettings(effectiveSourceId)}
              title="Refresh source settings from OBS"
            >
              <RefreshCw size={12} />
            </button>
          </div>

          {error && (
            <div
              style={{
                padding: '6px 10px',
                background: 'rgba(241, 76, 76, 0.14)',
                border: '1px solid rgba(241, 76, 76, 0.45)',
                color: '#fca5a5',
                borderRadius: 3,
                fontSize: 11.5
              }}
            >
              {error}
            </div>
          )}

          {status ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '10px 12px',
                background: '#1a1b1f',
                border: '1px solid #343740',
                borderRadius: 3
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    className="subtle-checkbox"
                    checked={status.loop}
                    onChange={(e) => setStatus({ ...status, loop: e.target.checked })}
                  />
                  <span>Loop Video Queue in OBS</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    className="subtle-checkbox"
                    checked={status.shuffle}
                    onChange={(e) => setStatus({ ...status, shuffle: e.target.checked })}
                  />
                  <span>Shuffle Video Queue in OBS</span>
                </label>
              </div>
              <div style={{ paddingTop: 6, borderTop: '1px solid #2b2e37' }}>
                <label
                  className="checkbox-row"
                  title="Automatically advance to the next video clip whenever Curationist Audio changes tracks"
                >
                  <input
                    type="checkbox"
                    className="subtle-checkbox"
                    checked={Boolean(status.advanceOnSongChange)}
                    onChange={(e) =>
                      setStatus({ ...status, advanceOnSongChange: e.target.checked })
                    }
                  />
                  <span>Advance on Song Change (Sync with Curationist Audio track transitions)</span>
                </label>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingTop: 6,
                  borderTop: '1px solid #2b2e37'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span className="form-label" style={{ marginBottom: 0 }}>
                    Video Crossfade / Auto-Fade (-15s to +15s):
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      color:
                        (status.crossfadeSec || 0) > 0
                          ? '#4ec9b0'
                          : (status.crossfadeSec || 0) < 0
                            ? '#e2c08d'
                            : '#8b949e'
                    }}
                  >
                    {(status.crossfadeSec || 0) === 0
                      ? '0s — Standard Advancement'
                      : (status.crossfadeSec || 0) > 0
                        ? `+${status.crossfadeSec}s — Overlap Cross-Dissolve`
                        : `${status.crossfadeSec}s — Fade Out → Fade In (No Overlap)`}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: '#8b949e', fontFamily: 'var(--font-mono)' }}>-15s</span>
                  <input
                    type="range"
                    className="shuttle-slider"
                    style={
                      {
                        flex: 1,
                        '--slider-pct': `${((((status.crossfadeSec || 0) + 15) / 30) * 100).toFixed(1)}%`
                      } as React.CSSProperties
                    }
                    min={-15}
                    max={15}
                    step={1}
                    disabled={busy}
                    value={status.crossfadeSec || 0}
                    onChange={(e) =>
                      setStatus({
                        ...status,
                        crossfadeSec: Number(e.target.value)
                      })
                    }
                  />
                  <span style={{ fontSize: 10, color: '#8b949e', fontFamily: 'var(--font-mono)' }}>+15s</span>
                  <input
                    type="number"
                    className="vscode-input"
                    style={{ width: 58, textAlign: 'center', padding: '2px 6px' }}
                    min={-15}
                    max={15}
                    step={1}
                    disabled={busy}
                    value={status.crossfadeSec || 0}
                    onChange={(e) =>
                      setStatus({
                        ...status,
                        crossfadeSec: Math.max(
                          -15,
                          Math.min(15, Math.round(Number(e.target.value) || 0))
                        )
                      })
                    }
                  />
                </div>
                <div style={{ fontSize: 10.5, color: '#8b949e', lineHeight: 1.35 }}>
                  <strong>0s</strong> = standard cut • <strong>Positive (+1..+15s)</strong> = GPU cross-dissolve with overlap • <strong>Negative (-1..-15s)</strong> = fade out to transparent then fade in next clip.
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-placeholder">
              <span>
                {effectiveSourceId
                  ? 'Reading Curationist Video settings from OBS...'
                  : 'Connect to OBS WebSocket in Preferences and add a "Curationist Video" source in OBS.'}
              </span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="vscode-btn"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="vscode-btn primary"
            disabled={busy || !status}
          >
            <Check size={12} /> Save Source Settings
          </button>
        </div>
      </form>
    </div>
  )
}
