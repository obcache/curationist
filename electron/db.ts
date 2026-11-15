import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AppSettings,
  Mp3Library,
  Mp3Track,
  MusicPlaylist,
  MusicPlaylistItem,
  MusicWorkspaceState,
  PresetItem,
  PresetLibraryRecord,
  PresetPlaylist,
  PresetPlaylistItem,
  PresetWorkspaceState
} from '../src/types'

let db: DatabaseSync | null = null

const FILE_EXISTS_TTL_MS = 60_000
const fileExistsCache = new Map<string, { exists: boolean; checkedAt: number }>()

export function checkFileExistsCached(filePath: string): boolean {
  if (!filePath) return false
  const key = filePath.replace(/\\/g, '/').toLowerCase()
  const now = Date.now()
  const cached = fileExistsCache.get(key)
  if (cached && now - cached.checkedAt < FILE_EXISTS_TTL_MS) {
    return cached.exists
  }
  const exists = fs.existsSync(filePath)
  fileExistsCache.set(key, { exists, checkedAt: now })
  return exists
}

export function invalidateFileExistsCache(filePath?: string): void {
  if (!filePath) {
    fileExistsCache.clear()
    return
  }
  fileExistsCache.delete(filePath.replace(/\\/g, '/').toLowerCase())
}

let cachedMusicLibraryData: {
  libraries: Mp3Library[]
  tracks: Mp3Track[]
  trackByPath: Map<string, Mp3Track>
  trackById: Map<string, Mp3Track>
} | null = null

let cachedPresetLibraryData: {
  libraries: PresetLibraryRecord[]
  presets: PresetItem[]
  presetById: Map<string, PresetItem>
} | null = null

export function invalidateMusicLibraryCache(): void {
  cachedMusicLibraryData = null
}

export function invalidatePresetLibraryCache(): void {
  cachedPresetLibraryData = null
}

export function updatePresetRatingInMemoryCache(presetIds: string[], rating: number): void {
  if (!cachedPresetLibraryData) return
  const idSet = new Set(presetIds)
  for (const p of cachedPresetLibraryData.presets) {
    if (idSet.has(p.id)) {
      p.rating = rating
    }
  }
}

export function getTrackCoverArt(trackId: string): { mime: string; base64: string } | null {
  const d = getDb()
  const row = d
    .prepare(`SELECT cover_art_mime, cover_art_base64 FROM mp3_tracks WHERE id = ?`)
    .get(trackId) as { cover_art_mime: string; cover_art_base64: string } | undefined
  if (!row || !row.cover_art_base64) return null
  return {
    mime: row.cover_art_mime || 'image/jpeg',
    base64: row.cover_art_base64
  }
}

export function getDefaultSettings(): AppSettings {
  const home = os.homedir()
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')

  const defaultMilkdropCandidates = [
    'E:\\Desktop\\MilkDrop 3.33\\MilkDrop 3.exe',
    path.join(home, 'Desktop', 'MilkDrop 3.33', 'MilkDrop 3.exe'),
    'C:\\Program Files\\MilkDrop3\\MilkDrop 3.exe'
  ]
  const detectedMilkdrop =
    defaultMilkdropCandidates.find((candidate) => fs.existsSync(candidate)) ||
    'E:\\Desktop\\MilkDrop 3.33\\MilkDrop 3.exe'

  const defaultMp3Dir = path.join(home, 'Music', 'obs-managed')
  const defaultPresetDir = path.join(
    appData,
    'obs-studio',
    'plugin_config',
    'obspiltMilk',
    'presets'
  )

  return {
    mp3ManagedStoragePath: defaultMp3Dir,
    presetManagedStoragePath: defaultPresetDir,
    nowPlaylistingJsonPath: path.join(
      appData,
      'obs-studio',
      'plugin_config',
      'nowplaylisting',
      'saved-playlists.json'
    ),
    obspiltMilkLibraryJsonPath: path.join(
      appData,
      'obs-studio',
      'plugin_config',
      'obspiltMilk',
      'presets',
      'library.json'
    ),
    obspiltMilkPlaylistDatPath: 'C:\\Program Files\\obs-studio\\data\\obs-plugins\\obspiltMilk\\playlist.dat',
    milkdropExecutablePath: detectedMilkdrop,
    copyMp3ToManagedByDefault: false,
    copyPresetToManagedByDefault: false,
    playlistDatUseManagedPaths: true,
    managedStorageFolders: [
      {
        id: 'default-mp3-storage',
        label: 'Consolidated Audio',
        path: defaultMp3Dir
      },
      {
        id: 'default-preset-storage',
        label: 'Consolidated Presets',
        path: path.join(home, 'Documents', 'MilkDrop Presets')
      }
    ],
    selectedMp3StorageFolderId: 'default-mp3-storage',
    selectedPresetStorageFolderId: 'default-preset-storage',
    mp3ManagedTransferMode: 'copy',
    presetManagedTransferMode: 'copy',
    presetPlaylistDurationSec: 15
  }
}

