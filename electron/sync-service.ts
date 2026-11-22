import { type ChildProcessWithoutNullStreams, execFileSync, execSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getDb,
  getMusicWorkspaceState,
  getPresetWorkspaceState,
  getSettings,
  invalidateFileExistsCache,
  invalidateMusicLibraryCache,
  invalidatePresetLibraryCache,
  invalidateVideoLibraryCache,
  setDomainModified,
  updateMp3RatingInMemoryCache,
  updatePresetRatingInMemoryCache,
  withTransaction
} from './db'
import { logEvent } from './logger'
import { extractMp3Metadata, getFirstSyncedLyricsLine, writeMp3Id3Tags } from './mp3-metadata'
import {
  canonicalizePresetPath,
  preparePresetFileForLibrary,
  preparePresetImport,
  safePresetBasename
} from './preset-import'
import type {
  ImportBatchResult,
  Mp3DetailedMetadata,
  Mp3TagUpdatePayload,
  PresetInspectionResult,
  PreviewPresetResult
} from '../src/types'

function collectFilesRecursively(paths: string[], extensions: string[]): string[] {
  const extSet = new Set(extensions.map((e) => e.toLowerCase()))
  const found: string[] = []
  const seen = new Set<string>()

  const walk = (target: string) => {
    let stat: fs.Stats
    try {
      stat = fs.statSync(target)
    } catch {
      return
    }
    if (stat.isFile()) {
      const ext = path.extname(target).toLowerCase()
      if (extSet.has(ext)) {
        const norm = path.resolve(target)
        const key = norm.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          found.push(norm)
        }
      }
      return
    }
    if (stat.isDirectory()) {
      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(target, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        walk(path.join(target, entry.name))
      }
    }
  }

  for (const p of paths) {
    walk(p)
  }
  found.sort((a, b) => a.localeCompare(b))
  return found
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function writeFileAtomicallyWithPrivilegeFallback(targetPath: string, content: string | Buffer, createBak = false): void {
  const dir = path.dirname(targetPath)
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (createBak && fs.existsSync(targetPath)) {
      try {
        fs.copyFileSync(targetPath, `${targetPath}.bak`)
      } catch {
        // ignore backup error if protected directory
      }
    }
    fs.writeFileSync(tmpPath, content)
    fs.renameSync(tmpPath, targetPath)
  } catch (err: any) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      // ignore tmp cleanup error
    }

    if (err && (err.code === 'EPERM' || err.code === 'EACCES') && process.platform === 'win32') {
      // Target is in a UAC-protected path (e.g. C:\Program Files\obs-studio\...).
      // Stage to temp and invoke elevated PowerShell via UTF-16LE -EncodedCommand so paths
      // with spaces, apostrophes, or special characters never break argument parsing.
      const stamp = `${process.pid}-${Date.now()}`
      const tempStage = path.join(os.tmpdir(), `curationist-stage-${stamp}-${path.basename(targetPath)}`)
      const tempErr = path.join(os.tmpdir(), `curationist-elev-err-${stamp}.txt`)
      fs.writeFileSync(tempStage, content)

      const sqSrc = tempStage.replace(/'/g, "''")
      const sqDst = targetPath.replace(/'/g, "''")
      const sqErr = tempErr.replace(/'/g, "''")

      const innerScript = [
        `$ErrorActionPreference = 'Stop'`,
        `$ProgressPreference = 'SilentlyContinue'`,
        `try {`,
        `  $src = '${sqSrc}'`,
        `  $dst = '${sqDst}'`,
        `  $dstDir = Split-Path -Parent $dst`,
        `  if ($dstDir -and -not (Test-Path -LiteralPath $dstDir)) {`,
        `    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null`,
        `  }`,
        createBak
          ? `  if (Test-Path -LiteralPath $dst) { Copy-Item -LiteralPath $dst -Destination ($dst + '.bak') -Force -ErrorAction SilentlyContinue }`
          : ``,
        `  Copy-Item -LiteralPath $src -Destination $dst -Force`,
        `  exit 0`,
        `} catch {`,
        `  Set-Content -LiteralPath '${sqErr}' -Value ($_.Exception.Message) -Encoding UTF8 -ErrorAction SilentlyContinue`,
        `  exit 1`,
        `}`
      ]
        .filter(Boolean)
        .join('\r\n')

      const innerEncoded = encodePowerShellCommand(innerScript)
      const outerScript = [
        `$ErrorActionPreference = 'Stop'`,
        `$ProgressPreference = 'SilentlyContinue'`,
        `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', '${innerEncoded}') -Verb RunAs -Wait -PassThru`,
        `exit $p.ExitCode`
      ].join('\r\n')

      const outerEncoded = encodePowerShellCommand(outerScript)

      logEvent(
        'info',
        'Publish',
        `Requesting Administrator (UAC) permission to write protected file: ${targetPath}`
      )

      try {
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', outerEncoded],
          {
            windowsHide: true,
            encoding: 'utf8',
            timeout: 60000
          }
        )
        logEvent('info', 'Publish', `Elevated file write succeeded: ${targetPath}`)
        return
      } catch (elevErr: any) {
        let innerMsg = ''
        try {
          if (fs.existsSync(tempErr)) {
            innerMsg = fs.readFileSync(tempErr, 'utf8').trim()
          }
        } catch {
          // ignore
        }
        const rawErrMsg = innerMsg || elevErr?.stderr?.toString()?.trim() || elevErr?.message || String(elevErr)
        const isCanceled = /canceled by the user/i.test(rawErrMsg)
        const friendly = isCanceled
          ? `Administrator (UAC) prompt was declined while writing "${targetPath}".`
          : `Elevated write failed for "${targetPath}": ${rawErrMsg}`
        logEvent('error', 'Publish', friendly, rawErrMsg)
        throw new Error(friendly)
      } finally {
        try {
          if (fs.existsSync(tempStage)) fs.unlinkSync(tempStage)
        } catch {
          // ignore
        }
        try {
          if (fs.existsSync(tempErr)) fs.unlinkSync(tempErr)
        } catch {
          // ignore
        }
      }
    }
    throw err
  }
}

export async function seedInitialDataIfEmpty(): Promise<void> {
  const d = getDb()
  const settings = getSettings()

  const musicPlaylistCount = (
    d.prepare(`SELECT COUNT(*) as c FROM music_playlists`).get() as { c: number }
  ).c
  if (musicPlaylistCount === 0) {
    if (fs.existsSync(settings.nowPlaylistingJsonPath)) {
      try {
        await importMusicJsonFile(settings.nowPlaylistingJsonPath, true)
      } catch (err) {
        console.warn('Initial saved-playlists.json seed warning:', err)
      }
    }
    const exportSibling = path.join(path.dirname(settings.nowPlaylistingJsonPath), 'playlist-export.json')
    if (fs.existsSync(exportSibling)) {
      try {
        await importMusicJsonFile(exportSibling, false)
      } catch (err) {
        console.warn('Initial playlist-export.json seed warning:', err)
      }
    }
    setDomainModified('music', false)
  }

  const presetCount = (
    d.prepare(`SELECT COUNT(*) as c FROM preset_items`).get() as { c: number }
  ).c
  if (presetCount === 0 && fs.existsSync(settings.obspiltMilkLibraryJsonPath)) {
    try {
      importPresetLibraryJsonFile(settings.obspiltMilkLibraryJsonPath, 'default-preset-lib')
    } catch (err) {
      console.warn('Initial library.json seed warning:', err)
    }
  }

  const presetPlaylistCount = (
    d.prepare(`SELECT COUNT(*) as c FROM preset_playlists`).get() as { c: number }
  ).c
  if (presetPlaylistCount === 0 && fs.existsSync(settings.obspiltMilkPlaylistDatPath)) {
    try {
      importPresetPlaylistDatFile(settings.obspiltMilkPlaylistDatPath, 'Active playlist.dat', true)
      setDomainModified('presets', false)
    } catch (err) {
      console.warn('Initial playlist.dat seed warning:', err)
    }
  }
}

// ============================================================================
// MUSIC / NOWPLAYLISTING OPERATIONS
// ============================================================================

export function createMp3Library(name: string, description = ''): string {
  const d = getDb()
  const id = `mp3-lib-${crypto.randomUUID()}`
  d.prepare(`INSERT INTO mp3_libraries (id, name, description, created_at) VALUES (?, ?, ?, ?)`).run(
    id,
    name.trim() || 'New MP3 Library',
    description.trim(),
    new Date().toISOString()
  )
  invalidateMusicLibraryCache()
  return id
}

export function renameMp3Library(id: string, name: string): void {
  const d = getDb()
  d.prepare(`UPDATE mp3_libraries SET name = ? WHERE id = ?`).run(name.trim(), id)
  invalidateMusicLibraryCache()
}

export function deleteMp3Library(id: string): void {
  if (id === 'default-mp3-lib') {
    throw new Error('Cannot delete the default MP3 library.')
  }
  const d = getDb()
  d.prepare(`DELETE FROM mp3_libraries WHERE id = ?`).run(id)
  invalidateMusicLibraryCache()
}

function resolveSelectedMp3StoragePath(overridePath?: string): string {
  if (overridePath && overridePath.trim()) return overridePath.trim()
  const settings = getSettings()
  const selected = settings.managedStorageFolders.find(
    (f) => f.id === settings.selectedMp3StorageFolderId
  )
  if (selected && selected.path.trim()) return selected.path.trim()
  if (settings.managedStorageFolders.length > 0 && settings.managedStorageFolders[0].path.trim()) {
    return settings.managedStorageFolders[0].path.trim()
  }
  return settings.mp3ManagedStoragePath
}

function resolveSelectedPresetStoragePath(overridePath?: string): string {
  if (overridePath && overridePath.trim()) return overridePath.trim()
  const settings = getSettings()
  const selected = settings.managedStorageFolders.find(
    (f) => f.id === settings.selectedPresetStorageFolderId
  )
  if (selected && selected.path.trim()) return selected.path.trim()
  if (settings.managedStorageFolders.length > 0 && settings.managedStorageFolders[0].path.trim()) {
    return settings.managedStorageFolders[0].path.trim()
  }
  return settings.presetManagedStoragePath
}

function copyFileToManagedFolder(sourcePath: string, managedDir: string, moveSource = false): string {
  fs.mkdirSync(managedDir, { recursive: true })
  const ext = path.extname(sourcePath)
  const stem = path.basename(sourcePath, ext)
  let destPath = path.join(managedDir, path.basename(sourcePath))
  const resolvedSrc = path.resolve(sourcePath).toLowerCase()
  if (resolvedSrc === path.resolve(destPath).toLowerCase()) {
    return destPath
  }
  let counter = 2
  let reusedExisting = false
  while (fs.existsSync(destPath)) {
    // If identical size, reuse existing managed file
    try {
      const sStat = fs.statSync(sourcePath)
      const dStat = fs.statSync(destPath)
      if (sStat.size === dStat.size) {
        reusedExisting = true
        break
      }
    } catch {
      // continue
    }
    destPath = path.join(managedDir, `${stem} (${counter++})${ext}`)
  }
  if (!reusedExisting) {
    fs.copyFileSync(sourcePath, destPath)
  }
  if (
    moveSource &&
    resolvedSrc !== path.resolve(destPath).toLowerCase() &&
    fs.existsSync(destPath) &&
    fs.existsSync(sourcePath)
  ) {
    try {
      fs.unlinkSync(sourcePath)
      invalidateFileExistsCache(sourcePath)
    } catch {
      // ignore if source cannot be unlinked
    }
  }
  return destPath
}

