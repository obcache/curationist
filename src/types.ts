export type WorkspaceMode = 'music' | 'video' | 'presets'

export type ObsSourceKind = 'audio' | 'clip' | 'video'

export type ObsQueuePublishMode = 'play_now' | 'play_next' | 'append' | 'replace'

export type SidebarSide = 'left' | 'right'

export interface SectionLayoutState {
  id: string
  side: SidebarSide
  collapsed: boolean
  order: number
  visible?: boolean
  size?: number
}

export interface ManagedStorageFolder {
  id: string
  label: string
  path: string
}

export interface AppSettings {
  mp3ManagedStoragePath: string
  videoManagedStoragePath?: string
  presetManagedStoragePath: string
  nowPlaylistingJsonPath: string
  obspiltMilkLibraryJsonPath: string
  obspiltMilkPlaylistDatPath: string
  milkdropExecutablePath: string
  copyMp3ToManagedByDefault: boolean
  copyVideoToManagedByDefault?: boolean
  copyPresetToManagedByDefault: boolean
  playlistDatUseManagedPaths: boolean
  managedStorageFolders: ManagedStorageFolder[]
  selectedMp3StorageFolderId: string
  selectedVideoStorageFolderId?: string
  selectedPresetStorageFolderId: string
  mp3ManagedTransferMode: 'copy' | 'move'
  videoManagedTransferMode?: 'copy' | 'move'
  presetManagedTransferMode: 'copy' | 'move'
  presetPlaylistDurationSec: number
  obsWebsocketUrl?: string
  obsWebsocketPassword?: string
  selectedObsAudioSourceId?: string
  selectedObsClipSourceId?: string
  selectedObsVideoSourceId?: string
  obsExecutablePath?: string
  obsPersistentConnect?: boolean
  showSetupWizardOnStartup?: boolean
  setupWizardCompleted?: boolean
}

export interface ObsCapabilities {
  protocolVersion: number
  productVersion: string
  audioDecoding: boolean
  albumArt: boolean
  projectM: boolean
  seekReceipts: boolean
}

export interface ObsSource {
  sourceId: string
  name: string
  kind: ObsSourceKind
}

export interface ObsConnectionState {
  connected: boolean
  sessionId: string | null
  endpoint: string
  capabilities: ObsCapabilities | null
  sources: ObsSource[]
}

export interface ObsStatus {
  sourceId: string
  kind: ObsSourceKind
  revision: number
  state: 'stopped' | 'playing' | 'paused' | 'holding' | 'buffering' | 'error'
  playbackEpoch: number
  settledSeekEpoch: number
  activeEntryId: string | null
  activeMediaId: string | null
  cursorMs: number
  durationMs: number
  remaining: number
  seeking: boolean
  transitionPending: boolean
  loop: boolean
  shuffle: boolean
  autoAdvance: boolean
  advanceOnSongChange?: boolean
  crossfadeSec?: number
  presetIntervalMs: number
  error: string
  audioReady: boolean
  visualReady: boolean
  audioDriverId: string
  audioDriverReady: boolean
  drivenAudioFrames: number
}

export interface ObsQueueItem {
  entryId: string
  mediaId: string
  asset: string
  title: string
  artist: string
  durationMs: number | null
  artwork?: string
}

export interface ObsQueue {
  sourceId: string
  kind: ObsSourceKind
  revision: number
  playbackEpoch: number
  current: ObsQueueItem | null
  upcoming: ObsQueueItem[]
  stopped: ObsQueueItem | null
  playable: boolean
}

export interface ObsAudioSettings {
  sourceId: string
  brightness: number
  contrast: number
  saturation: number
  glowColor: number
  glowSize: number
  glowIntensity: number
  vignetteStrength: number
  vignetteRoundness: number
  bounce: number
  shake: number
  crossfadeSec?: number
}

export interface ObsVideoSettings {
  sourceId: string
  width: number
  height: number
  fps: number
  transitionMs: number
  audioDriverId: string
}

export interface ObsAudioDriver {
  sourceId: string
  name: string
  type: 'source' | 'scene'
}

export type ObsControlPayload =
  | {
      action: 'play' | 'pause' | 'stop' | 'restart' | 'next' | 'previous'
      sourceId: string
    }
  | {
      action: 'seek'
      sourceId: string
      cursorMs: number
      expectedEpoch?: number
      expectedMediaId?: string
    }

export interface ObsPluginStatus {
  payloadVersion: string | null
  installedVersion: string | null
  installedHealthy: boolean
  destination: string
  obs: {
    path: string
    version: string
    compatible: boolean
  } | null
  obsRunning: boolean
  message: string
}

export interface ObsPluginInstallResult {
  version: string
  destination: string
  backupPath: string | null
  restartRequired: boolean
}

export interface PreviewPresetResult {
  ok: boolean
  mode: 'ipc' | 'launched'
  presetPath: string
  milkdropPath: string
  message: string
}

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  category: string
  message: string
  details?: string
}

export interface LogsSnapshot {
  entries: LogEntry[]
  logFilePath: string
}

export interface Mp3Library {
  id: string
  name: string
  description: string
  trackCount: number
  createdAt: string
}