export function initDatabase(dbFilePath: string): DatabaseSync {
  if (db) return db

  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true })
  db = new DatabaseSync(dbFilePath)

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      domain TEXT PRIMARY KEY,
      is_modified INTEGER NOT NULL DEFAULT 0,
      last_published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS mp3_libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mp3_tracks (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_path TEXT NOT NULL,
      is_managed INTEGER NOT NULL DEFAULT 0,
      filename TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      track_number TEXT NOT NULL DEFAULT '',
      duration REAL NOT NULL DEFAULT 0,
      bitrate INTEGER NOT NULL DEFAULT 0,
      sample_rate INTEGER NOT NULL DEFAULT 0,
      show_tags INTEGER NOT NULL DEFAULT 1,
      cover_art_mime TEXT NOT NULL DEFAULT '',
      cover_art_base64 TEXT NOT NULL DEFAULT '',
      added_at TEXT NOT NULL,
      FOREIGN KEY (library_id) REFERENCES mp3_libraries(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mp3_tracks_filepath ON mp3_tracks(file_path);
    CREATE INDEX IF NOT EXISTS idx_mp3_tracks_library ON mp3_tracks(library_id);

    CREATE TABLE IF NOT EXISTS music_playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_origin TEXT NOT NULL DEFAULT 'curationist',
      in_active_json INTEGER NOT NULL DEFAULT 0,
      active_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS music_playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      track_id TEXT,
      position INTEGER NOT NULL,
      value TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      show_tags INTEGER NOT NULL DEFAULT 1,
      uuid TEXT NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES music_playlists(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_music_playlist_items_pl ON music_playlist_items(playlist_id, position);

    CREATE TABLE IF NOT EXISTS preset_libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preset_items (
      id TEXT NOT NULL,
      library_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      managed_path TEXT NOT NULL,
      original_path TEXT NOT NULL,
      is_managed INTEGER NOT NULL DEFAULT 1,
      label TEXT NOT NULL,
      digest TEXT NOT NULL,
      repairs_json TEXT NOT NULL DEFAULT '[]',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      repaired_content TEXT NOT NULL DEFAULT '',
      is_retained_only INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL,
      PRIMARY KEY (id, library_id),
      FOREIGN KEY (library_id) REFERENCES preset_libraries(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_preset_items_lib ON preset_items(library_id);

    CREATE TABLE IF NOT EXISTS preset_playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_origin TEXT NOT NULL DEFAULT 'curationist',
      is_active_dat INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preset_playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      managed_path TEXT NOT NULL,
      original_path TEXT NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES preset_playlists(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_preset_playlist_items_pl ON preset_playlist_items(playlist_id, position);

    CREATE TABLE IF NOT EXISTS preset_ratings (
      preset_id TEXT PRIMARY KEY,
      rating INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `)

  // Ensure default sync_state rows
  const insertSync = db.prepare(
    `INSERT OR IGNORE INTO sync_state (domain, is_modified, last_published_at) VALUES (?, 0, NULL)`
  )
  insertSync.run('music')
  insertSync.run('presets')

  // Ensure default libraries exist
  const now = new Date().toISOString()
  db.prepare(
    `INSERT OR IGNORE INTO mp3_libraries (id, name, description, created_at) VALUES (?, ?, ?, ?)`
  ).run('default-mp3-lib', 'General MP3 Library', 'Default logical library for MP3 tracks', now)

  db.prepare(
    `INSERT OR IGNORE INTO preset_libraries (id, name, description, created_at) VALUES (?, ?, ?, ?)`
  ).run('default-preset-lib', 'obSpiltMilk Library', 'Primary projectM / MilkDrop preset library', now)

  // Ensure default settings
  const defaults = getDefaultSettings()
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`)
  for (const [k, v] of Object.entries(defaults)) {
    insertSetting.run(k, JSON.stringify(v))
  }

  return db
}

export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error('Database has not been initialized')
  }
  return db
}

export function withTransaction<T>(fn: () => T): T {
  const d = getDb()
  d.exec('BEGIN IMMEDIATE')
  try {
    const res = fn()
    d.exec('COMMIT')
    return res
  } catch (err) {
    try {
      d.exec('ROLLBACK')
    } catch {
      // ignore rollback error
    }
    throw err
  }
}

export function getSettings(): AppSettings {
  const d = getDb()
  const defaults = getDefaultSettings()
  const rows = d.prepare(`SELECT key, value FROM app_settings`).all() as Array<{ key: string; value: string }>
  const map: Record<string, any> = { ...defaults }
  for (const row of rows) {
    try {
      map[row.key] = JSON.parse(row.value)
    } catch {
      map[row.key] = row.value
    }
  }
  return map as AppSettings
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const d = getDb()
  const current = getSettings()
  const next = { ...current, ...partial }
  const upsert = d.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  for (const [k, v] of Object.entries(next)) {
    upsert.run(k, JSON.stringify(v))
  }
  return next
}

export function setDomainModified(domain: 'music' | 'presets', isModified: boolean, publishedNow = false): void {
  const d = getDb()
  if (publishedNow) {
    d.prepare(`UPDATE sync_state SET is_modified = ?, last_published_at = ? WHERE domain = ?`).run(
      isModified ? 1 : 0,
      new Date().toISOString(),
      domain
    )
  } else {
    d.prepare(`UPDATE sync_state SET is_modified = ? WHERE domain = ?`).run(isModified ? 1 : 0, domain)
  }
}

export function getMusicWorkspaceState(): MusicWorkspaceState {
  const d = getDb()
  const settings = getSettings()

  const syncRow = d
    .prepare(`SELECT is_modified, last_published_at FROM sync_state WHERE domain = 'music'`)
    .get() as { is_modified: number; last_published_at: string | null } | undefined

  if (!cachedMusicLibraryData) {
    const libRows = d
      .prepare(
        `SELECT l.id, l.name, l.description, l.created_at, COUNT(t.id) as track_count
         FROM mp3_libraries l
         LEFT JOIN mp3_tracks t ON t.library_id = l.id
         GROUP BY l.id
         ORDER BY l.created_at ASC`
      )
      .all() as Array<any>

    const libraries: Mp3Library[] = libRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      trackCount: Number(r.track_count || 0),
      createdAt: r.created_at
    }))

    // IMPORTANT: Do NOT select cover_art_base64 (or added_at after it) here!
    // Selecting only columns 1..17 avoids reading 1.4+ GB of SQLite overflow pages
    // and avoids serializing hundreds of MB of base64 over Electron IPC on every click.
    const trackRows = d
      .prepare(
        `SELECT t.id, t.library_id, t.file_path, t.original_path, t.is_managed,
                t.filename, t.artist, t.title, t.album, t.year, t.genre,
                t.track_number, t.duration, t.bitrate, t.sample_rate,
                t.show_tags, t.cover_art_mime, l.name as library_name
         FROM mp3_tracks t
         LEFT JOIN mp3_libraries l ON l.id = t.library_id
         ORDER BY LOWER(t.artist) ASC, LOWER(t.title) ASC, LOWER(t.filename) ASC`
      )
      .all() as Array<any>

    const trackByPath = new Map<string, Mp3Track>()
    const trackById = new Map<string, Mp3Track>()

    const tracks: Mp3Track[] = trackRows.map((r) => {
      const tr: Mp3Track = {
        id: r.id,
        libraryId: r.library_id,
        libraryName: r.library_name || 'Library',
        filePath: r.file_path,
        originalPath: r.original_path,
        isManaged: Boolean(r.is_managed),
        filename: r.filename,
        artist: r.artist,
        title: r.title,
        album: r.album,
        year: r.year,
        genre: r.genre,
        trackNumber: r.track_number,
        duration: Number(r.duration || 0),
        bitrate: Number(r.bitrate || 0),
        sampleRate: Number(r.sample_rate || 0),
        showTags: Boolean(r.show_tags),
        coverArtMime: r.cover_art_mime || '',
        coverArtBase64: '',
        fileExists: checkFileExistsCached(r.file_path),
        addedAt: ''
      }
      trackById.set(tr.id, tr)
      trackByPath.set(tr.filePath.replace(/\\/g, '/').toLowerCase(), tr)
      return tr
    })

    cachedMusicLibraryData = {
      libraries,
      tracks,
      trackByPath,
      trackById
    }
  }

  const { libraries, tracks, trackByPath, trackById } = cachedMusicLibraryData

  const plRows = d
    .prepare(
      `SELECT p.*, COUNT(i.id) as item_count
       FROM music_playlists p
       LEFT JOIN music_playlist_items i ON i.playlist_id = p.id
       GROUP BY p.id
       ORDER BY CASE WHEN p.in_active_json = 1 THEN 0 ELSE 1 END, p.active_order ASC, LOWER(p.name) ASC`
    )
    .all() as Array<any>

  const itemRows = d
    .prepare(
      `SELECT * FROM music_playlist_items ORDER BY playlist_id ASC, position ASC`
    )
    .all() as Array<any>

  const itemsByPl = new Map<string, MusicPlaylistItem[]>()
  for (const ir of itemRows) {
    const matchedTrack =
      (ir.track_id ? trackById.get(ir.track_id) : undefined) ||
      trackByPath.get(String(ir.value || '').replace(/\\/g, '/').toLowerCase())
    const item: MusicPlaylistItem = {
      id: ir.id,
      playlistId: ir.playlist_id,
      trackId: ir.track_id || matchedTrack?.id || null,
      position: Number(ir.position),
      value: ir.value,
      artist: ir.artist,
      title: ir.title,
      album: matchedTrack?.album || '',
      duration: matchedTrack?.duration || 0,
      show_tags: Boolean(ir.show_tags),
      uuid: ir.uuid || crypto.randomUUID(),
      fileExists: matchedTrack ? matchedTrack.fileExists : checkFileExistsCached(ir.value)
    }
    const list = itemsByPl.get(ir.playlist_id) || []
    list.push(item)
    itemsByPl.set(ir.playlist_id, list)
  }

  const playlists: MusicPlaylist[] = plRows.map((p) => {
    const plItems = itemsByPl.get(p.id) || []
    return {
      id: p.id,
      name: p.name,
      sourceOrigin: p.source_origin,
      inActiveJson: Boolean(p.in_active_json),
      activeOrder: Number(p.active_order || 0),
      itemCount: plItems.length,
      updatedAt: p.updated_at,
      items: plItems
    }
  })

  const activeJsonPlaylistIds = playlists
    .filter((p) => p.inActiveJson)
    .sort((a, b) => a.activeOrder - b.activeOrder)
    .map((p) => p.id)

  return {
    libraries,
    tracks,
    playlists,
    activeJsonPlaylistIds,
    isModified: Boolean(syncRow?.is_modified),
    lastPublishedAt: syncRow?.last_published_at || null,
    targetJsonPath: settings.nowPlaylistingJsonPath
  }
}

