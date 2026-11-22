import React, { useState } from 'react'
import {
  FolderOpen,
  FolderPlus,
  HardDrive,
  Plus,
  Settings2,
  Trash2,
  X
} from 'lucide-react'
import type { AppSettings, ManagedStorageFolder } from '../types'

interface ManagedStorageSelectorProps {
  domain: 'music' | 'video' | 'presets'
  settings: AppSettings
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onNotify: (msg: string) => void
}

export const ManagedStorageSelector: React.FC<ManagedStorageSelectorProps> = ({
  domain,
  settings,
  onUpdateSettings,
  onNotify
}) => {
  const [showManageModal, setShowManageModal] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newPath, setNewPath] = useState('')

  const folders = settings.managedStorageFolders || []
  const selectedId =
    domain === 'music'
      ? settings.selectedMp3StorageFolderId
      : domain === 'video'
        ? settings.selectedVideoStorageFolderId
        : settings.selectedPresetStorageFolderId
  const transferMode =
    domain === 'music'
      ? settings.mp3ManagedTransferMode || 'copy'
      : domain === 'video'
        ? settings.videoManagedTransferMode || 'copy'
        : settings.presetManagedTransferMode || 'copy'

  const activeFolder =
    folders.find((f) => f.id === selectedId) || folders[0] || null

  const handleSelectFolder = async (folderId: string) => {
    const f = folders.find((item) => item.id === folderId)
    if (domain === 'music') {
      await onUpdateSettings({
        selectedMp3StorageFolderId: folderId,
        ...(f ? { mp3ManagedStoragePath: f.path } : {})
      })
    } else if (domain === 'video') {
      await onUpdateSettings({
        selectedVideoStorageFolderId: folderId,
        ...(f ? { videoManagedStoragePath: f.path } : {})
      })
    } else {
      await onUpdateSettings({
        selectedPresetStorageFolderId: folderId
      })
    }
  }

  const handleSetTransferMode = async (mode: 'copy' | 'move') => {
    if (domain === 'music') {
      await onUpdateSettings({ mp3ManagedTransferMode: mode })
    } else if (domain === 'video') {
      await onUpdateSettings({ videoManagedTransferMode: mode })
    } else {
      await onUpdateSettings({ presetManagedTransferMode: mode })
    }
  }

  const handleBrowseNewFolder = async () => {
    const picked = await window.curationist.pickFolder(
      'Select Local Folder for Managed Storage Consolidation',
      newPath || activeFolder?.path
    )
    if (picked) {
      setNewPath(picked)
      if (!newLabel.trim()) {
        const parts = picked.replace(/\\/g, '/').split('/').filter(Boolean)
        setNewLabel(parts[parts.length - 1] || 'Managed Storage')
      }
    }
  }

  const handleAddFolder = async () => {
    const label = newLabel.trim()
    const folderPath = newPath.trim()
    if (!label || !folderPath) {
      onNotify('Please provide both a label and a local folder path.')
      return
    }
    const id = `storage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const nextFolders: ManagedStorageFolder[] = [
      ...folders,
      { id, label, path: folderPath }
    ]
    const partial: Partial<AppSettings> = {
      managedStorageFolders: nextFolders
    }
    if (domain === 'music') {
      partial.selectedMp3StorageFolderId = id
      partial.mp3ManagedStoragePath = folderPath
    } else if (domain === 'video') {
      partial.selectedVideoStorageFolderId = id
      partial.videoManagedStoragePath = folderPath
    } else {
      partial.selectedPresetStorageFolderId = id
    }
    await onUpdateSettings(partial)
    setNewLabel('')
    setNewPath('')
    onNotify(`Added managed storage folder "${label}" (${folderPath})`)
  }

  const handleUpdateFolderEntry = async (
    id: string,
    patch: Partial<ManagedStorageFolder>
  ) => {
    const nextFolders = folders.map((f) => (f.id === id ? { ...f, ...patch } : f))
    await onUpdateSettings({ managedStorageFolders: nextFolders })
  }

  const handleDeleteFolderEntry = async (id: string) => {
    if (folders.length <= 1) {
      onNotify('At least one managed storage folder pointer must remain configured.')
      return
    }
    const nextFolders = folders.filter((f) => f.id !== id)
    const partial: Partial<AppSettings> = {
      managedStorageFolders: nextFolders
    }
    if (settings.selectedMp3StorageFolderId === id) {
      partial.selectedMp3StorageFolderId = nextFolders[0].id
      partial.mp3ManagedStoragePath = nextFolders[0].path
    }
    if (settings.selectedVideoStorageFolderId === id) {
      partial.selectedVideoStorageFolderId = nextFolders[0].id
      partial.videoManagedStoragePath = nextFolders[0].path
    }
    if (settings.selectedPresetStorageFolderId === id) {
      partial.selectedPresetStorageFolderId = nextFolders[0].id
    }
    await onUpdateSettings(partial)
    onNotify('Removed managed storage folder pointer')
  }

  return (
    <>
      <div className="managed-storage-selector-bar">
        <span
          className="managed-storage-label"
          title={
            activeFolder
              ? `Target Consolidation Path: ${activeFolder.path}`
              : 'Select target consolidation folder'
          }
        >
          <HardDrive size={12} />
          Selected Storage:
        </span>

        <select
          className="vscode-select managed-storage-select"
          value={activeFolder?.id || ''}
          onChange={(e) => handleSelectFolder(e.target.value)}
          title={
            activeFolder
              ? `${activeFolder.label} — ${activeFolder.path}`
              : 'Select Managed Storage Folder'
          }
        >
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} ({f.path})
            </option>
          ))}
        </select>

        <button
          type="button"
          className="vscode-btn"
          style={{ padding: '3px 7px' }}
          onClick={() => setShowManageModal(true)}
          title="Add or Manage Local Storage Folder Pointers"
        >
          <FolderPlus size={12} />
          <Settings2 size={11} />
        </button>

        <div
          className="managed-transfer-toggle"
          title="Toggle whether consolidating files copies them or moves them (deleting the original source file)"
        >
          <button
            type="button"
            className={`transfer-mode-btn ${transferMode === 'copy' ? 'active' : ''}`}
            onClick={() => handleSetTransferMode('copy')}
          >
            Copy
          </button>
          <button
            type="button"
            className={`transfer-mode-btn ${transferMode === 'move' ? 'active move' : ''}`}
            onClick={() => handleSetTransferMode('move')}
          >
            Move
          </button>
        </div>
      </div>

      {showManageModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowManageModal(false)}
        >
          <div
            className="modal-window"
            style={{ width: 640, maxWidth: '94vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span>Managed Storage Folders (Local Filesystem Pointers)</span>
              <button
                className="icon-btn"
                onClick={() => setShowManageModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                Managed Storage Folders are user-labeled pointers to directories on your local filesystem.
                Selecting a storage folder from the droplist and clicking{' '}
                <strong>Copy to Managed</strong> (or <strong>Move to Managed</strong>) copies or moves
                selected files directly into that directory using their normal filenames.
              </div>

              <div
                style={{
                  padding: 12,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                  Add New Managed Storage Folder
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="vscode-input"
                    style={{ width: 170 }}
                    placeholder="Label (e.g. Main Audio)"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                  <input
                    className="vscode-input"
                    style={{ flex: 1, minWidth: 220 }}
                    placeholder="Local folder path (e.g. D:\Media\Consolidated)"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                  />
                  <button
                    type="button"
                    className="vscode-btn"
                    onClick={handleBrowseNewFolder}
                  >
                    <FolderOpen size={12} /> Browse...
                  </button>
                  <button
                    type="button"
                    className="vscode-btn primary"
                    onClick={handleAddFolder}
                    disabled={!newLabel.trim() || !newPath.trim()}
                  >
                    <Plus size={12} /> Add Folder
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                  Configured Storage Folders ({folders.length})
                </div>
                {folders.map((folder) => {
                  const isActive = activeFolder?.id === folder.id
                  return (
                    <div
                      key={folder.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 10px',
                        background: isActive ? 'rgba(14, 99, 156, 0.16)' : 'var(--bg-sidebar)',
                        border: `1px solid ${isActive ? 'var(--accent-blue)' : 'var(--border-color)'}`,
                        borderRadius: 4
                      }}
                    >
                      <input
                        className="vscode-input"
                        style={{ width: 155, fontWeight: 600 }}
                        value={folder.label}
                        onChange={(e) =>
                          handleUpdateFolderEntry(folder.id, { label: e.target.value })
                        }
                        title="User-defined storage label"
                      />
                      <input
                        className="vscode-input"
                        style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                        value={folder.path}
                        onChange={(e) =>
                          handleUpdateFolderEntry(folder.id, { path: e.target.value })
                        }
                        title="Target local filesystem path"
                      />
                      <button
                        type="button"
                        className="vscode-btn"
                        title="Browse local folder"
                        onClick={async () => {
                          const picked = await window.curationist.pickFolder(
                            `Select Folder for "${folder.label}"`,
                            folder.path
                          )
                          if (picked) {
                            await handleUpdateFolderEntry(folder.id, { path: picked })
                          }
                        }}
                      >
                        <FolderOpen size={12} />
                      </button>
                      <button
                        type="button"
                        className={`vscode-btn ${isActive ? 'primary' : ''}`}
                        onClick={() => handleSelectFolder(folder.id)}
                      >
                        {isActive ? 'Selected' : 'Select'}
                      </button>
                      <button
                        type="button"
                        className="vscode-btn danger"
                        disabled={folders.length <= 1}
                        onClick={() => handleDeleteFolderEntry(folder.id)}
                        title="Remove folder pointer (does not delete files on disk)"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="vscode-btn primary"
                onClick={() => setShowManageModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
