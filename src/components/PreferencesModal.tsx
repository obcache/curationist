import React, { useEffect, useState } from 'react'
import {
  Download,
  FolderOpen,
  Plug,
  RefreshCw,
  Save,
  Sliders,
  Unplug,
  X
} from 'lucide-react'
import { BrandLogo } from './BrandLogo'
import {
  ObsAudioSettingsModal,
  ObsClipSettingsModal,
  ObsVideoSettingsModal
} from './ObsSourceSettingsModal'
import type {
  AppSettings,
  ObsConnectionState,
  ObsPluginStatus
} from '../types'

interface PreferencesModalProps {
  settings: AppSettings
  obsConnection: ObsConnectionState
  onObsConnectionChange: (next: ObsConnectionState) => void
  onOpenSetupWizard?: () => void
  onNotify: (msg: string) => void
  onClose: () => void
  onSave: (updated: Partial<AppSettings>) => Promise<void>
}

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  settings,
  obsConnection,
  onObsConnectionChange,
  onOpenSetupWizard,
  onNotify,
  onClose,
  onSave
}) => {
  const [form, setForm] = useState<AppSettings>({
    ...settings,
    obsWebsocketUrl: settings.obsWebsocketUrl || 'ws://127.0.0.1:4455',
    obsWebsocketPassword: settings.obsWebsocketPassword || '',
    selectedObsAudioSourceId: settings.selectedObsAudioSourceId || '',
    selectedObsClipSourceId: settings.selectedObsClipSourceId || '',
    selectedObsVideoSourceId: settings.selectedObsVideoSourceId || '',
    obsPersistentConnect: settings.obsPersistentConnect !== false,
    showSetupWizardOnStartup: settings.showSetupWizardOnStartup !== false
  })
  const [saving, setSaving] = useState(false)
  const [obsBusy, setObsBusy] = useState(false)
  const [obsError, setObsError] = useState('')
  const [pluginStatus, setPluginStatus] = useState<ObsPluginStatus | null>(null)
  const [pluginBusy, setPluginBusy] = useState(false)
  const [showAudioSourceModal, setShowAudioSourceModal] = useState(false)
  const [showClipSourceModal, setShowClipSourceModal] = useState(false)
  const [showVideoSourceModal, setShowVideoSourceModal] = useState(false)

  useEffect(() => {
    window.curationist
      .getObsPluginStatus()
      .then(setPluginStatus)
      .catch(() => {})
  }, [])

  // Keep selected OBS source IDs synced with live discovered sources so deleted/recreated sources never persist stale UUIDs
  useEffect(() => {
    if (obsConnection.sources.length === 0) return
    const audioList = obsConnection.sources.filter((s) => s.kind === 'audio')
    const clipList = obsConnection.sources.filter((s) => s.kind === 'clip')
    const videoList = obsConnection.sources.filter((s) => s.kind === 'video')
    setForm((prev) => ({
      ...prev,
      selectedObsAudioSourceId:
        audioList.length > 0 && !audioList.some((s) => s.sourceId === prev.selectedObsAudioSourceId)
          ? audioList[0].sourceId
          : prev.selectedObsAudioSourceId,
      selectedObsClipSourceId:
        clipList.length > 0 && !clipList.some((s) => s.sourceId === prev.selectedObsClipSourceId)
          ? clipList[0].sourceId
          : prev.selectedObsClipSourceId,
      selectedObsVideoSourceId:
        videoList.length > 0 && !videoList.some((s) => s.sourceId === prev.selectedObsVideoSourceId)
          ? videoList[0].sourceId
          : prev.selectedObsVideoSourceId
    }))
  }, [obsConnection.sources])

  const browseFolder = async (
    key: 'mp3ManagedStoragePath' | 'videoManagedStoragePath' | 'presetManagedStoragePath',
    title: string
  ) => {
    const picked = await window.curationist.pickFolder(title, form[key])
    if (picked) {
      setForm((prev) => ({ ...prev, [key]: picked }))
    }
  }

  const browseFile = async (
    key: 'nowPlaylistingJsonPath' | 'obspiltMilkLibraryJsonPath' | 'obspiltMilkPlaylistDatPath',
    title: string,
    extensions: string[]
  ) => {
    const picked = await window.curationist.pickSaveFile({
      title,
      defaultPath: form[key],
      filters: [{ name: 'Config File', extensions }]
    })
    if (picked) {
      setForm((prev) => ({ ...prev, [key]: picked }))
    }
  }

  const browseMilkdropExe = async () => {
    const picked = await window.curationist.pickFilesOrFolders({
      title: 'Select Local MilkDrop Executable (e.g. MilkDrop 3.exe)',
      mode: 'files',
      defaultPath: form.milkdropExecutablePath,
      filters: [{ name: 'MilkDrop Executable', extensions: ['exe'] }]
    })
    if (picked && picked.length > 0) {
      setForm((prev) => ({ ...prev, milkdropExecutablePath: picked[0] }))
    }
  }

  const handleConnectObs = async () => {
    setObsBusy(true)
    setObsError('')
    try {
      const next = await window.curationist.connectObs(
        form.obsWebsocketUrl || 'ws://127.0.0.1:4455',
        form.obsWebsocketPassword || ''
      )
      onObsConnectionChange(next)
      const audioList = next.sources.filter((s) => s.kind === 'audio')
      const clipList = next.sources.filter((s) => s.kind === 'clip')
      const videoList = next.sources.filter((s) => s.kind === 'video')
      setForm((prev) => ({
        ...prev,
        selectedObsAudioSourceId:
          audioList.some((s) => s.sourceId === prev.selectedObsAudioSourceId)
            ? prev.selectedObsAudioSourceId
            : audioList[0]?.sourceId || '',
        selectedObsClipSourceId:
          clipList.some((s) => s.sourceId === prev.selectedObsClipSourceId)
            ? prev.selectedObsClipSourceId
            : clipList[0]?.sourceId || '',
        selectedObsVideoSourceId:
          videoList.some((s) => s.sourceId === prev.selectedObsVideoSourceId)
            ? prev.selectedObsVideoSourceId
            : videoList[0]?.sourceId || ''
      }))
      onNotify(
        `Connected to OBS WebSocket (${next.sources.length} Curationist source(s) discovered)`
      )
    } catch (err: any) {
      setObsError(err?.message || String(err))
    } finally {
      setObsBusy(false)
    }
  }

  const handleDisconnectObs = async () => {
    setObsBusy(true)
    setObsError('')
    try {
      const next = await window.curationist.disconnectObs()
      onObsConnectionChange(next)
      onNotify('Disconnected from OBS WebSocket')
    } catch (err: any) {
      setObsError(err?.message || String(err))
    } finally {
      setObsBusy(false)
    }
  }

  const handleRefreshObsSources = async () => {
    setObsBusy(true)
    setObsError('')
    try {
      await window.curationist.refreshObsSources()
      const next = await window.curationist.getObsConnectionState()
      onObsConnectionChange(next)
      const audioList = next.sources.filter((s) => s.kind === 'audio')
      const clipList = next.sources.filter((s) => s.kind === 'clip')
      const videoList = next.sources.filter((s) => s.kind === 'video')
      setForm((prev) => ({
        ...prev,
        selectedObsAudioSourceId:
          audioList.some((s) => s.sourceId === prev.selectedObsAudioSourceId)
            ? prev.selectedObsAudioSourceId
            : audioList[0]?.sourceId || '',
        selectedObsClipSourceId:
          clipList.some((s) => s.sourceId === prev.selectedObsClipSourceId)
            ? prev.selectedObsClipSourceId
            : clipList[0]?.sourceId || '',
        selectedObsVideoSourceId:
          videoList.some((s) => s.sourceId === prev.selectedObsVideoSourceId)
            ? prev.selectedObsVideoSourceId
            : videoList[0]?.sourceId || ''
      }))
      onNotify(`Refreshed OBS sources (${next.sources.length} Curationist source(s))`)
    } catch (err: any) {
      setObsError(err?.message || String(err))
    } finally {
      setObsBusy(false)
    }
  }

  const handleInstallObsPlugin = async () => {
    setPluginBusy(true)
    setObsError('')
    try {
      const res = await window.curationist.installObsPlugin()
      const nextStatus = await window.curationist.getObsPluginStatus()
      setPluginStatus(nextStatus)
      onNotify(
        `Installed Curationist OBS Plugin v${res.version} to ${res.destination}. Restart OBS to load Curationist Audio, Video & Visualizer.`
      )
    } catch (err: any) {
      setObsError(err?.message || String(err))
    } finally {
      setPluginBusy(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const audioSources = obsConnection.sources.filter((s) => s.kind === 'audio')
  const clipSources = obsConnection.sources.filter((s) => s.kind === 'clip')
  const videoSources = obsConnection.sources.filter((s) => s.kind === 'video')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-window"
        style={{ width: 760 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <BrandLogo size={18} />
            <span>Preferences — OBS Integration (Curationist Audio, Video &amp; Visualizer) &amp; Storage</span>
          </span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {/* ================================================================ */}
          {/* OBS CONNECTION & NATIVE PLUGIN                                   */}
          {/* ================================================================ */}
          <div
            style={{
              borderBottom: '1px solid #3c3c3c',
              paddingBottom: 6,
              fontWeight: 700,
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span>OBS Connection (Curationist Audio, Video &amp; Visualizer Broadcast)</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                fontWeight: 600,
                color: obsConnection.connected ? '#4ec9b0' : '#8b949e'
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: obsConnection.connected ? '#00e5a3' : '#6e7681',
                  boxShadow: obsConnection.connected ? '0 0 8px #00e5a3' : 'none'
                }}
              />
              {obsConnection.connected ? 'Connected to OBS' : 'Disconnected'}
            </span>
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">WebSocket URL</label>
              <input
                className="vscode-input"
                placeholder="ws://127.0.0.1:4455"
                value={form.obsWebsocketUrl || ''}
                disabled={obsBusy || obsConnection.connected}
                onChange={(e) => setForm({ ...form, obsWebsocketUrl: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">Password (optional)</label>
              <input
                type="password"
                className="vscode-input"
                placeholder="OBS WebSocket server password"
                value={form.obsWebsocketPassword || ''}
                disabled={obsBusy || obsConnection.connected}
                onChange={(e) => setForm({ ...form, obsWebsocketPassword: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {obsConnection.connected ? (
              <>
                <button
                  type="button"
                  className="vscode-btn"
                  disabled={obsBusy}
                  onClick={handleDisconnectObs}
                >
                  <Unplug size={12} /> Disconnect
                </button>
                <button
                  type="button"
                  className="vscode-btn"
                  disabled={obsBusy}
                  onClick={handleRefreshObsSources}
                >
                  <RefreshCw size={12} /> Refresh OBS Sources ({obsConnection.sources.length})
                </button>
              </>
            ) : (
              <button
                type="button"
                className="vscode-btn primary"
                disabled={obsBusy}
                onClick={handleConnectObs}
              >
                <Plug size={12} /> {obsBusy ? 'Connecting...' : 'Connect to OBS'}
              </button>
            )}
            <span style={{ fontSize: 11, color: '#8b949e' }}>
              Enable WebSocket Server in OBS under Tools &rarr; WebSocket Server Settings.
            </span>
            {onOpenSetupWizard && (
              <button
                type="button"
                className="vscode-btn"
                onClick={onOpenSetupWizard}
                style={{ marginLeft: 'auto' }}
              >
                OBS Setup Wizard...
              </button>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              flexWrap: 'wrap',
              padding: '6px 10px',
              background: '#181a20',
              border: '1px solid #303440',
              borderRadius: 3
            }}
          >
            <label className="checkbox-row">
              <input
                type="checkbox"
                className="subtle-checkbox"
                checked={form.obsPersistentConnect !== false}
                onChange={(e) =>
                  setForm({ ...form, obsPersistentConnect: e.target.checked })
                }
              />
              <span>
                Persistent OBS Connection (Auto-connect on startup &amp; poll every 3s to maintain
                connection &amp; refresh OBS source endpoints)
              </span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                className="subtle-checkbox"
                checked={form.showSetupWizardOnStartup !== false}
                onChange={(e) =>
                  setForm({ ...form, showSetupWizardOnStartup: e.target.checked })
                }
              />
              <span>Show Setup Guide on launch</span>
            </label>
          </div>

          {obsError && (
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
              {obsError}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 10
            }}
          >
            <div className="form-field">
              <label className="form-label">Target Curationist Audio Source</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  className="vscode-select"
                  style={{ flex: 1 }}
                  value={form.selectedObsAudioSourceId || audioSources[0]?.sourceId || ''}
                  onChange={(e) =>
                    setForm({ ...form, selectedObsAudioSourceId: e.target.value })
                  }
                >
                  {audioSources.length === 0 ? (
                    <option value="">(None discovered)</option>
                  ) : (
                    audioSources.map((s) => (
                      <option key={s.sourceId} value={s.sourceId}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="vscode-btn"
                  disabled={!obsConnection.connected || audioSources.length === 0}
                  onClick={() => setShowAudioSourceModal(true)}
                  title="Configure Curationist Audio Album Art & Effects"
                >
                  <Sliders size={12} /> Effects
                </button>
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">Target Curationist Video Source</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  className="vscode-select"
                  style={{ flex: 1 }}
                  value={form.selectedObsClipSourceId || clipSources[0]?.sourceId || ''}
                  onChange={(e) =>
                    setForm({ ...form, selectedObsClipSourceId: e.target.value })
                  }
                >
                  {clipSources.length === 0 ? (
                    <option value="">(None discovered)</option>
                  ) : (
                    clipSources.map((s) => (
                      <option key={s.sourceId} value={s.sourceId}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="vscode-btn"
                  disabled={!obsConnection.connected || clipSources.length === 0}
                  onClick={() => setShowClipSourceModal(true)}
                  title="Configure Curationist Video Loop & Shuffle Settings"
                >
                  <Sliders size={12} /> Modes
                </button>
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">Target Curationist Visualizer Source</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  className="vscode-select"
                  style={{ flex: 1 }}
                  value={form.selectedObsVideoSourceId || videoSources[0]?.sourceId || ''}
                  onChange={(e) =>
                    setForm({ ...form, selectedObsVideoSourceId: e.target.value })
                  }
                >
                  {videoSources.length === 0 ? (
                    <option value="">(None discovered)</option>
                  ) : (
                    videoSources.map((s) => (
                      <option key={s.sourceId} value={s.sourceId}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="vscode-btn"
                  disabled={!obsConnection.connected || videoSources.length === 0}
                  onClick={() => setShowVideoSourceModal(true)}
                  title="Configure Curationist Visualizer Audio Driver & Resolution"
                >
                  <Sliders size={12} /> Driver
                </button>
              </div>
            </div>
          </div>

          {/* Native Integration: Curationist OBS Plugin */}
          <div
            style={{
              background: '#1a1b1f',
              border: '1px solid #383b44',
              borderRadius: 4,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8
              }}
            >
              <div>
                <strong style={{ color: '#ffffff', fontSize: 12 }}>
                  Native Integration — Curationist OBS Plugin (Audio, Video &amp; Visualizer Sources)
                </strong>
                <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
                  Status:{' '}
                  <strong
                    style={{
                      color: pluginStatus?.installedHealthy ? '#4ec9b0' : '#e2c08d'
                    }}
                  >
                    {pluginStatus?.installedHealthy
                      ? `Installed (v${pluginStatus.installedVersion})`
                      : pluginStatus?.installedVersion
                        ? `Update Required (v${pluginStatus.installedVersion} → v${pluginStatus.payloadVersion})`
                        : 'Not installed'}
                  </strong>
                  {pluginStatus?.obs && (
                    <span>
                      {' '}
                      • OBS Studio {pluginStatus.obs.version} ({pluginStatus.obs.path})
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="vscode-btn"
                  disabled={pluginBusy}
                  onClick={async () => {
                    const next = await window.curationist.selectObsExecutable()
                    setPluginStatus(next)
                  }}
                >
                  <FolderOpen size={12} /> Select OBS...
                </button>
                <button
                  type="button"
                  className="vscode-btn primary"
                  disabled={pluginBusy}
                  onClick={handleInstallObsPlugin}
                >
                  <Download size={12} />{' '}
                  {pluginBusy
                    ? 'Installing...'
                    : pluginStatus?.installedVersion
                      ? 'Reinstall / Update OBS Plugin'
                      : 'Install OBS Plugin'}
                </button>
              </div>
            </div>
            {pluginStatus && (
              <div
                style={{
                  fontSize: 11,
                  color: pluginStatus.message.includes('restart OBS')
                    ? '#e2c08d'
                    : pluginStatus.installedHealthy
                      ? '#9aa2ae'
                      : '#f14c4c'
                }}
              >
                {pluginStatus.message} (Target: <code>{pluginStatus.destination}</code>)
              </div>
            )}
          </div>

          {/* ================================================================ */}
          {/* MANAGED MEDIA STORAGE & LEGACY PUBLISH TARGETS                   */}
          {/* ================================================================ */}
          <div
            style={{
              borderBottom: '1px solid #3c3c3c',
              paddingBottom: 6,
              marginTop: 6,
              fontWeight: 700,
              color: '#ffffff'
            }}
          >
            Managed Media Storage &amp; OBS Target Files
          </div>

          <div className="form-field full">
            <label className="form-label">
              MP3 Managed Storage Folder (Default: USERPROFILE\Music\obs-managed)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                value={form.mp3ManagedStoragePath}
                onChange={(e) =>
                  setForm({ ...form, mp3ManagedStoragePath: e.target.value })
                }
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFolder(
                    'mp3ManagedStoragePath',
                    'Select Managed MP3 Storage Folder'
                  )
                }
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <div className="form-field full">
            <label className="form-label">
              Video Managed Storage Folder (Default: USERPROFILE\Videos\obs-managed)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                value={form.videoManagedStoragePath}
                onChange={(e) =>
                  setForm({ ...form, videoManagedStoragePath: e.target.value })
                }
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFolder(
                    'videoManagedStoragePath',
                    'Select Managed Video Storage Folder'
                  )
                }
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <div className="form-field full">
            <label className="form-label">
              Presets Managed Storage Folder (Default:
              AppData\Roaming\obs-studio\plugin_config\obspiltMilk\presets)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                value={form.presetManagedStoragePath}
                onChange={(e) =>
                  setForm({ ...form, presetManagedStoragePath: e.target.value })
                }
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFolder(
                    'presetManagedStoragePath',
                    'Select Managed Presets Storage Folder'
                  )
                }
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <div className="form-field full">
            <label className="form-label">
              nowPlaylisting Active Playlists File (saved-playlists.json)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                value={form.nowPlaylistingJsonPath}
                onChange={(e) =>
                  setForm({ ...form, nowPlaylistingJsonPath: e.target.value })
                }
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFile(
                    'nowPlaylistingJsonPath',
                    'Select saved-playlists.json Path',
                    ['json']
                  )
                }
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <div className="form-field full">
            <label className="form-label">
              obSpiltMilk Preset Library Index (library.json)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                value={form.obspiltMilkLibraryJsonPath}
                onChange={(e) =>
                  setForm({ ...form, obspiltMilkLibraryJsonPath: e.target.value })
                }
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFile(
                    'obspiltMilkLibraryJsonPath',
                    'Select library.json Path',
                    ['json']
                  )
                }
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <div className="form-field full">
            <label className="form-label">
              obSpiltMilk Active Playlist File (playlist.dat)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                value={form.obspiltMilkPlaylistDatPath}
                onChange={(e) =>
                  setForm({ ...form, obspiltMilkPlaylistDatPath: e.target.value })
                }
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFile(
                    'obspiltMilkPlaylistDatPath',
                    'Select playlist.dat Path',
                    ['dat', 'txt']
                  )
                }
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <div className="form-field full">
            <label className="form-label">Local MilkDrop Executable Path</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                placeholder="E:\Desktop\MilkDrop 3.33\MilkDrop 3.exe"
                value={form.milkdropExecutablePath || ''}
                onChange={(e) =>
                  setForm({ ...form, milkdropExecutablePath: e.target.value })
                }
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={browseMilkdropExe}
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              className="subtle-checkbox"
              checked={form.copyMp3ToManagedByDefault}
              onChange={(e) =>
                setForm({ ...form, copyMp3ToManagedByDefault: e.target.checked })
              }
            />
            <span>
              Default &ldquo;Copy to Managed Storage&rdquo; checkbox to ON when importing
              MP3s
            </span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              className="subtle-checkbox"
              checked={form.copyVideoToManagedByDefault}
              onChange={(e) =>
                setForm({ ...form, copyVideoToManagedByDefault: e.target.checked })
              }
            />
            <span>
              Default &ldquo;Copy to Managed Storage&rdquo; checkbox to ON when importing
              Videos
            </span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              className="subtle-checkbox"
              checked={form.copyPresetToManagedByDefault}
              onChange={(e) =>
                setForm({
                  ...form,
                  copyPresetToManagedByDefault: e.target.checked
                })
              }
            />
            <span>
              Default &ldquo;Copy validated/repaired .milk to Managed Storage&rdquo;
              checkbox to ON when importing Presets
            </span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              className="subtle-checkbox"
              checked={form.playlistDatUseManagedPaths}
              onChange={(e) =>
                setForm({ ...form, playlistDatUseManagedPaths: e.target.checked })
              }
            />
            <span>
              Write repaired managed preset file paths to playlist.dat on Publish
            </span>
          </label>
        </div>

        <div className="modal-footer">
          <button type="button" className="vscode-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="vscode-btn primary" disabled={saving}>
            <Save size={13} /> {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </form>

      {showAudioSourceModal && (
        <ObsAudioSettingsModal
          sourceId={form.selectedObsAudioSourceId || audioSources[0]?.sourceId || ''}
          sources={obsConnection.sources}
          onSelectSourceId={(id) =>
            setForm((prev) => ({ ...prev, selectedObsAudioSourceId: id }))
          }
          onClose={() => setShowAudioSourceModal(false)}
          onNotify={onNotify}
        />
      )}

      {showClipSourceModal && (
        <ObsClipSettingsModal
          sourceId={form.selectedObsClipSourceId || clipSources[0]?.sourceId || ''}
          sources={obsConnection.sources}
          onSelectSourceId={(id) =>
            setForm((prev) => ({ ...prev, selectedObsClipSourceId: id }))
          }
          onClose={() => setShowClipSourceModal(false)}
          onNotify={onNotify}
        />
      )}

      {showVideoSourceModal && (
        <ObsVideoSettingsModal
          sourceId={form.selectedObsVideoSourceId || videoSources[0]?.sourceId || ''}
          sources={obsConnection.sources}
          onSelectSourceId={(id) =>
            setForm((prev) => ({ ...prev, selectedObsVideoSourceId: id }))
          }
          onClose={() => setShowVideoSourceModal(false)}
          onNotify={onNotify}
        />
      )}
    </div>
  )
}
