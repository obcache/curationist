import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ImportBatchResult,
  LogEntry,
  LogLevel,
  LogsSnapshot,
  Mp3DetailedMetadata,
  Mp3TagUpdatePayload,
  MusicWorkspaceState,
  ObsAudioDriver,
  ObsAudioSettings,
  ObsConnectionState,
  ObsControlPayload,
  ObsPluginInstallResult,
  ObsPluginStatus,
  ObsQueue,
  ObsQueuePublishMode,
  ObsSource,
  ObsStatus,
  ObsVideoSettings,
  PresetInspectionResult,
  PresetWorkspaceState,
  PreviewPresetResult,
  VideoWorkspaceState
} from '../src/types'

const api = {
  // Window & Shell
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize') as Promise<boolean>,
  closeWindow: () => ipcRenderer.invoke('window:close'),
  showItemInFolder: (fullPath: string) => ipcRenderer.invoke('shell:showItemInFolder', fullPath),
  onOpenPreferencesMenu: (cb: () => void): (() => void) => {
    const handler = () => cb()
    ipcRenderer.on('menu:open-preferences', handler)
    return () => {
      ipcRenderer.removeListener('menu:open-preferences', handler)
    }
  },
  onToggleOutputLogMenu: (cb: () => void): (() => void) => {
    const handler = () => cb()
    ipcRenderer.on('menu:toggle-output-log', handler)
    return () => {
      ipcRenderer.removeListener('menu:toggle-output-log', handler)
    }
  },

  // Activity & Persistent File Logs
  getLogsSnapshot: () => ipcRenderer.invoke('logs:getSnapshot') as Promise<LogsSnapshot>,
  appendLog: (level: LogLevel, category: string, message: string, details?: string) =>
    ipcRenderer.invoke('logs:append', level, category, message, details) as Promise<LogEntry>,
  clearLogs: () => ipcRenderer.invoke('logs:clear') as Promise<LogsSnapshot>,
  openLogFile: () => ipcRenderer.invoke('logs:openFile') as Promise<boolean>,
  revealLogFile: () => ipcRenderer.invoke('logs:revealFile') as Promise<boolean>,
  onLogEntry: (cb: (entry: LogEntry) => void): (() => void) => {
    const handler = (_e: unknown, entry: LogEntry) => cb(entry)
    ipcRenderer.on('logs:entry', handler)
    return () => {
      ipcRenderer.removeListener('logs:entry', handler)
    }
  },

  // Dialogs
  pickFolder: (title: string, defaultPath?: string) =>
    ipcRenderer.invoke('dialog:pickFolder', title, defaultPath) as Promise<string | null>,
  pickFilesOrFolders: (options: {
    title: string
    mode: 'files' | 'folder'
    filters?: Array<{ name: string; extensions: string[] }>
    defaultPath?: string
  }) => ipcRenderer.invoke('dialog:pickFilesOrFolders', options) as Promise<string[]>,
  pickSaveFile: (options: {
    title: string
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => ipcRenderer.invoke('dialog:pickSaveFile', options) as Promise<string | null>,
  pickCoverArtImage: () =>
    ipcRenderer.invoke('dialog:pickCoverArtImage') as Promise<{ mime: string; base64: string } | null>,

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  updateSettings: (partial: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:update', partial) as Promise<AppSettings>,

  // Music / nowPlaylisting
  getMusicState: () => ipcRenderer.invoke('music:getState') as Promise<MusicWorkspaceState>,
  getTrackCoverArt: (trackId: string) =>
    ipcRenderer.invoke('music:getTrackCoverArt', trackId) as Promise<{ mime: string; base64: string } | null>,
  createMp3Library: (name: string, desc?: string) =>
    ipcRenderer.invoke('music:createLibrary', name, desc) as Promise<MusicWorkspaceState>,
  renameMp3Library: (id: string, name: string) =>
    ipcRenderer.invoke('music:renameLibrary', id, name) as Promise<MusicWorkspaceState>,
  deleteMp3Library: (id: string) =>
    ipcRenderer.invoke('music:deleteLibrary', id) as Promise<MusicWorkspaceState>,
  importMp3Media: (
    paths: string[],
    libraryId: string,
    copyToManaged: boolean,
    options?: { targetFolderPath?: string; move?: boolean }
  ) =>
    ipcRenderer.invoke('music:importMedia', paths, libraryId, copyToManaged, options) as Promise<{
      batch: ImportBatchResult
      state: MusicWorkspaceState
    }>,
  copyMp3ToManaged: (
    trackIds: string[],
    options?: { targetFolderPath?: string; move?: boolean }
  ) =>
    ipcRenderer.invoke('music:copyToManaged', trackIds, options) as Promise<{
      copied: number
      errors: string[]
      state: MusicWorkspaceState
    }>,
  removeMp3Tracks: (trackIds: string[], deleteManaged = false) =>
    ipcRenderer.invoke('music:removeTracks', trackIds, deleteManaged) as Promise<MusicWorkspaceState>,
  deleteMp3TracksFromDisk: (trackIds: string[]) =>
    ipcRenderer.invoke('music:deleteTracksFromDisk', trackIds) as Promise<{
      deleted: number
      errors: string[]
      state: MusicWorkspaceState
    }>,
  deleteMusicPlaylistItemsFromDisk: (playlistId: string, itemIds: string[]) =>
    ipcRenderer.invoke('music:deletePlaylistItemsFromDisk', playlistId, itemIds) as Promise<{
      deleted: number
      errors: string[]
      state: MusicWorkspaceState
    }>,
  updateMp3Tags: (payload: Mp3TagUpdatePayload) =>
    ipcRenderer.invoke('music:updateTags', payload) as Promise<{
      updated: number
      errors: string[]
      state: MusicWorkspaceState
    }>,
  setMp3TracksRating: (trackIds: string[], rating: number) =>
    ipcRenderer.invoke('music:setRating', trackIds, rating) as Promise<{
      updated: number
      errors: string[]
      state: MusicWorkspaceState
    }>,
  inspectMp3TrackMetadata: (trackId: string) =>
    ipcRenderer.invoke('music:inspectTrackMetadata', trackId) as Promise<{
      detail: Mp3DetailedMetadata | null
      state: MusicWorkspaceState
    }>,
  refreshMp3Metadata: (trackIds?: string[]) =>
    ipcRenderer.invoke('music:refreshMetadata', trackIds) as Promise<{
      refreshed: number
      errors: string[]
      state: MusicWorkspaceState
    }>,
  importMusicJsonFile: (filePath: string, markActive: boolean) =>
    ipcRenderer.invoke('music:importJsonFile', filePath, markActive) as Promise<{
      importedPlaylists: number
      importedTracks: number
      state: MusicWorkspaceState
    }>,
  createMusicPlaylist: (name: string, addToActive = false) =>
    ipcRenderer.invoke('music:createPlaylist', name, addToActive) as Promise<{
      newId: string
      state: MusicWorkspaceState
    }>,
  renameMusicPlaylist: (id: string, newName: string) =>
    ipcRenderer.invoke('music:renamePlaylist', id, newName) as Promise<MusicWorkspaceState>,
  duplicateMusicPlaylist: (id: string) =>
    ipcRenderer.invoke('music:duplicatePlaylist', id) as Promise<{
      newId: string
      state: MusicWorkspaceState
    }>,
  deleteMusicPlaylist: (id: string) =>
    ipcRenderer.invoke('music:deletePlaylist', id) as Promise<MusicWorkspaceState>,
  addTracksToMusicPlaylist: (playlistId: string, trackIds: string[], pos?: number) =>
    ipcRenderer.invoke('music:addTracksToPlaylist', playlistId, trackIds, pos) as Promise<MusicWorkspaceState>,
  removeItemsFromMusicPlaylist: (playlistId: string, itemIds: string[]) =>
    ipcRenderer.invoke('music:removeItemsFromPlaylist', playlistId, itemIds) as Promise<MusicWorkspaceState>,
  reorderMusicPlaylistItems: (playlistId: string, orderedIds: string[]) =>
    ipcRenderer.invoke('music:reorderPlaylistItems', playlistId, orderedIds) as Promise<MusicWorkspaceState>,
  updateMusicPlaylistItemInline: (
    itemId: string,
    updates: { artist?: string; title?: string; show_tags?: boolean }
  ) =>
    ipcRenderer.invoke('music:updatePlaylistItemInline', itemId, updates) as Promise<MusicWorkspaceState>,
  setActiveMusicJsonPlaylists: (orderedPlaylistIds: string[]) =>
    ipcRenderer.invoke('music:setActiveJsonPlaylists', orderedPlaylistIds) as Promise<MusicWorkspaceState>,
  publishMusicPlaylists: () =>
    ipcRenderer.invoke('music:publishSavedPlaylists') as Promise<{
      publishedPlaylists: number
      path: string
      state: MusicWorkspaceState
    }>,
  exportSingleMusicPlaylist: (playlistId: string, targetPath: string) =>
    ipcRenderer.invoke('music:exportSinglePlaylist', playlistId, targetPath) as Promise<boolean>,
  discardMusicDraft: () =>
    ipcRenderer.invoke('music:discardDraft') as Promise<MusicWorkspaceState>,

  // Presets / obSpiltMilk
  getPresetState: () => ipcRenderer.invoke('presets:getState') as Promise<PresetWorkspaceState>,
  createPresetLibrary: (name: string, desc?: string) =>
    ipcRenderer.invoke('presets:createLibrary', name, desc) as Promise<PresetWorkspaceState>,
  renamePresetLibrary: (id: string, name: string) =>
    ipcRenderer.invoke('presets:renameLibrary', id, name) as Promise<PresetWorkspaceState>,
  deletePresetLibrary: (id: string) =>
    ipcRenderer.invoke('presets:deleteLibrary', id) as Promise<PresetWorkspaceState>,
  importPresets: (
    paths: string[],
    libraryId: string,
    copyToManaged: boolean,
    options?: { targetFolderPath?: string; move?: boolean }
  ) =>
    ipcRenderer.invoke('presets:importPresets', paths, libraryId, copyToManaged, options) as Promise<{
      batch: ImportBatchResult
      state: PresetWorkspaceState
    }>,
  importPresetLibraryJson: (jsonPath: string, libraryId: string) =>
    ipcRenderer.invoke('presets:importLibraryJson', jsonPath, libraryId) as Promise<{
      imported: number
      state: PresetWorkspaceState
    }>,
  importPresetPlaylistDat: (datPath: string, playlistName: string, markActive: boolean) =>
    ipcRenderer.invoke('presets:importPlaylistDat', datPath, playlistName, markActive) as Promise<{
      playlistId: string
      itemCount: number
      state: PresetWorkspaceState
    }>,
  copyPresetsToManaged: (
    presetIds: string[],
    libraryId?: string,
    options?: { targetFolderPath?: string; move?: boolean }
  ) =>
    ipcRenderer.invoke('presets:copyToManaged', presetIds, libraryId, options) as Promise<{
      copied: number
      errors: string[]
      state: PresetWorkspaceState
    }>,
  setPresetsRating: (presetIds: string[], rating: number) =>
    ipcRenderer.invoke('presets:setRating', presetIds, rating) as Promise<PresetWorkspaceState>,
  relabelPreset: (presetId: string, newLabel: string) =>
    ipcRenderer.invoke('presets:relabel', presetId, newLabel) as Promise<PresetWorkspaceState>,
  removePresets: (presetIds: string[], libraryId?: string) =>
    ipcRenderer.invoke('presets:removePresets', presetIds, libraryId) as Promise<PresetWorkspaceState>,
  deletePresetsFromDisk: (presetIds: string[], libraryId?: string) =>
    ipcRenderer.invoke('presets:deletePresetsFromDisk', presetIds, libraryId) as Promise<{
      deleted: number
      errors: string[]
      state: PresetWorkspaceState
    }>,
  deletePresetPlaylistItemsFromDisk: (playlistId: string, itemIds: string[]) =>
    ipcRenderer.invoke('presets:deletePlaylistItemsFromDisk', playlistId, itemIds) as Promise<{
      deleted: number
      errors: string[]
      state: PresetWorkspaceState
    }>,
  inspectPreset: (presetId: string) =>
    ipcRenderer.invoke('presets:inspect', presetId) as Promise<PresetInspectionResult>,
  previewPresetInMilkdrop: (presetIdOrPath: string) =>
    ipcRenderer.invoke('presets:previewInMilkdrop', presetIdOrPath) as Promise<PreviewPresetResult>,
  createPresetPlaylist: (name: string, setAsActive = false) =>
    ipcRenderer.invoke('presets:createPlaylist', name, setAsActive) as Promise<{
      newId: string
      state: PresetWorkspaceState
    }>,
  renamePresetPlaylist: (id: string, newName: string) =>
    ipcRenderer.invoke('presets:renamePlaylist', id, newName) as Promise<PresetWorkspaceState>,
  duplicatePresetPlaylist: (id: string) =>
    ipcRenderer.invoke('presets:duplicatePlaylist', id) as Promise<{
      newId: string
      state: PresetWorkspaceState
    }>,
  deletePresetPlaylist: (id: string) =>
    ipcRenderer.invoke('presets:deletePlaylist', id) as Promise<PresetWorkspaceState>,
  setActivePresetPlaylist: (id: string) =>
    ipcRenderer.invoke('presets:setActivePlaylist', id) as Promise<PresetWorkspaceState>,
  addPresetsToPlaylist: (playlistId: string, presetIds: string[], pos?: number) =>
    ipcRenderer.invoke('presets:addPresetsToPlaylist', playlistId, presetIds, pos) as Promise<PresetWorkspaceState>,
  removeItemsFromPresetPlaylist: (playlistId: string, itemIds: string[]) =>
    ipcRenderer.invoke('presets:removeItemsFromPlaylist', playlistId, itemIds) as Promise<PresetWorkspaceState>,
  reorderPresetPlaylistItems: (playlistId: string, orderedIds: string[]) =>
    ipcRenderer.invoke('presets:reorderPlaylistItems', playlistId, orderedIds) as Promise<PresetWorkspaceState>,
  publishPresets: () =>
    ipcRenderer.invoke('presets:publish') as Promise<{
      libraryPresetsWritten: number
      playlistItemsWritten: number
      libraryJsonPath: string
      playlistDatPath: string
      state: PresetWorkspaceState
    }>,
  discardPresetDraft: () =>
    ipcRenderer.invoke('presets:discardDraft') as Promise<PresetWorkspaceState>,
  getProjectMPort: () => ipcRenderer.invoke('projectm:getPort') as Promise<number>,

  // milkLab Preset IDE Integration
  openMilkLab: (options: { mode: 'new' | 'edit'; presetId?: string; libraryId?: string }) =>
    ipcRenderer.invoke('milklab:open', options) as Promise<{ ok: boolean; message: string }>,
  onPresetStateChanged: (cb: (state: PresetWorkspaceState) => void): (() => void) => {
    const handler = (_e: unknown, state: PresetWorkspaceState) => cb(state)
    ipcRenderer.on('curationist:preset-state-changed', handler)
    return () => {
      ipcRenderer.removeListener('curationist:preset-state-changed', handler)
    }
  },

  // OBS Integration (milkyWay Audio & milkyWay Video)
  getObsConnectionState: () =>
    ipcRenderer.invoke('obs:getConnectionState') as Promise<ObsConnectionState>,
  connectObs: (endpoint?: string, password?: string) =>
    ipcRenderer.invoke('obs:connect', endpoint, password) as Promise<ObsConnectionState>,
  disconnectObs: () => ipcRenderer.invoke('obs:disconnect') as Promise<ObsConnectionState>,
  refreshObsSources: () => ipcRenderer.invoke('obs:refreshSources') as Promise<ObsSource[]>,
  getObsSourceStatus: (sourceId: string) =>
    ipcRenderer.invoke('obs:getSourceStatus', sourceId) as Promise<ObsStatus>,
  getObsSourceQueue: (sourceId: string) =>
    ipcRenderer.invoke('obs:getSourceQueue', sourceId) as Promise<ObsQueue>,
  controlObsSource: (control: ObsControlPayload) =>
    ipcRenderer.invoke('obs:controlSource', control) as Promise<ObsStatus>,
  setObsPlaybackModes: (
    sourceId: string,
    loop: boolean,
    shuffle: boolean,
    advanceOnSongChange?: boolean,
    crossfadeSec?: number
  ) =>
    ipcRenderer.invoke(
      'obs:setPlaybackModes',
      sourceId,
      loop,
      shuffle,
      advanceOnSongChange,
      crossfadeSec
    ) as Promise<ObsStatus>,
  setObsPresetTiming: (
    sourceId: string,
    intervalMs: number,
    autoAdvance: boolean,
    advanceOnSongChange?: boolean
  ) =>
    ipcRenderer.invoke(
      'obs:setPresetTiming',
      sourceId,
      intervalMs,
      autoAdvance,
      advanceOnSongChange
    ) as Promise<ObsStatus>,
  getObsAudioSettings: (sourceId: string) =>
    ipcRenderer.invoke('obs:getAudioSettings', sourceId) as Promise<ObsAudioSettings>,
  setObsAudioSettings: (settings: ObsAudioSettings) =>
    ipcRenderer.invoke('obs:setAudioSettings', settings) as Promise<ObsAudioSettings>,
  getObsVideoSettings: (sourceId: string) =>
    ipcRenderer.invoke('obs:getVideoSettings', sourceId) as Promise<ObsVideoSettings>,
  setObsVideoSettings: (settings: ObsVideoSettings) =>
    ipcRenderer.invoke('obs:setVideoSettings', settings) as Promise<ObsVideoSettings>,
  getObsAudioDrivers: (sourceId: string) =>
    ipcRenderer.invoke('obs:getAudioDrivers', sourceId) as Promise<ObsAudioDriver[]>,
  publishObsAudioQueue: (options?: {
    sourceId?: string
    playlistId?: string
    trackIds?: string[]
    mode?: ObsQueuePublishMode
  }) =>
    ipcRenderer.invoke('obs:publishAudioQueue', options) as Promise<{
      publishedSources: number
      itemCount: number
    }>,
  publishObsClipQueue: (options?: {
    sourceId?: string
    playlistId?: string
    clipIds?: string[]
    mode?: ObsQueuePublishMode
  }) =>
    ipcRenderer.invoke('obs:publishClipQueue', options) as Promise<{
      publishedSources: number
      itemCount: number
    }>,
  publishObsVideoQueue: (options?: {
    sourceId?: string
    playlistId?: string
    presetIds?: string[]
    mode?: ObsQueuePublishMode
  }) =>
    ipcRenderer.invoke('obs:publishVideoQueue', options) as Promise<{
      publishedSources: number
      itemCount: number
    }>,
  resolveObsPublishedAssetPath: (relativeAsset: string) =>
    ipcRenderer.invoke('obs:resolvePublishedAssetPath', relativeAsset) as Promise<string>,
  getObsPluginStatus: () =>
    ipcRenderer.invoke('obs:getPluginStatus') as Promise<ObsPluginStatus>,
  selectObsExecutable: () =>
    ipcRenderer.invoke('obs:selectObsExecutable') as Promise<ObsPluginStatus>,
  installObsPlugin: () =>
    ipcRenderer.invoke('obs:installPlugin') as Promise<ObsPluginInstallResult>,

  // Video Studio (Curationist Video Libraries & Playlists)
  getVideoState: () => ipcRenderer.invoke('video:getState') as Promise<VideoWorkspaceState>,
  createVideoLibrary: (name: string, desc?: string) =>
    ipcRenderer.invoke('video:createLibrary', name, desc) as Promise<VideoWorkspaceState>,
  renameVideoLibrary: (id: string, name: string) =>
    ipcRenderer.invoke('video:renameLibrary', id, name) as Promise<VideoWorkspaceState>,
  deleteVideoLibrary: (id: string) =>
    ipcRenderer.invoke('video:deleteLibrary', id) as Promise<VideoWorkspaceState>,
  importVideoMedia: (
    paths: string[],
    libraryId: string,
    copyToManaged: boolean,
    options?: { targetFolderPath?: string; move?: boolean }
  ) =>
    ipcRenderer.invoke('video:importMedia', paths, libraryId, copyToManaged, options) as Promise<{
      batch: ImportBatchResult
      state: VideoWorkspaceState
    }>,
  copyVideoClipsToManaged: (
    clipIds: string[],
    options?: { targetFolderPath?: string; move?: boolean }
  ) =>
    ipcRenderer.invoke('video:copyToManaged', clipIds, options) as Promise<{
      copied: number
      state: VideoWorkspaceState
    }>,
  removeVideoClips: (clipIds: string[]) =>
    ipcRenderer.invoke('video:removeClips', clipIds) as Promise<VideoWorkspaceState>,
  deleteVideoClipsFromDisk: (clipIds: string[]) =>
    ipcRenderer.invoke('video:deleteClipsFromDisk', clipIds) as Promise<{
      deletedFiles: number
      removedClips: number
      state: VideoWorkspaceState
    }>,
  setVideoClipsRating: (clipIds: string[], rating: number) =>
    ipcRenderer.invoke('video:setRating', clipIds, rating) as Promise<VideoWorkspaceState>,
  updateVideoClipMetadata: (payload: {
    clipId: string
    title?: string
    artist?: string
    duration?: number
  }) => ipcRenderer.invoke('video:updateMetadata', payload) as Promise<VideoWorkspaceState>,
  createVideoPlaylist: (name: string, makeActive = false) =>
    ipcRenderer.invoke('video:createPlaylist', name, makeActive) as Promise<{
      newId: string
      state: VideoWorkspaceState
    }>,
  renameVideoPlaylist: (id: string, newName: string) =>
    ipcRenderer.invoke('video:renamePlaylist', id, newName) as Promise<VideoWorkspaceState>,
  duplicateVideoPlaylist: (id: string) =>
    ipcRenderer.invoke('video:duplicatePlaylist', id) as Promise<{
      newId: string
      state: VideoWorkspaceState
    }>,
  deleteVideoPlaylist: (id: string) =>
    ipcRenderer.invoke('video:deletePlaylist', id) as Promise<VideoWorkspaceState>,
  setActiveVideoPlaylist: (id: string) =>
    ipcRenderer.invoke('video:setActivePlaylist', id) as Promise<VideoWorkspaceState>,
  addClipsToVideoPlaylist: (playlistId: string, clipIds: string[], pos?: number) =>
    ipcRenderer.invoke('video:addClipsToPlaylist', playlistId, clipIds, pos) as Promise<VideoWorkspaceState>,
  removeItemsFromVideoPlaylist: (playlistId: string, itemIds: string[]) =>
    ipcRenderer.invoke('video:removeItemsFromPlaylist', playlistId, itemIds) as Promise<VideoWorkspaceState>,
  deleteVideoPlaylistItemsFromDisk: (playlistId: string, itemIds: string[]) =>
    ipcRenderer.invoke('video:deletePlaylistItemsFromDisk', playlistId, itemIds) as Promise<{
      deletedFiles: number
      removedItems: number
      state: VideoWorkspaceState
    }>,
  reorderVideoPlaylistItems: (playlistId: string, orderedIds: string[]) =>
    ipcRenderer.invoke('video:reorderPlaylistItems', playlistId, orderedIds) as Promise<VideoWorkspaceState>,
  publishVideoPlaylists: () =>
    ipcRenderer.invoke('video:publish') as Promise<{
      playlistName: string
      itemCount: number
      publishedSources: number
      state: VideoWorkspaceState
    }>
}

contextBridge.exposeInMainWorld('curationist', api)

declare global {
  interface Window {
    curationist: typeof api
  }
}