export function getPresetWorkspaceState(): PresetWorkspaceState {
  const d = getDb()
  const settings = getSettings()

  const syncRow = d
    .prepare(`SELECT is_modified, last_published_at FROM sync_state WHERE domain = 'presets'`)
    .get() as { is_modified: number; last_published_at: string | null } | undefined

  if (!cachedPresetLibraryData) {
    const libRows = d
      .prepare(
        `SELECT l.id, l.name, l.description, l.created_at,
                SUM(CASE WHEN p.is_retained_only = 0 AND p.id IS NOT NULL THEN 1 ELSE 0 END) as preset_count
         FROM preset_libraries l
         LEFT JOIN preset_items p ON p.library_id = l.id
         GROUP BY l.id
         ORDER BY l.created_at ASC`
      )
      .all() as Array<any>

    const libraries: PresetLibraryRecord[] = libRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      presetCount: Number(r.preset_count || 0),
      createdAt: r.created_at
    }))

    // Note: In preset_items schema, added_at is after repaired_content. Omit added_at
    // so SQLite never reads repaired_content overflow pages when scanning preset_items.
    const presetRows = d
      .prepare(
        `SELECT p.id, p.library_id, p.filename, p.managed_path, p.original_path,
                p.is_managed, p.label, p.digest, p.repairs_json, p.warnings_json,
                l.name as library_name
         FROM preset_items p
         LEFT JOIN preset_libraries l ON l.id = p.library_id
         WHERE p.is_retained_only = 0
         ORDER BY LOWER(p.label) ASC`
      )
      .all() as Array<any>

    const ratingRows = d
      .prepare(`SELECT preset_id, rating FROM preset_ratings`)
      .all() as Array<{ preset_id: string; rating: number }>
    const ratingMap = new Map<string, number>()
    for (const rr of ratingRows) {
      ratingMap.set(rr.preset_id, Number(rr.rating || 0))
    }

    const presetById = new Map<string, PresetItem>()
    const presets: PresetItem[] = presetRows.map((r) => {
      const managedExists = r.managed_path ? checkFileExistsCached(r.managed_path) : false
      const origExists = r.original_path ? checkFileExistsCached(r.original_path) : false
      const pr: PresetItem = {
        id: r.id,
        libraryId: r.library_id,
        libraryName: r.library_name || 'Preset Library',
        filename: r.filename,
        managedPath: r.managed_path,
        originalPath: r.original_path,
        isManaged: Boolean(r.is_managed),
        label: r.label,
        digest: r.digest,
        repairs: safeParseJsonArray(r.repairs_json),
        warnings: safeParseJsonArray(r.warnings_json),
        rating: ratingMap.get(r.id) || 0,
        isRetainedOnly: false,
        fileExists: managedExists || origExists,
        addedAt: ''
      }
      presetById.set(pr.id, pr)
      return pr
    })

    cachedPresetLibraryData = {
      libraries,
      presets,
      presetById
    }
  }

  const { libraries, presets, presetById } = cachedPresetLibraryData

  const plRows = d
    .prepare(
      `SELECT p.*, COUNT(i.id) as item_count
       FROM preset_playlists p
       LEFT JOIN preset_playlist_items i ON i.playlist_id = p.id
       GROUP BY p.id
       ORDER BY CASE WHEN p.is_active_dat = 1 THEN 0 ELSE 1 END, LOWER(p.name) ASC`
    )
    .all() as Array<any>

  const itemRows = d
    .prepare(`SELECT * FROM preset_playlist_items ORDER BY playlist_id ASC, position ASC`)
    .all() as Array<any>

  const itemsByPl = new Map<string, PresetPlaylistItem[]>()
  for (const ir of itemRows) {
    const matched = presetById.get(ir.preset_id)
    const item: PresetPlaylistItem = {
      id: ir.id,
      playlistId: ir.playlist_id,
      presetId: ir.preset_id,
      position: Number(ir.position),
      label: matched?.label || ir.label,
      managedPath: matched?.managedPath || ir.managed_path,
      originalPath: matched?.originalPath || ir.original_path,
      filename: matched?.filename || path.basename(ir.managed_path || ir.original_path),
      repairs: matched?.repairs || [],
      warnings: matched?.warnings || [],
      rating: matched?.rating || 0,
      fileExists: matched
        ? matched.fileExists
        : checkFileExistsCached(ir.managed_path) || checkFileExistsCached(ir.original_path)
    }
    const list = itemsByPl.get(ir.playlist_id) || []
    list.push(item)
    itemsByPl.set(ir.playlist_id, list)
  }

  const playlists: PresetPlaylist[] = plRows.map((p) => {
    const plItems = itemsByPl.get(p.id) || []
    return {
      id: p.id,
      name: p.name,
      sourceOrigin: p.source_origin,
      isActiveDat: Boolean(p.is_active_dat),
      itemCount: plItems.length,
      updatedAt: p.updated_at,
      items: plItems
    }
  })

  const activePl = playlists.find((p) => p.isActiveDat)

  return {
    libraries,
    presets,
    playlists,
    activePlaylistId: activePl ? activePl.id : null,
    isModified: Boolean(syncRow?.is_modified),
    lastPublishedAt: syncRow?.last_published_at || null,
    targetLibraryJsonPath: settings.obspiltMilkLibraryJsonPath,
    targetPlaylistDatPath: settings.obspiltMilkPlaylistDatPath
  }
}

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