export async function importMp3FilesOrFolders(
  paths: string[],
  libraryId: string,
  copyToManaged: boolean,
  options?: { targetFolderPath?: string; move?: boolean }
): Promise<ImportBatchResult> {
  const d = getDb()
  const settings = getSettings()
  const targetStorageDir = resolveSelectedMp3StoragePath(options?.targetFolderPath)
  const shouldMove = options?.move ?? settings.mp3ManagedTransferMode === 'move'
  const files = collectFilesRecursively(paths, ['.mp3', '.wav', '.aiff', '.aif', '.flac', '.m4a'])

  const result: ImportBatchResult = {
    imported: 0,
    duplicates: 0,
    repaired: 0,
    warnings: 0,
    errors: []
  }

  const existingRows = d
    .prepare(`SELECT id, file_path, original_path FROM mp3_tracks WHERE library_id = ?`)
    .all(libraryId) as Array<{ id: string; file_path: string; original_path: string }>

  const existingSet = new Set<string>()
  for (const r of existingRows) {
    existingSet.add(r.file_path.replace(/\\/g, '/').toLowerCase())
    existingSet.add(r.original_path.replace(/\\/g, '/').toLowerCase())
  }

  const insertStmt = d.prepare(`
    INSERT INTO mp3_tracks (
      id, library_id, file_path, original_path, is_managed, filename,
      artist, title, album, year, genre, track_number,
      duration, bitrate, sample_rate, show_tags,
      cover_art_mime, cover_art_base64, added_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `)
  const insertMetaStmt = d.prepare(`
    INSERT OR REPLACE INTO mp3_track_meta (
      track_id, rating, added_at, synced_lyrics, unsynced_lyrics, comment, channels, codec, file_size
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const srcPath of files) {
    const normSrc = srcPath.replace(/\\/g, '/')
    if (existingSet.has(normSrc.toLowerCase())) {
      result.duplicates++
      continue
    }

    try {
      let targetPath = normSrc
      let isManaged = 0
      if (copyToManaged) {
        const copied = copyFileToManagedFolder(srcPath, targetStorageDir, shouldMove)
        targetPath = copied.replace(/\\/g, '/')
        isManaged = 1
      }

      const meta = await extractMp3Metadata(targetPath)
      const trackId = `mp3-${crypto.randomUUID()}`
      const addedAt = new Date().toISOString()
      insertStmt.run(
        trackId,
        libraryId,
        targetPath,
        shouldMove && copyToManaged ? targetPath : normSrc,
        isManaged,
        path.basename(targetPath),
        meta.artist,
        meta.title,
        meta.album,
        meta.year,
        meta.genre,
        meta.trackNumber,
        meta.duration,
        meta.bitrate,
        meta.sampleRate,
        meta.coverArtMime,
        meta.coverArtBase64,
        addedAt
      )
      insertMetaStmt.run(
        trackId,
        meta.rating,
        addedAt,
        meta.syncedLyrics,
        meta.unsyncedLyrics,
        meta.comment,
        meta.channels,
        meta.codec,
        meta.fileSize
      )
      existingSet.add(normSrc.toLowerCase())
      existingSet.add(targetPath.toLowerCase())
      result.imported++
    } catch (err: any) {
      result.errors.push(`${path.basename(srcPath)}: ${err?.message || String(err)}`)
    }
  }

  if (result.imported > 0) {
    invalidateMusicLibraryCache()
  }

  logEvent(
    result.errors.length > 0 ? 'warn' : 'info',
    'Music Import',
    `Imported ${result.imported} audio track(s) (${result.duplicates} duplicate(s) skipped${
      result.errors.length > 0 ? `, ${result.errors.length} error(s)` : ''
    })`,
    result.errors.length > 0 ? result.errors.join('\n') : undefined
  )

  return result
}

export function copyTracksToManagedStorage(
  trackIds: string[],
  options?: { targetFolderPath?: string; move?: boolean }
): { copied: number; errors: string[] } {
  const d = getDb()
  const settings = getSettings()
  const targetStorageDir = resolveSelectedMp3StoragePath(options?.targetFolderPath)
  const shouldMove = options?.move ?? settings.mp3ManagedTransferMode === 'move'
  let copied = 0
  const errors: string[] = []
  let touchedActivePlaylist = false

  const getTrack = d.prepare(`SELECT id, file_path, original_path, filename FROM mp3_tracks WHERE id = ?`)
  const updateTrack = d.prepare(
    `UPDATE mp3_tracks SET file_path = ?, original_path = ?, is_managed = 1, filename = ? WHERE id = ?`
  )
  const updatePlaylistItems = d.prepare(
    `UPDATE music_playlist_items SET value = ? WHERE track_id = ? OR LOWER(REPLACE(value, '\\', '/')) = ?`
  )
  const checkActive = d.prepare(`
    SELECT COUNT(*) as c
    FROM music_playlist_items i
    JOIN music_playlists p ON p.id = i.playlist_id
    WHERE p.in_active_json = 1 AND (i.track_id = ? OR LOWER(REPLACE(i.value, '\\', '/')) = ?)
  `)

  withTransaction(() => {
    for (const id of trackIds) {
      const row = getTrack.get(id) as any
      if (!row) continue
      try {
        const oldNorm = String(row.file_path).replace(/\\/g, '/').toLowerCase()
        const dest = copyFileToManagedFolder(row.file_path, targetStorageDir, shouldMove).replace(
          /\\/g,
          '/'
        )
        invalidateFileExistsCache(dest)
        updateTrack.run(dest, shouldMove ? dest : row.original_path, path.basename(dest), id)
        updatePlaylistItems.run(dest, id, oldNorm)
        const activeHits = (checkActive.get(id, oldNorm) as { c: number }).c
        if (activeHits > 0) touchedActivePlaylist = true
        copied++
      } catch (err: any) {
        errors.push(`${row.filename}: ${err?.message || String(err)}`)
      }
    }

    if (touchedActivePlaylist) {
      setDomainModified('music', true)
    }
  })

  if (copied > 0) {
    invalidateMusicLibraryCache()
    logEvent(
      errors.length > 0 ? 'warn' : 'info',
      'Managed Storage',
      `${shouldMove ? 'Moved' : 'Copied'} ${copied} MP3 track(s) to "${targetStorageDir}"`,
      errors.length > 0 ? errors.join('\n') : undefined
    )
  }

  return { copied, errors }
}

export function removeTracksFromMp3Library(trackIds: string[], deleteManagedFiles = false): void {
  const d = getDb()
  const getTrack = d.prepare(`SELECT id, file_path, is_managed FROM mp3_tracks WHERE id = ?`)
  const delTrack = d.prepare(`DELETE FROM mp3_tracks WHERE id = ?`)

  withTransaction(() => {
    for (const id of trackIds) {
      const row = getTrack.get(id) as any
      if (!row) continue
      if (deleteManagedFiles && row.is_managed && fs.existsSync(row.file_path)) {
        try {
          fs.unlinkSync(row.file_path)
          invalidateFileExistsCache(row.file_path)
        } catch {
          // ignore
        }
      }
      delTrack.run(id)
    }
  })
  invalidateMusicLibraryCache()
}

export function deleteTracksFromDisk(trackIds: string[]): { deleted: number; errors: string[] } {
  const d = getDb()
  let deleted = 0
  const errors: string[] = []
  const affectedPlaylists = new Set<string>()

  const getTrack = d.prepare(
    `SELECT id, file_path, original_path, filename FROM mp3_tracks WHERE id = ?`
  )
  const delTrack = d.prepare(`DELETE FROM mp3_tracks WHERE id = ?`)
  const findPlItems = d.prepare(
    `SELECT id, playlist_id FROM music_playlist_items WHERE track_id = ? OR LOWER(REPLACE(value, '\\', '/')) = ?`
  )
  const delPlItem = d.prepare(`DELETE FROM music_playlist_items WHERE id = ?`)

  withTransaction(() => {
    for (const id of trackIds) {
      const row = getTrack.get(id) as any
      if (!row) continue

      const candidatePaths = Array.from(
        new Set([row.file_path, row.original_path].filter(Boolean))
      ) as string[]

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p)
            invalidateFileExistsCache(p)
          } catch (err: any) {
            errors.push(`${path.basename(p)}: ${err?.message || String(err)}`)
          }
        }
      }

      const normPath = String(row.file_path || '').replace(/\\/g, '/').toLowerCase()
      const plHits = findPlItems.all(id, normPath) as Array<{ id: string; playlist_id: string }>
      for (const hit of plHits) {
        delPlItem.run(hit.id)
        affectedPlaylists.add(hit.playlist_id)
      }

      delTrack.run(id)
      deleted++
    }

    for (const plId of affectedPlaylists) {
      const remaining = d
        .prepare(`SELECT id FROM music_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
        .all(plId) as Array<{ id: string }>
      const updPos = d.prepare(`UPDATE music_playlist_items SET position = ? WHERE id = ?`)
      for (let i = 0; i < remaining.length; ++i) {
        updPos.run(i, remaining[i].id)
      }
      setDomainModified('music', true)
    }
  })

  if (deleted > 0) {
    invalidateMusicLibraryCache()
    logEvent(
      errors.length > 0 ? 'warn' : 'info',
      'Delete from Disk',
      `Deleted ${deleted} MP3 track(s) from disk & database`,
      errors.length > 0 ? errors.join('\n') : undefined
    )
  }

  return { deleted, errors }
}