export interface Mp3Track {
  id: string
  libraryId: string
  libraryName?: string
  filePath: string
  originalPath: string
  isManaged: boolean
  filename: string
  artist: string
  title: string
  album: string
  year: string
  genre: string
  trackNumber: string
  duration: number
  bitrate: number
  sampleRate: number
  rating: number
  hasSyncedLyrics?: boolean
  syncedLyricsFirstLine?: string
  syncedLyrics?: string
  unsyncedLyrics?: string
  comment?: string
  channels?: number
  codec?: string
  fileSize?: number
  showTags: boolean
  coverArtMime?: string
  coverArtBase64?: string
  fileExists: boolean
  addedAt: string
}

export interface Mp3DetailedMetadata {
  trackId: string
  filePath: string
  artist: string
  title: string
  album: string
  year: string
  genre: string
  trackNumber: string
  rating: number
  rawRatingTag: string
  rawStarsTag: string
  duration: number
  bitrate: number
  sampleRate: number
  channels: number
  codec: string
  tagTypes: string
  fileSize: number
  addedAt: string
  comment: string
  unsyncedLyrics: string
  syncedLyrics: string
  hasSyncedLyrics: boolean
  syncedLyricsFirstLine: string
}

export interface Mp3TagUpdatePayload {
  trackIds: string[]
  artist?: string
  title?: string
  album?: string
  year?: string
  genre?: string
  trackNumber?: string
  rating?: number
  comment?: string
  unsyncedLyrics?: string
  syncedLyrics?: string
  showTags?: boolean
  coverArtBase64?: string | null
  coverArtMime?: string | null
  writeToFile: boolean
}

export interface MusicPlaylistItem {
  id: string
  playlistId: string
  trackId: string | null
  position: number
  value: string // file path stored in saved-playlists.json
  artist: string
  title: string
  album?: string
  duration?: number
  rating?: number
  show_tags: boolean
  uuid: string
  fileExists?: boolean
}

export interface MusicPlaylist {
  id: string
  name: string
  sourceOrigin: string
  inActiveJson: boolean
  activeOrder: number
  itemCount: number
  updatedAt: string
  items?: MusicPlaylistItem[]
}

export interface MusicWorkspaceState {
  libraries: Mp3Library[]
  tracks: Mp3Track[]
  playlists: MusicPlaylist[]
  activeJsonPlaylistIds: string[]
  isModified: boolean
  lastPublishedAt: string | null
  targetJsonPath: string
}

export interface PresetLibraryRecord {
  id: string
  name: string
  description: string
  presetCount: number
  createdAt: string
}

export interface PresetItem {
  id: string // sha256(canonicalSourcePath + '\0' + originalBytes)
  libraryId: string
  libraryName?: string
  filename: string // <id>-<safeBasename>.milk
  managedPath: string
  originalPath: string
  isManaged: boolean
  label: string
  digest: string // sha256(originalBytes)
  repairs: string[]
  warnings: string[]
  rating: number
  isRetainedOnly: boolean
  fileExists: boolean
  addedAt: string
}

export interface PresetPlaylistItem {
  id: string
  playlistId: string
  presetId: string
  position: number
  label: string
  managedPath: string
  originalPath: string
  filename?: string
  repairs: string[]
  warnings: string[]
  rating: number
  fileExists: boolean
}

export interface PresetPlaylist {
  id: string
  name: string
  sourceOrigin: string
  isActiveDat: boolean
  itemCount: number
  updatedAt: string
  items?: PresetPlaylistItem[]
}

export interface PresetWorkspaceState {
  libraries: PresetLibraryRecord[]
  presets: PresetItem[]
  playlists: PresetPlaylist[]
  activePlaylistId: string | null
  isModified: boolean
  lastPublishedAt: string | null
  targetLibraryJsonPath: string
  targetPlaylistDatPath: string
}

export interface ImportBatchResult {
  imported: number
  duplicates: number
  repaired: number
  warnings: number
  errors: string[]
}

export interface PresetInspectionResult {
  id: string
  label: string
  filename: string
  originalPath: string
  managedPath: string
  digest: string
  repairs: string[]
  warnings: string[]
  originalContent: string
  repairedContent: string
}

export interface VideoLibraryRecord {
  id: string
  name: string
  description: string
  clipCount: number
  createdAt: string
}

export interface VideoClipItem {
  id: string
  libraryId: string
  libraryName?: string
  filePath: string
  originalPath: string
  isManaged: boolean
  filename: string
  title: string
  artist: string
  duration: number
  fileSize: number
  rating: number
  fileExists: boolean
  addedAt: string
}

export interface VideoPlaylistItem {
  id: string
  playlistId: string
  clipId: string | null
  position: number
  value: string // file path
  title: string
  artist: string
  duration: number
  rating: number
  fileExists: boolean
}

export interface VideoPlaylist {
  id: string
  name: string
  sourceOrigin: string
  isActive: boolean
  itemCount: number
  updatedAt: string
  items?: VideoPlaylistItem[]
}

export interface VideoWorkspaceState {
  libraries: VideoLibraryRecord[]
  clips: VideoClipItem[]
  playlists: VideoPlaylist[]
  activePlaylistId: string | null
  isModified: boolean
  lastPublishedAt: string | null
}
