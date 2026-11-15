export type WorkspaceMode = 'music' | 'presets'

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
  presetManagedStoragePath: string
  nowPlaylistingJsonPath: string
  obspiltMilkLibraryJsonPath: string
  obspiltMilkPlaylistDatPath: string
  milkdropExecutablePath: string
  copyMp3ToManagedByDefault: boolean
  copyPresetToManagedByDefault: boolean
  playlistDatUseManagedPaths: boolean
  managedStorageFolders: ManagedStorageFolder[]
  selectedMp3StorageFolderId: string
  selectedPresetStorageFolderId: string
  mp3ManagedTransferMode: 'copy' | 'move'
  presetManagedTransferMode: 'copy' | 'move'
  presetPlaylistDurationSec: number
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
  showTags: boolean
  coverArtMime?: string
  coverArtBase64?: string
  fileExists: boolean
  addedAt: string
}

export interface Mp3TagUpdatePayload {
  trackIds: string[]
  artist?: string
  title?: string
  album?: string
  year?: string
  genre?: string
  trackNumber?: string
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
