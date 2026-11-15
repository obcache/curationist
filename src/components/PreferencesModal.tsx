import React, { useState } from 'react'
import { FolderOpen, Save, X } from 'lucide-react'
import { BrandLogo } from './BrandLogo'
import type { AppSettings } from '../types'

interface PreferencesModalProps {
  settings: AppSettings
  onClose: () => void
  onSave: (updated: Partial<AppSettings>) => Promise<void>
}

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  settings,
  onClose,
  onSave
}) => {
  const [form, setForm] = useState<AppSettings>({ ...settings })
  const [saving, setSaving] = useState(false)

  const browseFolder = async (key: 'mp3ManagedStoragePath' | 'presetManagedStoragePath', title: string) => {
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-window"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <BrandLogo size={18} />
            <span>Preferences — Managed Storage &amp; OBS Plugin Paths</span>
          </span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ borderBottom: '1px solid #3c3c3c', paddingBottom: 6, fontWeight: 700, color: '#ffffff' }}>
            Managed Media Storage Locations
          </div>

          <div className="form-field full">
            <label className="form-label">
              MP3 Managed Storage Folder (Default: USERPROFILE\Music\obs-managed)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                value={form.mp3ManagedStoragePath}
                onChange={(e) => setForm({ ...form, mp3ManagedStoragePath: e.target.value })}
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() => browseFolder('mp3ManagedStoragePath', 'Select Managed MP3 Storage Folder')}
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <div className="form-field full">
            <label className="form-label">
              obSpiltMilk Presets Managed Storage Folder (Default: AppData\Roaming\obs-studio\plugin_config\obspiltMilk\presets)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                value={form.presetManagedStoragePath}
                onChange={(e) => setForm({ ...form, presetManagedStoragePath: e.target.value })}
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFolder('presetManagedStoragePath', 'Select Managed Presets Storage Folder')
                }
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #3c3c3c', paddingBottom: 6, marginTop: 6, fontWeight: 700, color: '#ffffff' }}>
            OBS Plugin Target Files (Publish Targets)
          </div>

          <div className="form-field full">
            <label className="form-label">
              nowPlaylisting Active Playlists File (saved-playlists.json)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                value={form.nowPlaylistingJsonPath}
                onChange={(e) => setForm({ ...form, nowPlaylistingJsonPath: e.target.value })}
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFile('nowPlaylistingJsonPath', 'Select saved-playlists.json Path', ['json'])
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
                onChange={(e) => setForm({ ...form, obspiltMilkLibraryJsonPath: e.target.value })}
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFile('obspiltMilkLibraryJsonPath', 'Select library.json Path', ['json'])
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
                onChange={(e) => setForm({ ...form, obspiltMilkPlaylistDatPath: e.target.value })}
              />
              <button
                type="button"
                className="vscode-btn"
                onClick={() =>
                  browseFile('obspiltMilkPlaylistDatPath', 'Select playlist.dat Path', ['dat', 'txt'])
                }
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #3c3c3c', paddingBottom: 6, marginTop: 6, fontWeight: 700, color: '#ffffff' }}>
            External Preset Visualizer (MilkDrop Previewer)
          </div>

          <div className="form-field full">
            <label className="form-label">
              Local MilkDrop Executable Path (Launches with StartPreset or switches preset live via XMD3X IPC if already running)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="vscode-input"
                placeholder="E:\Desktop\MilkDrop 3.33\MilkDrop 3.exe"
                value={form.milkdropExecutablePath || ''}
                onChange={(e) => setForm({ ...form, milkdropExecutablePath: e.target.value })}
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

          <div style={{ borderBottom: '1px solid #3c3c3c', paddingBottom: 6, marginTop: 6, fontWeight: 700, color: '#ffffff' }}>
            Import &amp; Publish Behavior Defaults
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.copyMp3ToManagedByDefault}
              onChange={(e) => setForm({ ...form, copyMp3ToManagedByDefault: e.target.checked })}
            />
            <span>Default &ldquo;Copy to Managed Storage&rdquo; checkbox to ON when importing MP3s</span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.copyPresetToManagedByDefault}
              onChange={(e) => setForm({ ...form, copyPresetToManagedByDefault: e.target.checked })}
            />
            <span>
              Default &ldquo;Copy validated/repaired .milk to Managed Storage&rdquo; checkbox to ON when importing Presets
            </span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.playlistDatUseManagedPaths}
              onChange={(e) => setForm({ ...form, playlistDatUseManagedPaths: e.target.checked })}
            />
            <span>
              Write repaired managed preset file paths to playlist.dat on Publish (recommended for projectM shader compatibility)
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
    </div>
  )
}