export function deleteMusicPlaylistItemsFromDisk(
  playlistId: string,
  itemIds: string[]
): { deleted: number; errors: string[] } {
  const d = getDb()
  let deleted = 0
  const errors: string[] = []
  const trackIdsToDelete: string[] = []

  const getItem = d.prepare(
    `SELECT id, track_id, value FROM music_playlist_items WHERE id = ? AND playlist_id = ?`
  )
  const delItem = d.prepare(`DELETE FROM music_playlist_items WHERE id = ?`)

  withTransaction(() => {
    for (const itemId of itemIds) {
      const item = getItem.get(itemId, playlistId) as any
      if (!item) continue
      if (item.track_id) {
        trackIdsToDelete.push(item.track_id)
      } else if (item.value && fs.existsSync(item.value)) {
        try {
          fs.unlinkSync(item.value)
          invalidateFileExistsCache(item.value)
          deleted++
        } catch (err: any) {
          errors.push(`${path.basename(item.value)}: ${err?.message || String(err)}`)
        }
      }
      delItem.run(itemId)
    }

    const remaining = d
      .prepare(`SELECT id FROM music_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
      .all(playlistId) as Array<{ id: string }>
    const updPos = d.prepare(`UPDATE music_playlist_items SET position = ? WHERE id = ?`)
    for (let i = 0; i < remaining.length; ++i) {
      updPos.run(i, remaining[i].id)
    }
    setDomainModified('music', true)
  })

  if (trackIdsToDelete.length > 0) {
    const sub = deleteTracksFromDisk(Array.from(new Set(trackIdsToDelete)))
    deleted += sub.deleted
    errors.push(...sub.errors)
  } else if (deleted > 0) {
    invalidateMusicLibraryCache()
  }

  return { deleted, errors }
}

export function updateMp3Tags(payload: Mp3TagUpdatePayload): { updated: number; errors: string[] } {
  const d = getDb()
  let updated = 0
  const errors: string[] = []
  let touchedActive = false

  // Avoid selecting cover_art_base64 unless we actually need to preserve/update it
  const getTrack = d.prepare(
    `SELECT id, file_path, filename, artist, title, album, year, genre, track_number, show_tags, cover_art_mime
     FROM mp3_tracks WHERE id = ?`
  )
  const updateNoArt = d.prepare(`
    UPDATE mp3_tracks
    SET artist = ?, title = ?, album = ?, year = ?, genre = ?, track_number = ?, show_tags = ?
    WHERE id = ?
  `)
  const updateWithArt = d.prepare(`
    UPDATE mp3_tracks
    SET artist = ?, title = ?, album = ?, year = ?, genre = ?, track_number = ?,
        show_tags = ?, cover_art_mime = ?, cover_art_base64 = ?
    WHERE id = ?
  `)
  const updatePlItems = d.prepare(`
    UPDATE music_playlist_items
    SET artist = ?, title = ?, show_tags = ?
    WHERE track_id = ? OR LOWER(REPLACE(value, '\\', '/')) = ?
  `)
  const checkActiveStmt = d.prepare(`
    SELECT COUNT(*) as c
    FROM music_playlist_items i
    JOIN music_playlists p ON p.id = i.playlist_id
    WHERE p.in_active_json = 1 AND (i.track_id = ? OR LOWER(REPLACE(i.value, '\\', '/')) = ?)
  `)
  const getMetaStmt = d.prepare(`SELECT * FROM mp3_track_meta WHERE track_id = ?`)
  const upsertMetaStmt = d.prepare(`
    INSERT INTO mp3_track_meta (track_id, rating, added_at, synced_lyrics, unsynced_lyrics, comment, channels, codec, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET
      rating = excluded.rating,
      synced_lyrics = excluded.synced_lyrics,
      unsynced_lyrics = excluded.unsynced_lyrics,
      comment = excluded.comment
  `)

  withTransaction(() => {
    for (const trackId of payload.trackIds) {
      const row = getTrack.get(trackId) as any
      if (!row) continue

      const nextArtist = payload.artist !== undefined ? payload.artist : row.artist
      const nextTitle = payload.title !== undefined ? payload.title : row.title
      const nextAlbum = payload.album !== undefined ? payload.album : row.album
      const nextYear = payload.year !== undefined ? payload.year : row.year
      const nextGenre = payload.genre !== undefined ? payload.genre : row.genre
      const nextTrackNum = payload.trackNumber !== undefined ? payload.trackNumber : row.track_number
      const nextShowTags =
        payload.showTags !== undefined ? (payload.showTags ? 1 : 0) : Number(row.show_tags)

      const curMeta = (getMetaStmt.get(trackId) as any) || {}
      const nextRating =
        payload.rating !== undefined
          ? Math.max(0, Math.min(5, Math.round(Number(payload.rating) || 0)))
          : Number(curMeta.rating || 0)
      const nextSyncedLyrics =
        payload.syncedLyrics !== undefined ? payload.syncedLyrics : String(curMeta.synced_lyrics || '')
      const nextUnsyncedLyrics =
        payload.unsyncedLyrics !== undefined
          ? payload.unsyncedLyrics
          : String(curMeta.unsynced_lyrics || '')
      const nextComment =
        payload.comment !== undefined ? payload.comment : String(curMeta.comment || '')

      if (payload.writeToFile && fs.existsSync(row.file_path)) {
        const writeRes = writeMp3Id3Tags(row.file_path, {
          artist: nextArtist,
          title: nextTitle,
          album: nextAlbum,
          year: nextYear,
          genre: nextGenre,
          trackNumber: nextTrackNum,
          rating: payload.rating !== undefined ? nextRating : undefined,
          comment: payload.comment !== undefined ? nextComment : undefined,
          unsyncedLyrics: payload.unsyncedLyrics !== undefined ? nextUnsyncedLyrics : undefined,
          syncedLyrics: payload.syncedLyrics !== undefined ? nextSyncedLyrics : undefined,
          coverArtBase64: payload.coverArtBase64 !== undefined ? payload.coverArtBase64 : undefined,
          coverArtMime: payload.coverArtMime !== undefined ? payload.coverArtMime : undefined
        })
        if (!writeRes.ok && writeRes.error) {
          errors.push(`${row.filename}: ${writeRes.error}`)
        }
      }

      upsertMetaStmt.run(
        trackId,
        nextRating,
        curMeta.added_at || new Date().toISOString(),
        nextSyncedLyrics,
        nextUnsyncedLyrics,
        nextComment,
        Number(curMeta.channels || 2),
        curMeta.codec || 'MP3',
        Number(curMeta.file_size || 0)
      )

      if (payload.coverArtBase64 !== undefined) {
        updateWithArt.run(
          nextArtist,
          nextTitle,
          nextAlbum,
          nextYear,
          nextGenre,
          nextTrackNum,
          nextShowTags,
          payload.coverArtMime || '',
          payload.coverArtBase64 || '',
          trackId
        )
      } else {
        updateNoArt.run(
          nextArtist,
          nextTitle,
          nextAlbum,
          nextYear,
          nextGenre,
          nextTrackNum,
          nextShowTags,
          trackId
        )
      }

      const normPath = String(row.file_path).replace(/\\/g, '/').toLowerCase()
      updatePlItems.run(nextArtist, nextTitle, nextShowTags, trackId, normPath)

      const activeCount = (checkActiveStmt.get(trackId, normPath) as { c: number }).c
      if (activeCount > 0) touchedActive = true
      updated++
    }

    if (touchedActive) {
      setDomainModified('music', true)
    }
  })

  if (updated > 0) {
    invalidateMusicLibraryCache()
  }

  return { updated, errors }
}

export function setMp3TracksRating(
  trackIds: string[],
  rating: number
): { updated: number; errors: string[] } {
  if (trackIds.length === 0) return { updated: 0, errors: [] }
  const clamped = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)))
  const d = getDb()
  const now = new Date().toISOString()
  let updated = 0
  const errors: string[] = []

  const getTrack = d.prepare(`SELECT id, file_path, filename FROM mp3_tracks WHERE id = ?`)
  const upsertMeta = d.prepare(`
    INSERT INTO mp3_track_meta (track_id, rating, added_at)
    VALUES (?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET rating = excluded.rating
  `)

  withTransaction(() => {
    for (const trackId of trackIds) {
      const row = getTrack.get(trackId) as { id: string; file_path: string; filename: string } | undefined
      if (!row) continue
      upsertMeta.run(trackId, clamped, now)
      if (row.file_path && fs.existsSync(row.file_path)) {
        const writeRes = writeMp3Id3Tags(row.file_path, { rating: clamped })
        if (!writeRes.ok && writeRes.error) {
          errors.push(`${row.filename}: ${writeRes.error}`)
        }
      }
      updated++
    }
  })

  updateMp3RatingInMemoryCache(trackIds, clamped)
  return { updated, errors }
}

export async function inspectMp3TrackDetailedMetadata(
  trackId: string
): Promise<Mp3DetailedMetadata | null> {
  const d = getDb()
  const row = d
    .prepare(
      `SELECT t.id, t.file_path, t.filename, t.artist, t.title, t.album, t.year, t.genre,
              t.track_number, t.duration, t.bitrate, t.sample_rate,
              COALESCE(tm.rating, 0) as rating,
              COALESCE(tm.added_at, '') as added_at,
              COALESCE(tm.synced_lyrics, '') as synced_lyrics,
              COALESCE(tm.unsynced_lyrics, '') as unsynced_lyrics,
              COALESCE(tm.comment, '') as comment,
              COALESCE(tm.channels, 2) as channels,
              COALESCE(tm.codec, 'MP3') as codec,
              COALESCE(tm.file_size, 0) as file_size
       FROM mp3_tracks t
       LEFT JOIN mp3_track_meta tm ON tm.track_id = t.id
       WHERE t.id = ?`
    )
    .get(trackId) as any
  if (!row) return null

  let artist = String(row.artist || '')
  let title = String(row.title || '')
  let album = String(row.album || '')
  let year = String(row.year || '')
  let genre = String(row.genre || '')
  let trackNumber = String(row.track_number || '')
  let duration = Number(row.duration || 0)
  let bitrate = Number(row.bitrate || 0)
  let sampleRate = Number(row.sample_rate || 0)
  let rating = Number(row.rating || 0)
  let rawRatingTag = ''
  let rawStarsTag = ''
  let channels = Number(row.channels || 2)
  let codec = String(row.codec || 'MP3')
  let tagTypes = 'ID3v2'
  let fileSize = Number(row.file_size || 0)
  let addedAt = String(row.added_at || '')
  let comment = String(row.comment || '')
  let unsyncedLyrics = String(row.unsynced_lyrics || '')
  let syncedLyrics = String(row.synced_lyrics || '')

  if (row.file_path && fs.existsSync(row.file_path)) {
    try {
      const extracted = await extractMp3Metadata(row.file_path, { skipCovers: true })
      rawRatingTag = extracted.rawRatingTag
      rawStarsTag = extracted.rawStarsTag
      tagTypes = extracted.tagTypes || 'ID3v2'
      fileSize = extracted.fileSize || fileSize
      channels = extracted.channels || channels
      codec = extracted.codec || codec
      if (!comment && extracted.comment) comment = extracted.comment
      if (!unsyncedLyrics && extracted.unsyncedLyrics) unsyncedLyrics = extracted.unsyncedLyrics
      if (!syncedLyrics && extracted.syncedLyrics) syncedLyrics = extracted.syncedLyrics
      if (rating === 0 && extracted.rating > 0) rating = extracted.rating

      let needDbTrackUpdate = false
      if (!duration && extracted.duration > 0) {
        duration = extracted.duration
        needDbTrackUpdate = true
      }
      if (!bitrate && extracted.bitrate > 0) {
        bitrate = extracted.bitrate
        needDbTrackUpdate = true
      }
      if (!sampleRate && extracted.sampleRate > 0) {
        sampleRate = extracted.sampleRate
        needDbTrackUpdate = true
      }
      if (!year && extracted.year) {
        year = extracted.year
        needDbTrackUpdate = true
      }
      if (!album && extracted.album) {
        album = extracted.album
        needDbTrackUpdate = true
      }
      if (!genre && extracted.genre) {
        genre = extracted.genre
        needDbTrackUpdate = true
      }
      if (!trackNumber && extracted.trackNumber) {
        trackNumber = extracted.trackNumber
        needDbTrackUpdate = true
      }

      if (needDbTrackUpdate) {
        d.prepare(
          `UPDATE mp3_tracks
           SET album = ?, year = ?, genre = ?, track_number = ?, duration = ?, bitrate = ?, sample_rate = ?
           WHERE id = ?`
        ).run(album, year, genre, trackNumber, duration, bitrate, sampleRate, trackId)
        invalidateMusicLibraryCache()
      }

      d.prepare(
        `INSERT INTO mp3_track_meta (track_id, rating, added_at, synced_lyrics, unsynced_lyrics, comment, channels, codec, file_size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET
           rating = excluded.rating,
           synced_lyrics = excluded.synced_lyrics,
           unsynced_lyrics = excluded.unsynced_lyrics,
           comment = excluded.comment,
           channels = excluded.channels,
           codec = excluded.codec,
           file_size = excluded.file_size`
      ).run(
        trackId,
        rating,
        addedAt || new Date().toISOString(),
        syncedLyrics,
        unsyncedLyrics,
        comment,
        channels,
        codec,
        fileSize
      )
      updateMp3RatingInMemoryCache([trackId], rating)
    } catch {
      // ignore disk parse error
    }
  }

  const firstLine = getFirstSyncedLyricsLine(syncedLyrics)
  return {
    trackId,
    filePath: row.file_path,
    artist,
    title,
    album,
    year,
    genre,
    trackNumber,
    rating,
    rawRatingTag,
    rawStarsTag,
    duration,
    bitrate,
    sampleRate,
    channels,
    codec,
    tagTypes,
    fileSize,
    addedAt,
    comment,
    unsyncedLyrics,
    syncedLyrics,
    hasSyncedLyrics: Boolean(syncedLyrics && syncedLyrics.trim()),
    syncedLyricsFirstLine: firstLine
  }
}

export async function refreshMp3TracksMetadata(
  trackIds?: string[]
): Promise<{ refreshed: number; errors: string[] }> {
  const d = getDb()
  let rows: Array<{ id: string; file_path: string; filename: string }> = []
  if (trackIds && trackIds.length > 0) {
    const getOne = d.prepare(`SELECT id, file_path, filename FROM mp3_tracks WHERE id = ?`)
    for (const id of trackIds) {
      const r = getOne.get(id) as { id: string; file_path: string; filename: string } | undefined
      if (r) rows.push(r)
    }
  } else {
    rows = d.prepare(`SELECT id, file_path, filename FROM mp3_tracks`).all() as Array<{
      id: string
      file_path: string
      filename: string
    }>
  }

  const updateTrack = d.prepare(`
    UPDATE mp3_tracks
    SET artist = CASE WHEN ? != '' THEN ? ELSE artist END,
        title = CASE WHEN ? != '' THEN ? ELSE title END,
        album = ?,
        year = ?,
        genre = ?,
        track_number = ?,
        duration = ?,
        bitrate = ?,
        sample_rate = ?
    WHERE id = ?
  `)
  const upsertMeta = d.prepare(`
    INSERT INTO mp3_track_meta (track_id, rating, added_at, synced_lyrics, unsynced_lyrics, comment, channels, codec, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET
      rating = excluded.rating,
      synced_lyrics = excluded.synced_lyrics,
      unsynced_lyrics = excluded.unsynced_lyrics,
      comment = excluded.comment,
      channels = excluded.channels,
      codec = excluded.codec,
      file_size = excluded.file_size
  `)

  let refreshed = 0
  const errors: string[] = []
  const now = new Date().toISOString()

  for (const row of rows) {
    if (!row.file_path || !fs.existsSync(row.file_path)) continue
    try {
      const meta = await extractMp3Metadata(row.file_path, { skipCovers: true })
      updateTrack.run(
        meta.artist,
        meta.artist,
        meta.title,
        meta.title,
        meta.album,
        meta.year,
        meta.genre,
        meta.trackNumber,
        meta.duration,
        meta.bitrate,
        meta.sampleRate,
        row.id
      )
      upsertMeta.run(
        row.id,
        meta.rating,
        now,
        meta.syncedLyrics,
        meta.unsyncedLyrics,
        meta.comment,
        meta.channels,
        meta.codec,
        meta.fileSize
      )
      refreshed++
    } catch (err: any) {
      errors.push(`${row.filename}: ${err?.message || String(err)}`)
    }
  }

  if (refreshed > 0) {
    invalidateMusicLibraryCache()
  }

  return { refreshed, errors }
}

export async function importMusicJsonFile(
  jsonFilePath: string,
  markAsActiveJson = false
): Promise<{ importedPlaylists: number; importedTracks: number }> {
  const d = getDb()
  const raw = fs.readFileSync(jsonFilePath, 'utf8')
  const parsed = JSON.parse(raw)

  let rawPlaylists: Array<{ name: string; items: Array<any> }> = []
  if (Array.isArray(parsed.playlists)) {
    rawPlaylists = parsed.playlists
  } else if (Array.isArray(parsed.items)) {
    rawPlaylists = [{ name: parsed.name || path.basename(jsonFilePath, '.json'), items: parsed.items }]
  } else {
    throw new Error(`Unrecognized playlist JSON structure in ${path.basename(jsonFilePath)}`)
  }

  return withTransaction(() => {
    if (markAsActiveJson) {
      d.prepare(`UPDATE music_playlists SET in_active_json = 0, active_order = 0`).run()
    }

    const existingTracks = d
      .prepare(`SELECT id, file_path, original_path FROM mp3_tracks`)
      .all() as Array<{ id: string; file_path: string; original_path: string }>
    const trackMap = new Map<string, string>()
    for (const t of existingTracks) {
      trackMap.set(t.file_path.replace(/\\/g, '/').toLowerCase(), t.id)
      trackMap.set(t.original_path.replace(/\\/g, '/').toLowerCase(), t.id)
    }

    const insertTrack = d.prepare(`
      INSERT INTO mp3_tracks (
        id, library_id, file_path, original_path, is_managed, filename,
        artist, title, album, year, genre, track_number,
        duration, bitrate, sample_rate, show_tags,
        cover_art_mime, cover_art_base64, added_at
      ) VALUES (?, 'default-mp3-lib', ?, ?, 0, ?, ?, ?, '', '', '', '', 0, 0, 0, ?, '', '', ?)
    `)

    let importedPlaylists = 0
    let importedTracks = 0
    const now = new Date().toISOString()

    for (let pIdx = 0; pIdx < rawPlaylists.length; ++pIdx) {
      const plObj = rawPlaylists[pIdx]
      const baseName = String(plObj.name || `Playlist ${pIdx + 1}`).trim()
      const items = Array.isArray(plObj.items) ? plObj.items : []

      // Check if playlist with same name already exists
      const existingPl = d
        .prepare(`SELECT id FROM music_playlists WHERE LOWER(name) = LOWER(?)`)
        .get(baseName) as { id: string } | undefined

      let playlistId: string
      if (existingPl) {
        playlistId = existingPl.id
        d.prepare(
          `UPDATE music_playlists
           SET in_active_json = ?, active_order = ?, updated_at = ?, source_origin = ?
           WHERE id = ?`
        ).run(markAsActiveJson ? 1 : 0, pIdx, now, path.basename(jsonFilePath), playlistId)
        d.prepare(`DELETE FROM music_playlist_items WHERE playlist_id = ?`).run(playlistId)
      } else {
        playlistId = `mpl-${crypto.randomUUID()}`
        d.prepare(
          `INSERT INTO music_playlists (id, name, source_origin, in_active_json, active_order, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(playlistId, baseName, path.basename(jsonFilePath), markAsActiveJson ? 1 : 0, pIdx, now)
      }

      const insertItem = d.prepare(`
        INSERT INTO music_playlist_items (id, playlist_id, track_id, position, value, artist, title, show_tags, uuid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (let iIdx = 0; iIdx < items.length; ++iIdx) {
        const it = items[iIdx]
        const val = String(it.value || '').trim()
        if (!val) continue
        const normVal = val.replace(/\\/g, '/')
        const key = normVal.toLowerCase()
        const artist = String(it.artist || '').trim()
        const title = String(it.title || path.basename(normVal, path.extname(normVal))).trim()
        const showTags = it.show_tags !== false ? 1 : 0
        const uuid = String(it.uuid || crypto.randomUUID())

        let trackId = trackMap.get(key) || null
        if (!trackId) {
          trackId = `mp3-${crypto.randomUUID()}`
          insertTrack.run(trackId, normVal, normVal, path.basename(normVal), artist, title, showTags, now)
          trackMap.set(key, trackId)
          importedTracks++
        }

        insertItem.run(
          `mpli-${crypto.randomUUID()}`,
          playlistId,
          trackId,
          iIdx,
          val,
          artist,
          title,
          showTags,
          uuid
        )
      }

      importedPlaylists++
    }

    if (importedTracks > 0) {
      invalidateMusicLibraryCache()
    }

    return { importedPlaylists, importedTracks }
  })
}

export function createMusicPlaylist(name: string, addToActiveJson = false): string {
  const d = getDb()
  const uniqueName = makeUniquePlaylistName('music_playlists', name || 'New Playlist')
  const id = `mpl-${crypto.randomUUID()}`
  const maxOrder = (
    d.prepare(`SELECT COALESCE(MAX(active_order), -1) as m FROM music_playlists WHERE in_active_json = 1`).get() as {
      m: number
    }
  ).m
  d.prepare(
    `INSERT INTO music_playlists (id, name, source_origin, in_active_json, active_order, updated_at)
     VALUES (?, ?, 'curationist', ?, ?, ?)`
  ).run(id, uniqueName, addToActiveJson ? 1 : 0, maxOrder + 1, new Date().toISOString())

  if (addToActiveJson) {
    setDomainModified('music', true)
  }
  return id
}

export function renameMusicPlaylist(playlistId: string, newName: string): void {
  const d = getDb()
  const pl = d.prepare(`SELECT * FROM music_playlists WHERE id = ?`).get(playlistId) as any
  if (!pl) return
  const trimmed = newName.trim()
  if (!trimmed || trimmed === pl.name) return
  const unique = makeUniquePlaylistName('music_playlists', trimmed, playlistId)
  d.prepare(`UPDATE music_playlists SET name = ?, updated_at = ? WHERE id = ?`).run(
    unique,
    new Date().toISOString(),
    playlistId
  )
  setDomainModified('music', true)
}

export function duplicateMusicPlaylist(playlistId: string): string {
  const d = getDb()
  const pl = d.prepare(`SELECT * FROM music_playlists WHERE id = ?`).get(playlistId) as any
  if (!pl) throw new Error('Playlist not found')
  const newId = createMusicPlaylist(`${pl.name} (Copy)`, false)
  const items = d
    .prepare(`SELECT * FROM music_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>
  const insertItem = d.prepare(`
    INSERT INTO music_playlist_items (id, playlist_id, track_id, position, value, artist, title, show_tags, uuid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  withTransaction(() => {
    for (let i = 0; i < items.length; ++i) {
      const it = items[i]
      insertItem.run(
        `mpli-${crypto.randomUUID()}`,
        newId,
        it.track_id,
        i,
        it.value,
        it.artist,
        it.title,
        it.show_tags,
        crypto.randomUUID()
      )
    }
  })
  return newId
}

export function deleteMusicPlaylist(playlistId: string): void {
  const d = getDb()
  const pl = d.prepare(`SELECT * FROM music_playlists WHERE id = ?`).get(playlistId) as any
  if (!pl) return
  d.prepare(`DELETE FROM music_playlists WHERE id = ?`).run(playlistId)
  if (pl.in_active_json) {
    setDomainModified('music', true)
  }
}

export function addTracksToMusicPlaylist(
  playlistId: string,
  trackIds: string[],
  insertAtPosition?: number
): void {
  const d = getDb()
  // Select only lightweight columns 1..16 (never cover_art_base64)
  const getTrack = d.prepare(
    `SELECT id, file_path, artist, title, show_tags FROM mp3_tracks WHERE id = ?`
  )
  const newRecords: Array<any> = []
  for (const tid of trackIds) {
    const tr = getTrack.get(tid) as any
    if (!tr) continue
    newRecords.push({
      id: `mpli-${crypto.randomUUID()}`,
      playlist_id: playlistId,
      track_id: tr.id,
      value: tr.file_path,
      artist: tr.artist,
      title: tr.title,
      show_tags: tr.show_tags,
      uuid: crypto.randomUUID()
    })
  }
  if (newRecords.length === 0) return

  if (insertAtPosition === undefined) {
    // Fast path: append directly to end of playlist without deleting existing items
    withTransaction(() => {
      const maxRow = d
        .prepare(`SELECT COALESCE(MAX(position), -1) as max_pos FROM music_playlist_items WHERE playlist_id = ?`)
        .get(playlistId) as { max_pos: number }
      let pos = Number(maxRow?.max_pos ?? -1) + 1
      const insert = d.prepare(`
        INSERT INTO music_playlist_items (id, playlist_id, track_id, position, value, artist, title, show_tags, uuid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const it of newRecords) {
        insert.run(
          it.id,
          playlistId,
          it.track_id,
          pos++,
          it.value,
          it.artist,
          it.title,
          it.show_tags,
          it.uuid
        )
      }
      d.prepare(`UPDATE music_playlists SET updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        playlistId
      )
      setDomainModified('music', true)
    })
    return
  }

  const existingItems = d
    .prepare(`SELECT * FROM music_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>

  const combined = [...existingItems]
  const targetIdx =
    insertAtPosition >= 0 && insertAtPosition <= combined.length
      ? insertAtPosition
      : combined.length
  combined.splice(targetIdx, 0, ...newRecords)

  withTransaction(() => {
    d.prepare(`DELETE FROM music_playlist_items WHERE playlist_id = ?`).run(playlistId)
    const insert = d.prepare(`
      INSERT INTO music_playlist_items (id, playlist_id, track_id, position, value, artist, title, show_tags, uuid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < combined.length; ++i) {
      const it = combined[i]
      insert.run(
        it.id,
        playlistId,
        it.track_id,
        i,
        it.value,
        it.artist,
        it.title,
        it.show_tags,
        it.uuid
      )
    }

    d.prepare(`UPDATE music_playlists SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
    setDomainModified('music', true)
  })
}

export function removeItemsFromMusicPlaylist(playlistId: string, itemIds: string[]): void {
  const d = getDb()
  const removeSet = new Set(itemIds)
  const items = d
    .prepare(`SELECT * FROM music_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>
  const remaining = items.filter((it) => !removeSet.has(it.id))

  withTransaction(() => {
    d.prepare(`DELETE FROM music_playlist_items WHERE playlist_id = ?`).run(playlistId)
    const insert = d.prepare(`
      INSERT INTO music_playlist_items (id, playlist_id, track_id, position, value, artist, title, show_tags, uuid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < remaining.length; ++i) {
      const it = remaining[i]
      insert.run(
        it.id,
        playlistId,
        it.track_id,
        i,
        it.value,
        it.artist,
        it.title,
        it.show_tags,
        it.uuid
      )
    }
    d.prepare(`UPDATE music_playlists SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
    setDomainModified('music', true)
  })
}

export function reorderMusicPlaylistItems(playlistId: string, orderedItemIds: string[]): void {
  const d = getDb()
  const updatePos = d.prepare(
    `UPDATE music_playlist_items SET position = ? WHERE id = ? AND playlist_id = ?`
  )
  withTransaction(() => {
    for (let i = 0; i < orderedItemIds.length; ++i) {
      updatePos.run(i, orderedItemIds[i], playlistId)
    }
    d.prepare(`UPDATE music_playlists SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
    setDomainModified('music', true)
  })
}

export function updateMusicPlaylistItemInline(
  itemId: string,
  updates: { artist?: string; title?: string; show_tags?: boolean }
): void {
  const d = getDb()
  const item = d.prepare(`SELECT * FROM music_playlist_items WHERE id = ?`).get(itemId) as any
  if (!item) return
  const nextArtist = updates.artist !== undefined ? updates.artist : item.artist
  const nextTitle = updates.title !== undefined ? updates.title : item.title
  const nextShow = updates.show_tags !== undefined ? (updates.show_tags ? 1 : 0) : item.show_tags
  d.prepare(`UPDATE music_playlist_items SET artist = ?, title = ?, show_tags = ? WHERE id = ?`).run(
    nextArtist,
    nextTitle,
    nextShow,
    itemId
  )
  d.prepare(`UPDATE music_playlists SET updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    item.playlist_id
  )
  setDomainModified('music', true)
}

export function setActiveMusicJsonPlaylists(orderedPlaylistIds: string[]): void {
  const d = getDb()
  withTransaction(() => {
    d.prepare(`UPDATE music_playlists SET in_active_json = 0, active_order = 0`).run()
    const setAct = d.prepare(
      `UPDATE music_playlists SET in_active_json = 1, active_order = ? WHERE id = ?`
    )
    const uniqueIds = Array.from(new Set(orderedPlaylistIds))
    for (let i = 0; i < uniqueIds.length; ++i) {
      setAct.run(i, uniqueIds[i])
    }
    setDomainModified('music', true)
  })
}

export function publishMusicPlaylistsToSavedJson(): { publishedPlaylists: number; path: string } {
  const state = getMusicWorkspaceState()
  const activePlaylists = state.playlists
    .filter((p) => p.inActiveJson)
    .sort((a, b) => a.activeOrder - b.activeOrder)

  const outputObj = {
    playlists: activePlaylists.map((p) => ({
      name: p.name,
      items: (p.items || []).map((it) => ({
        value: it.value,
        artist: it.artist,
        title: it.title,
        show_tags: it.show_tags
      }))
    }))
  }

  const jsonText = JSON.stringify(outputObj, null, 4) + '\n'
  writeFileAtomicallyWithPrivilegeFallback(state.targetJsonPath, jsonText, true)
  setDomainModified('music', false, true)
  logEvent(
    'info',
    'Publish',
    `Published ${activePlaylists.length} playlist(s) to saved-playlists.json`,
    `Target: ${state.targetJsonPath}`
  )
  return { publishedPlaylists: activePlaylists.length, path: state.targetJsonPath }
}

export function exportSingleMusicPlaylistToJson(playlistId: string, targetFilePath: string): void {
  const state = getMusicWorkspaceState()
  const pl = state.playlists.find((p) => p.id === playlistId)
  if (!pl) throw new Error('Playlist not found')

  const exportObj = {
    name: pl.name,
    items: (pl.items || []).map((it) => ({
      value: it.value,
      artist: it.artist,
      title: it.title,
      show_tags: it.show_tags,
      uuid: it.uuid || crypto.randomUUID()
    }))
  }

  writeFileAtomicallyWithPrivilegeFallback(targetFilePath, JSON.stringify(exportObj, null, 4) + '\n', false)
}

export async function discardMusicDraft(): Promise<void> {
  const settings = getSettings()
  if (fs.existsSync(settings.nowPlaylistingJsonPath)) {
    await importMusicJsonFile(settings.nowPlaylistingJsonPath, true)
  }
  setDomainModified('music', false)
}

// ============================================================================
// PRESET / OBSPILTMILK OPERATIONS
// ============================================================================

export function createPresetLibrary(name: string, description = ''): string {
  const d = getDb()
  const id = `preset-lib-${crypto.randomUUID()}`
  d.prepare(`INSERT INTO preset_libraries (id, name, description, created_at) VALUES (?, ?, ?, ?)`).run(
    id,
    name.trim() || 'New Preset Library',
    description.trim(),
    new Date().toISOString()
  )
  invalidatePresetLibraryCache()
  return id
}

export function renamePresetLibrary(id: string, name: string): void {
  const d = getDb()
  d.prepare(`UPDATE preset_libraries SET name = ? WHERE id = ?`).run(name.trim(), id)
  invalidatePresetLibraryCache()
}

export function deletePresetLibrary(id: string): void {
  if (id === 'default-preset-lib') {
    throw new Error('Cannot delete the primary obSpiltMilk preset library.')
  }
  const d = getDb()
  d.prepare(`DELETE FROM preset_libraries WHERE id = ?`).run(id)
  invalidatePresetLibraryCache()
}

export function importPresetLibraryJsonFile(
  libraryJsonPath: string,
  libraryId = 'default-preset-lib'
): { imported: number } {
  const d = getDb()
  const raw = fs.readFileSync(libraryJsonPath, 'utf8')
  const doc = JSON.parse(raw)
  const presetsDir = path.dirname(libraryJsonPath)

  const visibleRecords = Array.isArray(doc.presets) ? doc.presets : []
  const retainedRecords = Array.isArray(doc.retained_presets) ? doc.retained_presets : []

  const upsert = d.prepare(`
    INSERT INTO preset_items (
      id, library_id, filename, managed_path, original_path,
      is_managed, label, digest, repairs_json, warnings_json,
      repaired_content, is_retained_only, added_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, '', ?, ?)
    ON CONFLICT(id, library_id) DO UPDATE SET
      filename = excluded.filename,
      managed_path = excluded.managed_path,
      original_path = excluded.original_path,
      label = excluded.label,
      digest = excluded.digest,
      repairs_json = excluded.repairs_json,
      warnings_json = excluded.warnings_json,
      is_retained_only = excluded.is_retained_only
  `)

  const now = new Date().toISOString()
  let imported = 0

  const processRecord = (rec: any, retained: number) => {
    const id = String(rec.id || '').trim()
    const filename = String(rec.filename || '').trim()
    const label = String(rec.label || filename).trim()
    const originalPath = String(rec.original_path || '').trim()
    const digest = String(rec.digest || '').trim()
    if (!id || !filename) return
    const managedPath = path.join(presetsDir, filename).replace(/\\/g, '/')
    const repairs = Array.isArray(rec.repairs) ? rec.repairs : []
    const warnings = Array.isArray(rec.warnings) ? rec.warnings : []

    upsert.run(
      id,
      libraryId,
      filename,
      managedPath,
      originalPath,
      label,
      digest,
      JSON.stringify(repairs),
      JSON.stringify(warnings),
      retained,
      now
    )
    if (!retained) imported++
  }

  return withTransaction(() => {
    for (const r of visibleRecords) processRecord(r, 0)
    for (const r of retainedRecords) processRecord(r, 1)
    invalidatePresetLibraryCache()
    return { imported }
  })
}

export function importPresetPlaylistDatFile(
  datFilePath: string,
  playlistName = 'Active playlist.dat',
  markAsActiveDat = true
): { playlistId: string; itemCount: number } {
  const d = getDb()
  const settings = getSettings()
  const raw = fs.readFileSync(datFilePath, 'utf8')
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith(';'))

  return withTransaction(() => {
    if (markAsActiveDat) {
      d.prepare(`UPDATE preset_playlists SET is_active_dat = 0`).run()
    }

    const now = new Date().toISOString()
    const existingPl = d
      .prepare(`SELECT id FROM preset_playlists WHERE LOWER(name) = LOWER(?)`)
      .get(playlistName) as { id: string } | undefined

    let playlistId: string
    if (existingPl) {
      playlistId = existingPl.id
      d.prepare(
        `UPDATE preset_playlists SET is_active_dat = ?, updated_at = ?, source_origin = ? WHERE id = ?`
      ).run(markAsActiveDat ? 1 : 0, now, path.basename(datFilePath), playlistId)
      d.prepare(`DELETE FROM preset_playlist_items WHERE playlist_id = ?`).run(playlistId)
    } else {
      playlistId = `ppl-${crypto.randomUUID()}`
      d.prepare(
        `INSERT INTO preset_playlists (id, name, source_origin, is_active_dat, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(playlistId, playlistName, path.basename(datFilePath), markAsActiveDat ? 1 : 0, now)
    }

    // Build lookup of known presets by originalPath, managedPath, and basename
    const allPresets = d.prepare(`SELECT * FROM preset_items`).all() as Array<any>
    const byPath = new Map<string, any>()
    const byLabel = new Map<string, any>()
    for (const p of allPresets) {
      byPath.set(String(p.managed_path).replace(/\\/g, '/').toLowerCase(), p)
      byPath.set(String(p.original_path).replace(/\\/g, '/').toLowerCase(), p)
      byLabel.set(String(p.label).toLowerCase(), p)
    }

    const insertPlItem = d.prepare(`
      INSERT INTO preset_playlist_items (id, playlist_id, preset_id, position, label, managed_path, original_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    let pos = 0
    for (const line of lines) {
      const normLine = line.replace(/\\/g, '/')
      const base = path.basename(normLine)
      let matched = byPath.get(normLine.toLowerCase()) || byLabel.get(base.toLowerCase())

      if (!matched && fs.existsSync(line) && line.toLowerCase().endsWith('.milk')) {
        const prep = preparePresetFileForLibrary(line)
        if (prep.ok) {
          const managedPath = path
            .join(settings.presetManagedStoragePath, prep.preset.filename)
            .replace(/\\/g, '/')
          d.prepare(`
            INSERT OR IGNORE INTO preset_items (
              id, library_id, filename, managed_path, original_path,
              is_managed, label, digest, repairs_json, warnings_json,
              repaired_content, is_retained_only, added_at
            ) VALUES (?, 'default-preset-lib', ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?)
          `).run(
            prep.preset.id,
            prep.preset.filename,
            managedPath,
            prep.preset.originalPath,
            prep.preset.label,
            prep.preset.digest,
            JSON.stringify(prep.preset.repairs),
            JSON.stringify(prep.preset.warnings),
            prep.preset.repairedContent,
            now
          )
          matched = {
            id: prep.preset.id,
            label: prep.preset.label,
            managed_path: managedPath,
            original_path: prep.preset.originalPath
          }
        }
      }

      const presetId = matched?.id || crypto.createHash('sha256').update(normLine).digest('hex')
      const label = matched?.label || base
      const managedPath = matched?.managed_path || normLine
      const originalPath = matched?.original_path || normLine

      insertPlItem.run(
        `ppli-${crypto.randomUUID()}`,
        playlistId,
        presetId,
        pos++,
        label,
        managedPath,
        originalPath
      )
    }

    invalidatePresetLibraryCache()
    return { playlistId, itemCount: pos }
  })
}

export function importPresetFilesOrFolders(
  paths: string[],
  libraryId: string,
  copyToManaged: boolean,
  options?: { targetFolderPath?: string; move?: boolean }
): ImportBatchResult {
  const d = getDb()
  const settings = getSettings()
  const targetStorageDir = resolveSelectedPresetStoragePath(options?.targetFolderPath)
  const shouldMove = options?.move ?? settings.presetManagedTransferMode === 'move'
  const files = collectFilesRecursively(paths, ['.milk'])

  const result: ImportBatchResult = {
    imported: 0,
    duplicates: 0,
    repaired: 0,
    warnings: 0,
    errors: []
  }

  if (copyToManaged) {
    fs.mkdirSync(targetStorageDir, { recursive: true })
  }

  const existingRows = d
    .prepare(`SELECT id, managed_path, is_retained_only, label FROM preset_items WHERE library_id = ?`)
    .all(libraryId) as Array<{
    id: string
    managed_path: string
    is_retained_only: number
    label: string
  }>
  const existingMap = new Map<string, (typeof existingRows)[0]>()
  for (const r of existingRows) {
    existingMap.set(r.id, r)
  }

  const upsertStmt = d.prepare(`
    INSERT INTO preset_items (
      id, library_id, filename, managed_path, original_path,
      is_managed, label, digest, repairs_json, warnings_json,
      repaired_content, is_retained_only, added_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(id, library_id) DO UPDATE SET
      is_managed = excluded.is_managed,
      managed_path = excluded.managed_path,
      original_path = excluded.original_path,
      repaired_content = excluded.repaired_content,
      is_retained_only = 0
  `)

  const now = new Date().toISOString()

  for (const file of files) {
    const prep = preparePresetFileForLibrary(file)
    if (!prep.ok) {
      result.errors.push(`${path.basename(file)}: ${prep.error}`)
      continue
    }

    const p = prep.preset
    const existing = existingMap.get(p.id)
    const managedPath = path.join(settings.presetManagedStoragePath, p.filename).replace(/\\/g, '/')

    if (existing && !existing.is_retained_only) {
      if (!copyToManaged || fs.existsSync(managedPath)) {
        result.duplicates++
        continue
      }
    }

    const preservedLabel = existing ? existing.label : p.label
    let storedOriginalPath = p.originalPath
    if (copyToManaged) {
      try {
        const consolidatedDest = copyFileToManagedFolder(file, targetStorageDir, shouldMove).replace(
          /\\/g,
          '/'
        )
        storedOriginalPath = consolidatedDest
        invalidateFileExistsCache(consolidatedDest)
      } catch (err: any) {
        result.errors.push(`${p.label}: ${err?.message || String(err)}`)
        continue
      }
    }

    upsertStmt.run(
      p.id,
      libraryId,
      p.filename,
      managedPath,
      storedOriginalPath,
      copyToManaged ? 1 : 0,
      preservedLabel,
      p.digest,
      JSON.stringify(p.repairs),
      JSON.stringify(p.warnings),
      p.repairedContent,
      now
    )

    if (p.repairs.length > 0) result.repaired++
    if (p.warnings.length > 0) result.warnings++
    result.imported++
  }

  if (result.imported > 0) {
    setDomainModified('presets', true)
    invalidatePresetLibraryCache()
  }

  logEvent(
    result.errors.length > 0 ? 'warn' : 'info',
    'Preset Import',
    `Imported ${result.imported} preset(s), ${result.repaired} auto-repaired, ${result.warnings} with warnings, ${result.duplicates} duplicate(s) skipped${
      result.errors.length > 0 ? `, ${result.errors.length} rejected` : ''
    }`,
    result.errors.length > 0 ? result.errors.join('\n') : undefined
  )

  return result
}

export function copyPresetsToManagedStorage(
  presetIds: string[],
  libraryId?: string,
  options?: { targetFolderPath?: string; move?: boolean }
): { copied: number; errors: string[] } {
  if (presetIds.length === 0) return { copied: 0, errors: [] }
  const d = getDb()
  const settings = getSettings()
  const targetStorageDir = resolveSelectedPresetStoragePath(options?.targetFolderPath)
  const shouldMove = options?.move ?? settings.presetManagedTransferMode === 'move'
  fs.mkdirSync(targetStorageDir, { recursive: true })

  let copied = 0
  const errors: string[] = []

  const rows = libraryId
    ? (d
        .prepare(`SELECT * FROM preset_items WHERE library_id = ? AND id IN (${presetIds.map(() => '?').join(',')})`)
        .all(libraryId, ...presetIds) as Array<any>)
    : (d
        .prepare(`SELECT * FROM preset_items WHERE id IN (${presetIds.map(() => '?').join(',')})`)
        .all(...presetIds) as Array<any>)

  const markManaged = d.prepare(
    `UPDATE preset_items SET is_managed = 1, original_path = ?, managed_path = ? WHERE id = ? AND library_id = ?`
  )
  const updatePlItems = d.prepare(
    `UPDATE preset_playlist_items SET original_path = ? WHERE preset_id = ?`
  )

  withTransaction(() => {
    for (const r of rows) {
      try {
        let destPath = ''
        if (r.original_path && fs.existsSync(r.original_path)) {
          destPath = copyFileToManagedFolder(r.original_path, targetStorageDir, shouldMove).replace(
            /\\/g,
            '/'
          )
        } else if (r.managed_path && fs.existsSync(r.managed_path)) {
          const baseName = r.label?.toLowerCase().endsWith('.milk')
            ? r.label
            : `${r.label || r.id}.milk`
          const targetFile = path.join(targetStorageDir, baseName)
          fs.copyFileSync(r.managed_path, targetFile)
          destPath = targetFile.replace(/\\/g, '/')
        } else if (r.repaired_content) {
          const baseName = r.label?.toLowerCase().endsWith('.milk')
            ? r.label
            : `${r.label || r.id}.milk`
          const targetFile = path.join(targetStorageDir, baseName)
          writeFileAtomicallyWithPrivilegeFallback(targetFile, r.repaired_content, false)
          destPath = targetFile.replace(/\\/g, '/')
        } else {
          throw new Error(`Source preset file missing: ${r.original_path}`)
        }

        invalidateFileExistsCache(destPath)
        const managedPath = r.managed_path || path.join(settings.presetManagedStoragePath, r.filename).replace(/\\/g, '/')
        markManaged.run(destPath, managedPath, r.id, r.library_id)
        updatePlItems.run(destPath, r.id)
        copied++
      } catch (err: any) {
        errors.push(`${r.label}: ${err?.message || String(err)}`)
      }
    }

    if (copied > 0) {
      setDomainModified('presets', true)
    }
  })

  if (copied > 0) {
    invalidatePresetLibraryCache()
    logEvent(
      errors.length > 0 ? 'warn' : 'info',
      'Managed Storage',
      `${shouldMove ? 'Moved' : 'Copied'} ${copied} preset(s) to "${targetStorageDir}"`,
      errors.length > 0 ? errors.join('\n') : undefined
    )
  }

  return { copied, errors }
}

export function setPresetsRating(presetIds: string[], rating: number): void {
  if (presetIds.length === 0) return
  const clamped = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)))
  const d = getDb()
  const now = new Date().toISOString()
  const upsert = d.prepare(`
    INSERT INTO preset_ratings (preset_id, rating, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(preset_id) DO UPDATE SET
      rating = excluded.rating,
      updated_at = excluded.updated_at
  `)
  withTransaction(() => {
    for (const pid of presetIds) {
      upsert.run(pid, clamped, now)
    }
  })
  updatePresetRatingInMemoryCache(presetIds, clamped)
}

export function relabelPreset(presetId: string, newLabel: string): void {
  const trimmed = newLabel.trim()
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
    throw new Error('Preset labels must be nonempty and fit on one line.')
  }
  const d = getDb()
  withTransaction(() => {
    d.prepare(`UPDATE preset_items SET label = ? WHERE id = ?`).run(trimmed, presetId)
    d.prepare(`UPDATE preset_playlist_items SET label = ? WHERE preset_id = ?`).run(trimmed, presetId)
    setDomainModified('presets', true)
  })
  invalidatePresetLibraryCache()
}

export function removePresetsFromLibrary(presetIds: string[], libraryId?: string): void {
  const d = getDb()
  const stmt = libraryId
    ? d.prepare(`UPDATE preset_items SET is_retained_only = 1 WHERE id = ? AND library_id = ?`)
    : d.prepare(`UPDATE preset_items SET is_retained_only = 1 WHERE id = ?`)

  withTransaction(() => {
    for (const id of presetIds) {
      if (libraryId) stmt.run(id, libraryId)
      else stmt.run(id)
    }
    setDomainModified('presets', true)
  })
  invalidatePresetLibraryCache()
}

export function deletePresetsFromDisk(
  presetIds: string[],
  libraryId?: string
): { deleted: number; errors: string[] } {
  if (presetIds.length === 0) return { deleted: 0, errors: [] }
  const d = getDb()
  let deleted = 0
  const errors: string[] = []
  const affectedPlaylists = new Set<string>()

  const getRows = d.prepare(
    `SELECT id, library_id, label, original_path, managed_path FROM preset_items WHERE id = ?`
  )
  const delPresetAll = d.prepare(`DELETE FROM preset_items WHERE id = ?`)
  const delPresetLib = d.prepare(`DELETE FROM preset_items WHERE id = ? AND library_id = ?`)
  const delRating = d.prepare(`DELETE FROM preset_ratings WHERE preset_id = ?`)
  const findPlItems = d.prepare(`SELECT id, playlist_id FROM preset_playlist_items WHERE preset_id = ?`)
  const delPlItem = d.prepare(`DELETE FROM preset_playlist_items WHERE id = ?`)

  withTransaction(() => {
    for (const pid of presetIds) {
      const rows = getRows.all(pid) as Array<any>
      if (rows.length === 0) continue

      const candidatePaths = new Set<string>()
      for (const r of rows) {
        if (r.original_path) candidatePaths.add(r.original_path)
        if (r.managed_path) candidatePaths.add(r.managed_path)
      }

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p)
            invalidateFileExistsCache(p)
          } catch (err: any) {
            errors.push(`${path.basename(p)}: ${err?.message || String(err)}`)
          }
        }
      }

      const plHits = findPlItems.all(pid) as Array<{ id: string; playlist_id: string }>
      for (const hit of plHits) {
        delPlItem.run(hit.id)
        affectedPlaylists.add(hit.playlist_id)
      }

      if (libraryId) {
        delPresetLib.run(pid, libraryId)
      } else {
        delPresetAll.run(pid)
      }
      delRating.run(pid)
      deleted++
    }

    for (const plId of affectedPlaylists) {
      const remaining = d
        .prepare(`SELECT id FROM preset_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
        .all(plId) as Array<{ id: string }>
      const updPos = d.prepare(`UPDATE preset_playlist_items SET position = ? WHERE id = ?`)
      for (let i = 0; i < remaining.length; ++i) {
        updPos.run(i, remaining[i].id)
      }
    }
    setDomainModified('presets', true)
  })

  if (deleted > 0) {
    invalidatePresetLibraryCache()
    logEvent(
      errors.length > 0 ? 'warn' : 'info',
      'Delete from Disk',
      `Deleted ${deleted} preset(s) from disk & database`,
      errors.length > 0 ? errors.join('\n') : undefined
    )
  }

  return { deleted, errors }
}

export function deletePresetPlaylistItemsFromDisk(
  playlistId: string,
  itemIds: string[]
): { deleted: number; errors: string[] } {
  if (itemIds.length === 0) return { deleted: 0, errors: [] }
  const d = getDb()
  let deleted = 0
  const errors: string[] = []
  const presetIdsToDelete: string[] = []

  const getItem = d.prepare(
    `SELECT id, preset_id, original_path, managed_path FROM preset_playlist_items WHERE id = ? AND playlist_id = ?`
  )
  const delItem = d.prepare(`DELETE FROM preset_playlist_items WHERE id = ?`)

  withTransaction(() => {
    for (const itemId of itemIds) {
      const item = getItem.get(itemId, playlistId) as any
      if (!item) continue
      if (item.preset_id) {
        presetIdsToDelete.push(item.preset_id)
      }
      for (const p of [item.original_path, item.managed_path].filter(Boolean)) {
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p)
            invalidateFileExistsCache(p)
          } catch (err: any) {
            errors.push(`${path.basename(p)}: ${err?.message || String(err)}`)
          }
        }
      }
      delItem.run(itemId)
    }

    const remaining = d
      .prepare(`SELECT id FROM preset_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
      .all(playlistId) as Array<{ id: string }>
    const updPos = d.prepare(`UPDATE preset_playlist_items SET position = ? WHERE id = ?`)
    for (let i = 0; i < remaining.length; ++i) {
      updPos.run(i, remaining[i].id)
    }
    setDomainModified('presets', true)
  })

  if (presetIdsToDelete.length > 0) {
    const sub = deletePresetsFromDisk(Array.from(new Set(presetIdsToDelete)))
    deleted += sub.deleted
    errors.push(...sub.errors)
  } else {
    invalidatePresetLibraryCache()
  }

  return { deleted, errors }
}

export function inspectPreset(presetId: string): PresetInspectionResult {
  const d = getDb()
  const row = d.prepare(`SELECT * FROM preset_items WHERE id = ? LIMIT 1`).get(presetId) as any
  if (!row) throw new Error('Preset not found in database')

  let originalContent = ''
  let repairedContent = row.repaired_content || ''

  if (row.original_path && fs.existsSync(row.original_path)) {
    try {
      originalContent = fs.readFileSync(row.original_path, 'utf8')
    } catch {
      originalContent = '(Unable to read original file)'
    }
  }

  if (!repairedContent && row.managed_path && fs.existsSync(row.managed_path)) {
    try {
      repairedContent = fs.readFileSync(row.managed_path, 'utf8')
    } catch {
      repairedContent = '(Unable to read managed file)'
    }
  } else if (!repairedContent && originalContent) {
    const prep = preparePresetImport(originalContent)
    if (prep.accepted) repairedContent = prep.content
  }

  return {
    id: row.id,
    label: row.label,
    filename: row.filename,
    originalPath: row.original_path,
    managedPath: row.managed_path,
    digest: row.digest,
    repairs: JSON.parse(row.repairs_json || '[]'),
    warnings: JSON.parse(row.warnings_json || '[]'),
    originalContent: originalContent || repairedContent,
    repairedContent
  }
}

export function createPresetPlaylist(name: string, setAsActiveDat = false): string {
  const d = getDb()
  const uniqueName = makeUniquePlaylistName('preset_playlists', name || 'New Preset Playlist')
  const id = `ppl-${crypto.randomUUID()}`
  if (setAsActiveDat) {
    d.prepare(`UPDATE preset_playlists SET is_active_dat = 0`).run()
  }
  d.prepare(
    `INSERT INTO preset_playlists (id, name, source_origin, is_active_dat, updated_at)
     VALUES (?, ?, 'curationist', ?, ?)`
  ).run(id, uniqueName, setAsActiveDat ? 1 : 0, new Date().toISOString())

  if (setAsActiveDat) {
    setDomainModified('presets', true)
  }
  return id
}

export function renamePresetPlaylist(playlistId: string, newName: string): void {
  const d = getDb()
  const pl = d.prepare(`SELECT * FROM preset_playlists WHERE id = ?`).get(playlistId) as any
  if (!pl) return
  const trimmed = newName.trim()
  if (!trimmed || trimmed === pl.name) return
  const unique = makeUniquePlaylistName('preset_playlists', trimmed, playlistId)
  d.prepare(`UPDATE preset_playlists SET name = ?, updated_at = ? WHERE id = ?`).run(
    unique,
    new Date().toISOString(),
    playlistId
  )
}

export function duplicatePresetPlaylist(playlistId: string): string {
  const d = getDb()
  const pl = d.prepare(`SELECT * FROM preset_playlists WHERE id = ?`).get(playlistId) as any
  if (!pl) throw new Error('Preset playlist not found')
  const newId = createPresetPlaylist(`${pl.name} (Copy)`, false)
  const items = d
    .prepare(`SELECT * FROM preset_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>
  const insert = d.prepare(`
    INSERT INTO preset_playlist_items (id, playlist_id, preset_id, position, label, managed_path, original_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  withTransaction(() => {
    for (let i = 0; i < items.length; ++i) {
      const it = items[i]
      insert.run(
        `ppli-${crypto.randomUUID()}`,
        newId,
        it.preset_id,
        i,
        it.label,
        it.managed_path,
        it.original_path
      )
    }
  })
  return newId
}

export function deletePresetPlaylist(playlistId: string): void {
  const d = getDb()
  const pl = d.prepare(`SELECT * FROM preset_playlists WHERE id = ?`).get(playlistId) as any
  if (!pl) return
  d.prepare(`DELETE FROM preset_playlists WHERE id = ?`).run(playlistId)
  if (pl.is_active_dat) {
    setDomainModified('presets', true)
  }
}

export function setActivePresetPlaylist(playlistId: string): void {
  const d = getDb()
  withTransaction(() => {
    d.prepare(`UPDATE preset_playlists SET is_active_dat = 0`).run()
    d.prepare(`UPDATE preset_playlists SET is_active_dat = 1 WHERE id = ?`).run(playlistId)
    setDomainModified('presets', true)
  })
}

export function addPresetsToPresetPlaylist(
  playlistId: string,
  presetIds: string[],
  insertAtPosition?: number
): void {
  const d = getDb()
  const getPreset = d.prepare(
    `SELECT id, label, managed_path, original_path FROM preset_items WHERE id = ? LIMIT 1`
  )
  const newRecords: Array<any> = []
  for (const pid of presetIds) {
    const pr = getPreset.get(pid) as any
    if (!pr) continue
    newRecords.push({
      id: `ppli-${crypto.randomUUID()}`,
      playlist_id: playlistId,
      preset_id: pr.id,
      label: pr.label,
      managed_path: pr.managed_path,
      original_path: pr.original_path
    })
  }
  if (newRecords.length === 0) return

  if (insertAtPosition === undefined) {
    withTransaction(() => {
      const maxRow = d
        .prepare(`SELECT COALESCE(MAX(position), -1) as max_pos FROM preset_playlist_items WHERE playlist_id = ?`)
        .get(playlistId) as { max_pos: number }
      let pos = Number(maxRow?.max_pos ?? -1) + 1
      const insert = d.prepare(`
        INSERT INTO preset_playlist_items (id, playlist_id, preset_id, position, label, managed_path, original_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const it of newRecords) {
        insert.run(
          it.id,
          playlistId,
          it.preset_id,
          pos++,
          it.label,
          it.managed_path,
          it.original_path
        )
      }
      d.prepare(`UPDATE preset_playlists SET updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        playlistId
      )
      setDomainModified('presets', true)
    })
    return
  }

  const existingItems = d
    .prepare(`SELECT * FROM preset_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>

  const combined = [...existingItems]
  const targetIdx =
    insertAtPosition >= 0 && insertAtPosition <= combined.length
      ? insertAtPosition
      : combined.length
  combined.splice(targetIdx, 0, ...newRecords)

  withTransaction(() => {
    d.prepare(`DELETE FROM preset_playlist_items WHERE playlist_id = ?`).run(playlistId)
    const insert = d.prepare(`
      INSERT INTO preset_playlist_items (id, playlist_id, preset_id, position, label, managed_path, original_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < combined.length; ++i) {
      const it = combined[i]
      insert.run(
        it.id,
        playlistId,
        it.preset_id,
        i,
        it.label,
        it.managed_path,
        it.original_path
      )
    }

    d.prepare(`UPDATE preset_playlists SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
    setDomainModified('presets', true)
  })
}

export function removeItemsFromPresetPlaylist(playlistId: string, itemIds: string[]): void {
  const d = getDb()
  const removeSet = new Set(itemIds)
  const items = d
    .prepare(`SELECT * FROM preset_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>
  const remaining = items.filter((it) => !removeSet.has(it.id))

  withTransaction(() => {
    d.prepare(`DELETE FROM preset_playlist_items WHERE playlist_id = ?`).run(playlistId)
    const insert = d.prepare(`
      INSERT INTO preset_playlist_items (id, playlist_id, preset_id, position, label, managed_path, original_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < remaining.length; ++i) {
      const it = remaining[i]
      insert.run(
        it.id,
        playlistId,
        it.preset_id,
        i,
        it.label,
        it.managed_path,
        it.original_path
      )
    }
    d.prepare(`UPDATE preset_playlists SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
    setDomainModified('presets', true)
  })
}

export function reorderPresetPlaylistItems(playlistId: string, orderedItemIds: string[]): void {
  const d = getDb()
  const updatePos = d.prepare(
    `UPDATE preset_playlist_items SET position = ? WHERE id = ? AND playlist_id = ?`
  )
  withTransaction(() => {
    for (let i = 0; i < orderedItemIds.length; ++i) {
      updatePos.run(i, orderedItemIds[i], playlistId)
    }
    d.prepare(`UPDATE preset_playlists SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
    setDomainModified('presets', true)
  })
}

export function publishPresetsToObspiltMilk(): {
  libraryPresetsWritten: number
  playlistItemsWritten: number
  libraryJsonPath: string
  playlistDatPath: string
} {
  const d = getDb()
  const settings = getSettings()
  const managedDir = path.dirname(settings.obspiltMilkLibraryJsonPath)
  fs.mkdirSync(managedDir, { recursive: true })

  // 1. Gather all unique presets across libraries + active playlist
  const allRows = d
    .prepare(`SELECT * FROM preset_items ORDER BY is_retained_only ASC, added_at ASC`)
    .all() as Array<any>

  const visibleById = new Map<string, any>()
  const retainedById = new Map<string, any>()

  const updateManagedStmt = d.prepare(
    `UPDATE preset_items SET managed_path = ?, is_managed = 1 WHERE id = ? AND library_id = ?`
  )

  withTransaction(() => {
    for (const row of allRows) {
      const targetManagedPath = path.join(managedDir, row.filename).replace(/\\/g, '/')
      if (!fs.existsSync(targetManagedPath)) {
        if (row.repaired_content) {
          writeFileAtomicallyWithPrivilegeFallback(targetManagedPath, row.repaired_content, false)
        } else if (row.managed_path && fs.existsSync(row.managed_path)) {
          fs.copyFileSync(row.managed_path, targetManagedPath)
        } else if (row.original_path && fs.existsSync(row.original_path)) {
          const prep = preparePresetFileForLibrary(row.original_path)
          if (prep.ok) {
            writeFileAtomicallyWithPrivilegeFallback(targetManagedPath, prep.preset.repairedContent, false)
          }
        }
      }
      if (row.managed_path !== targetManagedPath || !row.is_managed) {
        updateManagedStmt.run(targetManagedPath, row.id, row.library_id)
      }

      const record = {
        digest: row.digest,
        filename: row.filename,
        id: row.id,
        label: row.label,
        original_path: row.original_path,
        repairs: JSON.parse(row.repairs_json || '[]'),
        warnings: JSON.parse(row.warnings_json || '[]')
      }

      if (row.is_retained_only) {
        if (!visibleById.has(row.id) && !retainedById.has(row.id)) {
          retainedById.set(row.id, record)
        }
      } else {
        visibleById.set(row.id, record)
        retainedById.delete(row.id)
      }
    }
  })

  const libraryJsonObj = {
    presets: Array.from(visibleById.values()),
    retained_presets: Array.from(retainedById.values()),
    version: 1
  }

  writeFileAtomicallyWithPrivilegeFallback(
    settings.obspiltMilkLibraryJsonPath,
    JSON.stringify(libraryJsonObj, null, 4) + '\n',
    true
  )

  // 2. Write active playlist to playlist.dat
  const activePl = d
    .prepare(`SELECT * FROM preset_playlists WHERE is_active_dat = 1 LIMIT 1`)
    .get() as any
  let playlistItemsWritten = 0
  if (activePl) {
    const items = d
      .prepare(`SELECT * FROM preset_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
      .all(activePl.id) as Array<any>

    const datLines: string[] = []
    for (const it of items) {
      const presetRec = visibleById.get(it.preset_id) || retainedById.get(it.preset_id)
      if (settings.playlistDatUseManagedPaths && presetRec) {
        datLines.push(path.join(managedDir, presetRec.filename))
      } else {
        datLines.push(it.original_path || it.managed_path)
      }
    }
    playlistItemsWritten = datLines.length
    writeFileAtomicallyWithPrivilegeFallback(
      settings.obspiltMilkPlaylistDatPath,
      datLines.join('\r\n') + (datLines.length > 0 ? '\r\n' : ''),
      true
    )
  }

  setDomainModified('presets', false, true)
  invalidatePresetLibraryCache()
  invalidateFileExistsCache()

  logEvent(
    'info',
    'Publish',
    `Published ${visibleById.size} library preset(s) & ${playlistItemsWritten} playlist.dat item(s)`,
    `library.json: ${settings.obspiltMilkLibraryJsonPath}\nplaylist.dat: ${settings.obspiltMilkPlaylistDatPath}`
  )

  return {
    libraryPresetsWritten: visibleById.size,
    playlistItemsWritten,
    libraryJsonPath: settings.obspiltMilkLibraryJsonPath,
    playlistDatPath: settings.obspiltMilkPlaylistDatPath
  }
}

export function discardPresetDraft(): void {
  const settings = getSettings()
  if (fs.existsSync(settings.obspiltMilkLibraryJsonPath)) {
    importPresetLibraryJsonFile(settings.obspiltMilkLibraryJsonPath, 'default-preset-lib')
  }
  if (fs.existsSync(settings.obspiltMilkPlaylistDatPath)) {
    importPresetPlaylistDatFile(settings.obspiltMilkPlaylistDatPath, 'Active playlist.dat', true)
  }
  setDomainModified('presets', false)
}

const MILKDROP_BRIDGE_PS_SCRIPT = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'

function Send-MilkDropPresetInternal([string]$targetPath) {
  try {
    $mmfData = [System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('XMD3CDX')
  } catch {
    return 'NOT_RUNNING'
  }

  try {
    $mmfCmd = [System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('XMD3X')
  } catch {
    $mmfData.Dispose()
    return 'NOT_RUNNING'
  }

  try {
    $accData = $mmfData.CreateViewAccessor(0, 32768)
    $zeroBuf = New-Object byte[] 32768
    $accData.WriteArray(0, $zeroBuf, 0, 32768)
    $pathBytes = [System.Text.Encoding]::Default.GetBytes($targetPath + "\`0")
    $accData.WriteArray(0, $pathBytes, 0, $pathBytes.Length)
    $accData.Flush()

    Start-Sleep -Milliseconds 20

    $accCmd = $mmfCmd.CreateViewAccessor(0, 1024)
    $cmdBytes = [System.Text.Encoding]::ASCII.GetBytes("R1\`0")
    $accCmd.WriteArray(0, $cmdBytes, 0, $cmdBytes.Length)
    $accCmd.Flush()

    $cleared = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 40
      if ($accCmd.ReadByte(0) -eq 0) {
        $cleared = $true
        break
      }
    }

    $accData.Dispose()
    $accCmd.Dispose()
    $mmfData.Dispose()
    $mmfCmd.Dispose()

    if ($cleared) {
      return 'SWITCHED_OK'
    } else {
      return 'TIMEOUT'
    }
  } catch {
    return 'ERROR'
  }
}

[Console]::Out.WriteLine('MD3_RES:READY')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'QUIT') {
    break
  }
  if ($line.StartsWith('SWITCH|')) {
    $target = $line.Substring(7).Trim()
    $status = Send-MilkDropPresetInternal -targetPath $target
    [Console]::Out.WriteLine("MD3_RES:$status")
    [Console]::Out.Flush()
    continue
  }
}
`

let md3BridgeProc: ChildProcessWithoutNullStreams | null = null
let md3BridgeReadyPromise: Promise<void> | null = null
let md3PendingResolvers: Array<(code: string) => void> = []
let md3StdoutBuffer = ''
let previewSequenceId = 0

function cleanupBridge(): void {
  if (md3BridgeProc && !md3BridgeProc.killed) {
    try {
      md3BridgeProc.stdin.write('QUIT\n')
      md3BridgeProc.kill()
    } catch {
      // ignore
    }
  }
  md3BridgeProc = null
  md3BridgeReadyPromise = null
}

function ensureMilkdropBridge(): Promise<void> {
  if (md3BridgeProc && !md3BridgeProc.killed && md3BridgeReadyPromise) {
    return md3BridgeReadyPromise
  }

  md3StdoutBuffer = ''
  md3PendingResolvers = []
  const encoded = encodePowerShellCommand(MILKDROP_BRIDGE_PS_SCRIPT)

  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )
  md3BridgeProc = proc

  md3BridgeReadyPromise = new Promise<void>((resolve, reject) => {
    let isReady = false
    const readyTimer = setTimeout(() => {
      if (!isReady) {
        const err = new Error('Timed out initializing MilkDrop Win32 IPC helper.')
        logEvent('error', 'MilkDrop', err.message)
        cleanupBridge()
        reject(err)
      }
    }, 6000)

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      md3StdoutBuffer += chunk
      let nl = md3StdoutBuffer.indexOf('\n')
      while (nl !== -1) {
        const line = md3StdoutBuffer.slice(0, nl).trim()
        md3StdoutBuffer = md3StdoutBuffer.slice(nl + 1)
        if (line.startsWith('MD3_RES:')) {
          const payload = line.slice('MD3_RES:'.length)
          if (payload === 'READY' && !isReady) {
            isReady = true
            clearTimeout(readyTimer)
            resolve()
          } else {
            const nextResolver = md3PendingResolvers.shift()
            if (nextResolver) nextResolver(payload)
          }
        }
        nl = md3StdoutBuffer.indexOf('\n')
      }
    })

    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      const errText = chunk.trim()
      if (errText) {
        logEvent('warn', 'MilkDrop', `Win32 IPC bridge stderr: ${errText}`)
      }
    })

    proc.on('error', (err) => {
      clearTimeout(readyTimer)
      logEvent('error', 'MilkDrop', `Win32 IPC bridge process error: ${err.message}`)
      cleanupBridge()
      if (!isReady) reject(err)
      while (md3PendingResolvers.length > 0) {
        md3PendingResolvers.shift()?.('ERROR')
      }
    })

    proc.on('exit', (code) => {
      clearTimeout(readyTimer)
      logEvent('info', 'MilkDrop', `Win32 IPC bridge process exited with code ${code}`)
      cleanupBridge()
      if (!isReady) reject(new Error('MilkDrop Win32 IPC helper exited prematurely.'))
      while (md3PendingResolvers.length > 0) {
        md3PendingResolvers.shift()?.('ERROR')
      }
    })
  })

  return md3BridgeReadyPromise
}

async function sendMilkdropBridgeSwitch(presetPath: string): Promise<'SWITCHED_OK' | 'NOT_RUNNING' | 'TIMEOUT' | 'ERROR'> {
  if (process.platform !== 'win32') return 'NOT_RUNNING'
  try {
    await ensureMilkdropBridge()
    if (!md3BridgeProc || md3BridgeProc.killed) return 'ERROR'
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve('TIMEOUT')
      }, 4500)
      md3PendingResolvers.push((code) => {
        clearTimeout(timer)
        resolve(code as any)
      })
      md3BridgeProc!.stdin.write(`SWITCH|${presetPath}\n`)
    })
  } catch (err: any) {
    logEvent('error', 'MilkDrop', `sendMilkdropBridgeSwitch error: ${err?.message || String(err)}`)
    return 'ERROR'
  }
}

export function shutdownMilkdropPreviewBridge(): void {
  cleanupBridge()
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function getRunningMilkdropPids(): number[] {
  if (process.platform !== 'win32') return []
  try {
    const stdout = execSync('tasklist /FI "IMAGENAME eq MilkDrop 3.exe" /FO CSV /NH', {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500
    })
    const lines = stdout.split('\n').map((l: string) => l.trim()).filter(Boolean)
    const pids: number[] = []
    for (const line of lines) {
      if (line.includes('INFO: No tasks')) continue
      const match = line.match(/^"([^"]+)","(\d+)"/)
      if (match) pids.push(Number(match[2]))
    }
    return pids
  } catch {
    return []
  }
}

export async function previewPresetInMilkdrop(presetIdOrPath: string): Promise<PreviewPresetResult> {
  const d = getDb()
  const settings = getSettings()
  const milkdropExe = (settings.milkdropExecutablePath || '').trim()

  if (!milkdropExe || !fs.existsSync(milkdropExe)) {
    const msg = `Local MilkDrop executable not found at "${milkdropExe || '(not configured)'}". Please configure the MilkDrop executable path in File → Preferences.`
    logEvent('error', 'MilkDrop', msg)
    throw new Error(msg)
  }

  let targetPath = ''
  let label = path.basename(presetIdOrPath)

  const row =
    (d.prepare(`SELECT * FROM preset_items WHERE id = ? LIMIT 1`).get(presetIdOrPath) as any) ||
    (d
      .prepare(
        `SELECT p.* FROM preset_items p
         JOIN preset_playlist_items pli ON pli.preset_id = p.id
         WHERE pli.id = ? LIMIT 1`
      )
      .get(presetIdOrPath) as any)

  if (row) {
    label = row.label || row.filename
    const preferManaged = settings.playlistDatUseManagedPaths
    if (preferManaged && row.managed_path && fs.existsSync(row.managed_path)) {
      targetPath = row.managed_path
    } else if (row.original_path && fs.existsSync(row.original_path)) {
      targetPath = row.original_path
    } else if (row.managed_path && fs.existsSync(row.managed_path)) {
      targetPath = row.managed_path
    } else if (row.repaired_content) {
      const tmpDir = path.join(os.tmpdir(), 'curationist-preview')
      fs.mkdirSync(tmpDir, { recursive: true })
      const tmpFile = path.join(tmpDir, row.filename || `${row.id}.milk`)
      fs.writeFileSync(tmpFile, row.repaired_content, 'utf8')
      targetPath = tmpFile
    }
  } else {
    const plItem = d
      .prepare(`SELECT * FROM preset_playlist_items WHERE id = ? OR preset_id = ? LIMIT 1`)
      .get(presetIdOrPath, presetIdOrPath) as any
    if (plItem) {
      label = plItem.label || path.basename(plItem.original_path || plItem.managed_path)
      if (plItem.managed_path && fs.existsSync(plItem.managed_path)) {
        targetPath = plItem.managed_path
      } else if (plItem.original_path && fs.existsSync(plItem.original_path)) {
        targetPath = plItem.original_path
      }
    } else if (fs.existsSync(presetIdOrPath)) {
      targetPath = presetIdOrPath
    }
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    const msg = `Preset file not found on disk for "${label}".`
    logEvent('error', 'MilkDrop', msg, `Lookup ID/path: ${presetIdOrPath}`)
    throw new Error(msg)
  }

  const winPresetPath = path.win32.normalize(path.resolve(targetPath))
  const milkdropDir = path.dirname(milkdropExe)
  const seq = ++previewSequenceId

  // Check if MilkDrop is already running on the system
  const runningPids = getRunningMilkdropPids()
  const isAlreadyRunning = runningPids.length > 0

  if (isAlreadyRunning) {
    logEvent(
      'info',
      'MilkDrop',
      `Detected active MilkDrop process (PID: ${runningPids.join(', ')}). Delivering preset to XMD3CDX shared memory...`,
      `Preset: ${winPresetPath}`
    )

    let liveStatus: 'SWITCHED_OK' | 'NOT_RUNNING' | 'TIMEOUT' | 'ERROR' = 'NOT_RUNNING'
    for (let attempt = 0; attempt < 8; ++attempt) {
      liveStatus = await sendMilkdropBridgeSwitch(winPresetPath)
      if (liveStatus === 'SWITCHED_OK') break
      await sleepMs(120)
    }

    if (liveStatus === 'SWITCHED_OK') {
      const message = `Switched MilkDrop preset to "${label}" (PID: ${runningPids[0]})`
      logEvent('info', 'MilkDrop', message, `Preset: ${winPresetPath}\nPIDs: ${runningPids.join(', ')}`)
      return {
        ok: true,
        mode: 'ipc',
        presetPath: winPresetPath,
        milkdropPath: milkdropExe,
        message
      }
    }

    logEvent(
      'warn',
      'MilkDrop',
      `Running MilkDrop (PID: ${runningPids.join(', ')}) did not acknowledge IPC (status: ${liveStatus}). Preset preview command was sent to XMD3CDX/XMD3X.`
    )
    const message = `Switched MilkDrop preset to "${label}"`
    return {
      ok: true,
      mode: 'ipc',
      presetPath: winPresetPath,
      milkdropPath: milkdropExe,
      message
    }
  }

  // MilkDrop is not running: launch new process ONCE with zero CLI args
  logEvent('info', 'MilkDrop', `No active MilkDrop instance found. Launching "${milkdropExe}"...`, `Working directory: ${milkdropDir}`)
  const child = spawn(milkdropExe, [], {
    cwd: milkdropDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
  logEvent('info', 'MilkDrop', `MilkDrop process spawned (PID: ${child.pid}). Awaiting XMD3X shared memory buffer...`)

  // Wait for XMD3X / XMD3CDX shared memory buffers to appear and accept preset
  let switched = false
  for (let attempt = 0; attempt < 30; ++attempt) {
    await sleepMs(150)
    if (seq !== previewSequenceId) break
    const check = await sendMilkdropBridgeSwitch(winPresetPath)
    if (check === 'SWITCHED_OK') {
      switched = true
      break
    }
  }

  const message = switched
    ? `Launched MilkDrop with preset "${label}" (PID: ${child.pid})`
    : `Launched MilkDrop (PID: ${child.pid}, preset load pending)`
  logEvent('info', 'MilkDrop', message, `Executable: ${milkdropExe}\nPreset: ${winPresetPath}\nPID: ${child.pid}`)
  return {
    ok: true,
    mode: 'launched',
    presetPath: winPresetPath,
    milkdropPath: milkdropExe,
    message
  }
}

function makeUniquePlaylistName(
  table: 'music_playlists' | 'preset_playlists' | 'video_playlists',
  desired: string,
  excludeId?: string
): string {
  const d = getDb()
  const base = desired.trim() || 'Playlist'
  const rows = d.prepare(`SELECT id, name FROM ${table}`).all() as Array<{ id: string; name: string }>
  const taken = new Set(
    rows.filter((r) => r.id !== excludeId).map((r) => r.name.toLowerCase())
  )
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; i < 10000; ++i) {
    const candidate = `${base} (${i})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base} (${Date.now()})`
}

// ============================================================================
// Video Studio (Curationist Video Libraries & Playlists)
// ============================================================================

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v']

export function createVideoLibrary(name: string, description = ''): string {
  const d = getDb()
  const id = `vlib-${crypto.randomUUID()}`
  d.prepare(
    `INSERT INTO video_libraries (id, name, description, created_at) VALUES (?, ?, ?, ?)`
  ).run(id, name.trim() || 'New Video Library', description.trim(), new Date().toISOString())
  logEvent('info', 'Video Library', `Created logical video library "${name.trim()}"`)
  invalidateVideoLibraryCache()
  return id
}

export function renameVideoLibrary(id: string, name: string): void {
  const d = getDb()
  d.prepare(`UPDATE video_libraries SET name = ? WHERE id = ?`).run(name.trim(), id)
  invalidateVideoLibraryCache()
}

export function deleteVideoLibrary(id: string): void {
  if (id === 'default-video-lib') {
    throw new Error('Cannot delete the default Video Library.')
  }
  const d = getDb()
  d.prepare(`DELETE FROM video_libraries WHERE id = ?`).run(id)
  invalidateVideoLibraryCache()
}

export async function importVideoFilesOrFolders(
  inputPaths: string[],
  libraryId = 'default-video-lib',
  copyToManaged = false,
  options?: { targetFolderPath?: string; move?: boolean }
): Promise<ImportBatchResult> {
  const d = getDb()
  const settings = getSettings()
  const targetManagedDir = (
    options?.targetFolderPath ||
    settings.videoManagedStoragePath ||
    path.join(os.homedir(), 'Videos', 'obs-managed')
  ).trim()
  const shouldMove = Boolean(options?.move)
  const files = collectFilesRecursively(inputPaths, VIDEO_EXTENSIONS)

  const res: ImportBatchResult = {
    imported: 0,
    duplicates: 0,
    repaired: 0,
    warnings: 0,
    errors: []
  }

  if (files.length === 0) return res

  if (copyToManaged) {
    fs.mkdirSync(targetManagedDir, { recursive: true })
  }

  const existingRows = d
    .prepare(`SELECT file_path, original_path FROM video_clips WHERE library_id = ?`)
    .all(libraryId) as Array<{ file_path: string; original_path: string }>
  const existingPaths = new Set<string>()
  for (const r of existingRows) {
    existingPaths.add(r.file_path.replace(/\\/g, '/').toLowerCase())
    existingPaths.add(r.original_path.replace(/\\/g, '/').toLowerCase())
  }

  const insertClip = d.prepare(`
    INSERT INTO video_clips (
      id, library_id, file_path, original_path, is_managed,
      filename, title, artist, duration, file_size, rating, added_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `)

  const now = new Date().toISOString()

  for (const rawFile of files) {
    try {
      const normOrig = rawFile.replace(/\\/g, '/')
      if (existingPaths.has(normOrig.toLowerCase())) {
        res.duplicates++
        continue
      }

      let finalPath = normOrig
      let isManaged = 0
      if (copyToManaged) {
        const base = path.basename(rawFile)
        let dest = path.join(targetManagedDir, base)
        if (fs.existsSync(dest) && path.resolve(dest).toLowerCase() !== path.resolve(rawFile).toLowerCase()) {
          const ext = path.extname(base)
          const stem = path.basename(base, ext)
          dest = path.join(targetManagedDir, `${stem}_${Date.now().toString(36)}${ext}`)
        }
        if (path.resolve(dest).toLowerCase() !== path.resolve(rawFile).toLowerCase()) {
          fs.copyFileSync(rawFile, dest)
          if (shouldMove) {
            try {
              fs.unlinkSync(rawFile)
              invalidateFileExistsCache(rawFile)
            } catch {
              // ignore
            }
          }
        }
        finalPath = dest.replace(/\\/g, '/')
        invalidateFileExistsCache(finalPath)
        isManaged = 1
      }

      const stat = fs.statSync(finalPath)
      const filename = path.basename(finalPath)
      const baseTitle = path.basename(finalPath, path.extname(finalPath))
      let artist = ''
      let title = baseTitle
      const dashIdx = baseTitle.indexOf(' - ')
      if (dashIdx > 0) {
        artist = baseTitle.slice(0, dashIdx).trim()
        title = baseTitle.slice(dashIdx + 3).trim()
      }

      const clipId = `vclip-${crypto.randomUUID()}`
      insertClip.run(
        clipId,
        libraryId,
        finalPath,
        normOrig,
        isManaged,
        filename,
        title,
        artist,
        0,
        stat.size,
        now
      )
      existingPaths.add(finalPath.toLowerCase())
      existingPaths.add(normOrig.toLowerCase())
      res.imported++
    } catch (err: any) {
      res.errors.push(`${path.basename(rawFile)}: ${err?.message || String(err)}`)
    }
  }

  invalidateVideoLibraryCache()
  logEvent(
    'info',
    'Video Import',
    `Imported ${res.imported} video clip(s) (${res.duplicates} duplicate(s) skipped)`
  )
  return res
}

export function copyClipsToManagedStorage(
  clipIds: string[],
  options?: { targetFolderPath?: string; move?: boolean }
): { copied: number } {
  const d = getDb()
  const settings = getSettings()
  const managedDir = (
    options?.targetFolderPath ||
    settings.videoManagedStoragePath ||
    path.join(os.homedir(), 'Videos', 'obs-managed')
  ).trim()
  const shouldMove = Boolean(options?.move)
  fs.mkdirSync(managedDir, { recursive: true })

  let copied = 0
  const selectClip = d.prepare(`SELECT * FROM video_clips WHERE id = ?`)
  const updateClip = d.prepare(
    `UPDATE video_clips SET file_path = ?, is_managed = 1, filename = ? WHERE id = ?`
  )
  const updatePlItem = d.prepare(
    `UPDATE video_playlist_items SET value = ? WHERE clip_id = ? OR LOWER(value) = LOWER(?)`
  )

  withTransaction(() => {
    for (const id of clipIds) {
      const row = selectClip.get(id) as any
      if (!row || !fs.existsSync(row.file_path)) continue
      const oldPath = String(row.file_path)
      const base = path.basename(oldPath)
      let dest = path.join(managedDir, base)
      if (path.resolve(oldPath).toLowerCase() === path.resolve(dest).toLowerCase()) {
        updateClip.run(dest.replace(/\\/g, '/'), base, id)
        continue
      }
      if (fs.existsSync(dest)) {
        const ext = path.extname(base)
        const stem = path.basename(base, ext)
        dest = path.join(managedDir, `${stem}_${Date.now().toString(36)}${ext}`)
      }
      fs.copyFileSync(oldPath, dest)
      if (shouldMove) {
        try {
          fs.unlinkSync(oldPath)
          invalidateFileExistsCache(oldPath)
        } catch {
          // ignore
        }
      }
      const normDest = dest.replace(/\\/g, '/')
      invalidateFileExistsCache(normDest)
      updateClip.run(normDest, path.basename(normDest), id)
      updatePlItem.run(normDest, id, oldPath)
      copied++
    }
  })

  invalidateVideoLibraryCache()
  setDomainModified('video', true)
  return { copied }
}

export function removeClipsFromVideoLibrary(clipIds: string[]): void {
  if (clipIds.length === 0) return
  const d = getDb()
  const del = d.prepare(`DELETE FROM video_clips WHERE id = ?`)
  withTransaction(() => {
    for (const id of clipIds) del.run(id)
  })
  invalidateVideoLibraryCache()
}

export function deleteClipsFromDisk(clipIds: string[]): { deletedFiles: number; removedClips: number } {
  if (clipIds.length === 0) return { deletedFiles: 0, removedClips: 0 }
  const d = getDb()
  const sel = d.prepare(`SELECT id, file_path, original_path FROM video_clips WHERE id = ?`)
  const delClip = d.prepare(`DELETE FROM video_clips WHERE id = ?`)
  const delPlItem = d.prepare(`DELETE FROM video_playlist_items WHERE clip_id = ? OR LOWER(value) = LOWER(?)`)

  let deletedFiles = 0
  let removedClips = 0

  withTransaction(() => {
    for (const id of clipIds) {
      const row = sel.get(id) as { id: string; file_path: string; original_path: string } | undefined
      if (!row) continue
      for (const p of new Set([row.file_path, row.original_path])) {
        if (p && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p)
            invalidateFileExistsCache(p)
            deletedFiles++
          } catch {
            // ignore
          }
        }
      }
      delPlItem.run(id, row.file_path)
      delClip.run(id)
      removedClips++
    }
  })

  invalidateVideoLibraryCache()
  setDomainModified('video', true)
  return { deletedFiles, removedClips }
}

export function setVideoClipsRating(clipIds: string[], rating: number): void {
  if (clipIds.length === 0) return
  const clamped = Math.max(0, Math.min(5, Math.round(rating)))
  const d = getDb()
  const updClip = d.prepare(`UPDATE video_clips SET rating = ? WHERE id = ?`)
  const updPl = d.prepare(`UPDATE video_playlist_items SET rating = ? WHERE clip_id = ? OR id = ?`)
  withTransaction(() => {
    for (const id of clipIds) {
      updClip.run(clamped, id)
      updPl.run(clamped, id, id)
    }
  })
  invalidateVideoLibraryCache()
}

export function updateVideoClipMetadata(payload: {
  clipId: string
  title?: string
  artist?: string
  duration?: number
}): void {
  const d = getDb()
  const row = d.prepare(`SELECT * FROM video_clips WHERE id = ?`).get(payload.clipId) as any
  if (!row) return
  const nextTitle = payload.title !== undefined ? payload.title.trim() : row.title
  const nextArtist = payload.artist !== undefined ? payload.artist.trim() : row.artist
  const nextDuration = payload.duration !== undefined ? Number(payload.duration) : row.duration
  d.prepare(`UPDATE video_clips SET title = ?, artist = ?, duration = ? WHERE id = ?`).run(
    nextTitle,
    nextArtist,
    nextDuration,
    payload.clipId
  )
  d.prepare(
    `UPDATE video_playlist_items SET title = ?, artist = ?, duration = ? WHERE clip_id = ?`
  ).run(nextTitle, nextArtist, nextDuration, payload.clipId)
  invalidateVideoLibraryCache()
}

export function createVideoPlaylist(name: string, makeActive = false): string {
  const d = getDb()
  const uniqueName = makeUniquePlaylistName('video_playlists', name)
  const id = `vpl-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  withTransaction(() => {
    if (makeActive) {
      d.prepare(`UPDATE video_playlists SET is_active = 0`).run()
    }
    d.prepare(
      `INSERT INTO video_playlists (id, name, source_origin, is_active, updated_at) VALUES (?, ?, 'curationist', ?, ?)`
    ).run(id, uniqueName, makeActive ? 1 : 0, now)
  })
  setDomainModified('video', true)
  return id
}

export function renameVideoPlaylist(playlistId: string, newName: string): void {
  const d = getDb()
  const unique = makeUniquePlaylistName('video_playlists', newName, playlistId)
  d.prepare(`UPDATE video_playlists SET name = ?, updated_at = ? WHERE id = ?`).run(
    unique,
    new Date().toISOString(),
    playlistId
  )
  setDomainModified('video', true)
}

export function duplicateVideoPlaylist(playlistId: string): string {
  const d = getDb()
  const src = d.prepare(`SELECT * FROM video_playlists WHERE id = ?`).get(playlistId) as any
  if (!src) throw new Error('Video playlist not found')
  const newName = makeUniquePlaylistName('video_playlists', `${src.name} (Copy)`)
  const newId = `vpl-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const items = d
    .prepare(`SELECT * FROM video_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>

  const insItem = d.prepare(`
    INSERT INTO video_playlist_items (id, playlist_id, clip_id, position, value, title, artist, duration, rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  withTransaction(() => {
    d.prepare(
      `INSERT INTO video_playlists (id, name, source_origin, is_active, updated_at) VALUES (?, ?, 'curationist', 0, ?)`
    ).run(newId, newName, now)
    items.forEach((it, idx) => {
      insItem.run(
        `vpli-${crypto.randomUUID()}`,
        newId,
        it.clip_id,
        idx,
        it.value,
        it.title,
        it.artist,
        it.duration,
        it.rating
      )
    })
  })
  setDomainModified('video', true)
  return newId
}

export function deleteVideoPlaylist(playlistId: string): void {
  const d = getDb()
  d.prepare(`DELETE FROM video_playlists WHERE id = ?`).run(playlistId)
  setDomainModified('video', true)
}

export function setActiveVideoPlaylist(playlistId: string): void {
  const d = getDb()
  withTransaction(() => {
    d.prepare(`UPDATE video_playlists SET is_active = 0`).run()
    d.prepare(`UPDATE video_playlists SET is_active = 1, updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
  })
  setDomainModified('video', true)
}

export function addClipsToVideoPlaylist(
  playlistId: string,
  clipIds: string[],
  insertAtPosition?: number
): void {
  if (clipIds.length === 0) return
  const d = getDb()
  const existing = d
    .prepare(`SELECT * FROM video_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>
  const selectClip = d.prepare(`SELECT * FROM video_clips WHERE id = ?`)

  const newEntries: Array<any> = []
  for (const cid of clipIds) {
    const clip = selectClip.get(cid) as any
    if (!clip) continue
    newEntries.push({
      id: `vpli-${crypto.randomUUID()}`,
      playlist_id: playlistId,
      clip_id: clip.id,
      value: clip.file_path,
      title: clip.title || clip.filename,
      artist: clip.artist || '',
      duration: Number(clip.duration || 0),
      rating: Number(clip.rating || 0)
    })
  }

  if (newEntries.length === 0) return

  const combined = [...existing]
  if (
    insertAtPosition !== undefined &&
    insertAtPosition >= 0 &&
    insertAtPosition <= combined.length
  ) {
    combined.splice(insertAtPosition, 0, ...newEntries)
  } else {
    combined.push(...newEntries)
  }

  const delAll = d.prepare(`DELETE FROM video_playlist_items WHERE playlist_id = ?`)
  const ins = d.prepare(`
    INSERT INTO video_playlist_items (id, playlist_id, clip_id, position, value, title, artist, duration, rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  withTransaction(() => {
    delAll.run(playlistId)
    combined.forEach((it, idx) => {
      ins.run(
        it.id,
        playlistId,
        it.clip_id,
        idx,
        it.value,
        it.title,
        it.artist,
        it.duration || 0,
        it.rating || 0
      )
    })
    d.prepare(`UPDATE video_playlists SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
  })
  setDomainModified('video', true)
}

export function removeItemsFromVideoPlaylist(playlistId: string, itemIds: string[]): void {
  if (itemIds.length === 0) return
  const d = getDb()
  const idSet = new Set(itemIds)
  const existing = d
    .prepare(`SELECT * FROM video_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>
  const remaining = existing.filter((it) => !idSet.has(it.id))

  const delAll = d.prepare(`DELETE FROM video_playlist_items WHERE playlist_id = ?`)
  const ins = d.prepare(`
    INSERT INTO video_playlist_items (id, playlist_id, clip_id, position, value, title, artist, duration, rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  withTransaction(() => {
    delAll.run(playlistId)
    remaining.forEach((it, idx) => {
      ins.run(
        it.id,
        playlistId,
        it.clip_id,
        idx,
        it.value,
        it.title,
        it.artist,
        it.duration || 0,
        it.rating || 0
      )
    })
    d.prepare(`UPDATE video_playlists SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
  })
  setDomainModified('video', true)
}

export function deleteVideoPlaylistItemsFromDisk(
  playlistId: string,
  itemIds: string[]
): { deletedFiles: number; removedItems: number } {
  if (itemIds.length === 0) return { deletedFiles: 0, removedItems: 0 }
  const d = getDb()
  const idSet = new Set(itemIds)
  const existing = d
    .prepare(`SELECT * FROM video_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>
  const toDelete = existing.filter((it) => idSet.has(it.id))
  const clipIds: string[] = []
  let deletedFiles = 0

  for (const it of toDelete) {
    if (it.clip_id) clipIds.push(it.clip_id)
    if (it.value && fs.existsSync(it.value)) {
      try {
        fs.unlinkSync(it.value)
        invalidateFileExistsCache(it.value)
        deletedFiles++
      } catch {
        // ignore
      }
    }
  }

  if (clipIds.length > 0) {
    const res = deleteClipsFromDisk(clipIds)
    deletedFiles += res.deletedFiles
  }
  removeItemsFromVideoPlaylist(playlistId, itemIds)
  return { deletedFiles, removedItems: toDelete.length }
}

export function reorderVideoPlaylistItems(playlistId: string, orderedItemIds: string[]): void {
  const d = getDb()
  const existing = d
    .prepare(`SELECT * FROM video_playlist_items WHERE playlist_id = ? ORDER BY position ASC`)
    .all(playlistId) as Array<any>
  const byId = new Map(existing.map((it) => [it.id, it]))
  const reordered: Array<any> = []
  for (const id of orderedItemIds) {
    const it = byId.get(id)
    if (it) {
      reordered.push(it)
      byId.delete(id)
    }
  }
  for (const leftover of byId.values()) {
    reordered.push(leftover)
  }

  const upd = d.prepare(`UPDATE video_playlist_items SET position = ? WHERE id = ?`)
  withTransaction(() => {
    reordered.forEach((it, idx) => upd.run(idx, it.id))
    d.prepare(`UPDATE video_playlists SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      playlistId
    )
  })
  setDomainModified('video', true)
}

export function publishVideoPlaylists(): { playlistName: string; itemCount: number } {
  const d = getDb()
  let active = d
    .prepare(`SELECT * FROM video_playlists WHERE is_active = 1 LIMIT 1`)
    .get() as any
  if (!active) {
    active = d
      .prepare(`SELECT * FROM video_playlists ORDER BY updated_at DESC LIMIT 1`)
      .get() as any
    if (active) {
      d.prepare(`UPDATE video_playlists SET is_active = 0`).run()
      d.prepare(`UPDATE video_playlists SET is_active = 1 WHERE id = ?`).run(active.id)
    }
  }
  const countRow = active
    ? (d
        .prepare(`SELECT COUNT(*) as c FROM video_playlist_items WHERE playlist_id = ?`)
        .get(active.id) as { c: number })
    : { c: 0 }
  setDomainModified('video', false)
  return {
    playlistName: active?.name || '(None)',
    itemCount: countRow?.c || 0
  }
}
