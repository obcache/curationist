import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  getMusicWorkspaceState,
  getPresetWorkspaceState,
  getSettings,
  getTrackCoverArt,
  getVideoWorkspaceState,
  initDatabase,
  updateSettings
} from './db'
import {
  clearMemoryLogs,
  getLogFilePath,
  getLogsSnapshot,
  initLogger,
  logEvent
} from './logger'
import {
  addClipsToVideoPlaylist,
  addPresetsToPresetPlaylist,
  addTracksToMusicPlaylist,
  copyClipsToManagedStorage,
  copyPresetsToManagedStorage,
  copyTracksToManagedStorage,
  createMp3Library,
  createMusicPlaylist,
  createPresetLibrary,
  createPresetPlaylist,
  createVideoLibrary,
  createVideoPlaylist,
  deleteClipsFromDisk,
  deleteMp3Library,
  deleteMusicPlaylist,
  deleteMusicPlaylistItemsFromDisk,
  deletePresetLibrary,
  deletePresetPlaylist,
  deletePresetPlaylistItemsFromDisk,
  deletePresetsFromDisk,
  deleteTracksFromDisk,
  deleteVideoLibrary,
  deleteVideoPlaylist,
  deleteVideoPlaylistItemsFromDisk,
  discardMusicDraft,
  discardPresetDraft,
  duplicateMusicPlaylist,
  duplicatePresetPlaylist,
  duplicateVideoPlaylist,
  exportSingleMusicPlaylistToJson,
  importMp3FilesOrFolders,
  importMusicJsonFile,
  importPresetFilesOrFolders,
  importPresetLibraryJsonFile,
  importPresetPlaylistDatFile,
  importVideoFilesOrFolders,
  inspectMp3TrackDetailedMetadata,
  inspectPreset,
  previewPresetInMilkdrop,
  publishVideoPlaylists,
  publishMusicPlaylistsToSavedJson,
  publishPresetsToObspiltMilk,
  refreshMp3TracksMetadata,
  relabelPreset,
  removeClipsFromVideoLibrary,
  removeItemsFromMusicPlaylist,
  removeItemsFromPresetPlaylist,
  removeItemsFromVideoPlaylist,
  removePresetsFromLibrary,
  removeTracksFromMp3Library,
  renameMp3Library,
  renameMusicPlaylist,
  renamePresetLibrary,
  renamePresetPlaylist,
  renameVideoLibrary,
  renameVideoPlaylist,
  reorderMusicPlaylistItems,
  reorderPresetPlaylistItems,
  reorderVideoPlaylistItems,
  seedInitialDataIfEmpty,
  setActiveMusicJsonPlaylists,
  setActivePresetPlaylist,
  setActiveVideoPlaylist,
  setMp3TracksRating,
  setPresetsRating,
  setVideoClipsRating,
  shutdownMilkdropPreviewBridge,
  updateMp3Tags,
  updateMusicPlaylistItemInline,
  updateVideoClipMetadata
} from './sync-service'
import {
  closeMilkLabWindowOnQuit,
  openMilkLabEditor,
  registerMilkLabService
} from './milklab-service'
import { obsService } from './obs-service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

if (process.platform === 'win32') {
  app.setAppUserModelId('com.sorryneedboost.curationist')
}

function resolveAppIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, '../dist/icon.ico'),
    path.join(__dirname, '../public/icon.ico'),
    path.join(__dirname, '../build/icon.ico')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

let projectMProcess: ChildProcess | null = null
let projectMPort = 0
let projectMReadyPromise: Promise<number> | null = null

function getProjectMExePath(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'projectm', 'curationist-projectm.exe'),
    path.join(app.getAppPath(), 'native', 'projectm', 'curationist-projectm.exe'),
    path.join(__dirname, '../../native/projectm/curationist-projectm.exe'),
    path.resolve('native/projectm/curationist-projectm.exe')
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

function startProjectMHost(): Promise<number> {
  if (projectMPort > 0 && projectMProcess && !projectMProcess.killed) {
    return Promise.resolve(projectMPort)
  }
  if (projectMReadyPromise) {
    return projectMReadyPromise
  }

  const exe = getProjectMExePath()
  if (!exe) {
    logEvent('error', 'ProjectM', 'curationist-projectm.exe was not found on disk')
    return Promise.resolve(0)
  }

  projectMReadyPromise = new Promise<number>((resolve) => {
    try {
      const child = spawn(exe, ['--port', '0'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: path.dirname(exe)
      })
      projectMProcess = child

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        const match = text.match(/CURATIONIST_PROJECTM_READY\s+(\d+)/)
        if (match) {
          projectMPort = Number(match[1])
          logEvent(
            'info',
            'ProjectM',
            `In-app projectM visualizer host ready on port ${projectMPort}`,
            `Exe: ${exe}`
          )
          resolve(projectMPort)
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        const err = data.toString().trim()
        if (err) logEvent('warn', 'ProjectM', err)
      })

      child.on('error', (err) => {
        logEvent('error', 'ProjectM', `Host process error: ${err.message}`)
        resolve(0)
      })

      child.on('exit', (code) => {
        logEvent('info', 'ProjectM', `Host process exited (code ${code})`)
        projectMProcess = null
        projectMPort = 0
        projectMReadyPromise = null
      })

      setTimeout(() => {
        if (projectMPort === 0) {
          logEvent('warn', 'ProjectM', 'Timed out waiting for projectM host readiness')
          resolve(0)
        }
      }, 5000)
    } catch (err: any) {
      logEvent('error', 'ProjectM', `Failed to start projectM host: ${err.message}`)
      resolve(0)
    }
  })

  return projectMReadyPromise
}

function shutdownProjectMHost() {
  if (projectMProcess && !projectMProcess.killed) {
    try {
      projectMProcess.stdin?.write('q\n')
      projectMProcess.kill()
    } catch {
      // ignore
    }
    projectMProcess = null
    projectMPort = 0
    projectMReadyPromise = null
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'curationist-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#1e1e1e',
    title: 'Curationist — OBS Media & Preset Studio',
    icon: resolveAppIconPath(),
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const detachedPopouts = new Set<BrowserWindow>()

  mainWindow.webContents.setWindowOpenHandler(({ frameName }) => {
    if (frameName && frameName.startsWith('curationist-popout:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          frame: true,
          autoHideMenuBar: true,
          backgroundColor: '#111216',
          icon: resolveAppIconPath(),
          minWidth: 320,
          minHeight: 200,
          resizable: true,
          maximizable: true,
          fullscreenable: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      }
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-create-window', (childWin) => {
    childWin.setMenuBarVisibility(false)
    detachedPopouts.add(childWin)
    childWin.on('closed', () => {
      detachedPopouts.delete(childWin)
    })
  })

  mainWindow.on('closed', () => {
    for (const pop of Array.from(detachedPopouts)) {
      if (!pop.isDestroyed()) {
        pop.close()
      }
    }
    detachedPopouts.clear()
  })

  // Also set native menu for keyboard shortcuts
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow?.webContents.send('menu:open-preferences')
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Output & Activity Log',
          accelerator: 'CmdOrCtrl+`',
          click: () => {
            mainWindow?.webContents.send('menu:toggle-output-log')
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  // Register audio streaming protocol with byte-range support & track cover art serving
  protocol.handle('curationist-media', (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname === 'artwork') {
        const trackId = decodeURIComponent(url.searchParams.get('trackId') || '')
        if (!trackId) return new Response('Not found', { status: 404 })
        const art = getTrackCoverArt(trackId)
        if (!art) return new Response('Not found', { status: 404 })
        const buf = Buffer.from(art.base64, 'base64')
        return new Response(buf, {
          status: 200,
          headers: {
            'Content-Type': art.mime || 'image/jpeg',
            'Content-Length': String(buf.length),
            'Cache-Control': 'no-cache'
          }
        })
      }
      const rawPath = decodeURIComponent(url.searchParams.get('path') || '')
      if (!rawPath || !fs.existsSync(rawPath)) {
        return new Response('File not found', { status: 404 })
      }
      const stat = fs.statSync(rawPath)
      const total = stat.size
      const ext = path.extname(rawPath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
        '.opus': 'audio/opus',
        '.m4a': 'audio/mp4',
        '.aif': 'audio/aiff',
        '.aiff': 'audio/aiff',
        '.mp4': 'video/mp4',
        '.m4v': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo'
      }
      const contentType = mimeMap[ext] || 'application/octet-stream'
      const rangeHeader = request.headers.get('range')

      if (rangeHeader) {
        const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
        if (match) {
          const start = Number.parseInt(match[1], 10)
          if (start >= total) {
            return new Response(null, {
              status: 416,
              headers: {
                'Content-Range': `bytes */${total}`,
                'Accept-Ranges': 'bytes'
              }
            })
          }
          const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : total - 1
          const end = Math.min(total - 1, Math.max(start, requestedEnd))
          const chunkSize = end - start + 1
          const nodeStream = fs.createReadStream(rawPath, { start, end })
          nodeStream.on('error', () => {})
          return new Response(Readable.toWeb(nodeStream) as unknown as BodyInit, {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(chunkSize),
              'Content-Type': contentType
            }
          })
        }
      }

      const fullStream = fs.createReadStream(rawPath)
      fullStream.on('error', () => {})
      return new Response(Readable.toWeb(fullStream) as unknown as BodyInit, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(total),
          'Content-Type': contentType
        }
      })
    } catch (err: any) {
      return new Response(err?.message || 'Error reading media', { status: 500 })
    }
  })

  const userDataDir = app.getPath('userData')
  initLogger(path.join(userDataDir, 'logs'), (entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('logs:entry', entry)
    }
  })

  const dbPath = path.join(userDataDir, 'curationist.sqlite')
  initDatabase(dbPath)
  logEvent('info', 'Database', `SQLite database connected`, `Path: ${dbPath}`)
  await seedInitialDataIfEmpty()

  registerIpcHandlers()
  registerMilkLabService((nextPresetState) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('curationist:preset-state-changed', nextPresetState)
    }
  })
  createWindow()
  startProjectMHost().catch(() => {})
  obsService.getPluginStatus().catch(() => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  closeMilkLabWindowOnQuit()
  shutdownProjectMHost()
  shutdownMilkdropPreviewBridge()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpcHandlers() {
  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
      return false
    } else {
      mainWindow.maximize()
      return true
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('shell:showItemInFolder', (_e, fullPath: string) => {
    if (fullPath && fs.existsSync(fullPath)) {
      shell.showItemInFolder(path.normalize(fullPath))
    }
  })

  // Dialogs
  ipcMain.handle(
    'dialog:pickFolder',
    async (_e, title: string, defaultPath?: string): Promise<string | null> => {
      if (!mainWindow) return null
      const res = await dialog.showOpenDialog(mainWindow, {
        title,
        defaultPath: defaultPath && fs.existsSync(defaultPath) ? defaultPath : undefined,
        properties: ['openDirectory', 'createDirectory']
      })
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
    }
  )

  ipcMain.handle(
    'dialog:pickFilesOrFolders',
    async (
      _e,
      options: {
        title: string
        mode: 'files' | 'folder'
        filters?: Electron.FileFilter[]
        defaultPath?: string
      }
    ): Promise<string[]> => {
      if (!mainWindow) return []
      const res = await dialog.showOpenDialog(mainWindow, {
        title: options.title,
        defaultPath:
          options.defaultPath && fs.existsSync(options.defaultPath)
            ? options.defaultPath
            : undefined,
        filters: options.filters,
        properties:
          options.mode === 'folder'
            ? ['openDirectory', 'multiSelections']
            : ['openFile', 'multiSelections']
      })
      return res.canceled ? [] : res.filePaths
    }
  )

  ipcMain.handle(
    'dialog:pickSaveFile',
    async (
      _e,
      options: { title: string; defaultPath?: string; filters?: Electron.FileFilter[] }
    ): Promise<string | null> => {
      if (!mainWindow) return null
      const res = await dialog.showSaveDialog(mainWindow, {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters
      })
      return res.canceled || !res.filePath ? null : res.filePath
    }
  )

  ipcMain.handle('dialog:pickCoverArtImage', async (): Promise<{ mime: string; base64: string } | null> => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Album Cover Art Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const imgPath = res.filePaths[0]
    const ext = path.extname(imgPath).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    const base64 = fs.readFileSync(imgPath).toString('base64')
    return { mime, base64 }
  })

  // Settings
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_e, partial) => {
    const next = updateSettings(partial)
    logEvent('info', 'Preferences', 'Updated application settings')
    return next
  })

  // Activity & Persistent File Logs
  ipcMain.handle('logs:getSnapshot', () => getLogsSnapshot())
  ipcMain.handle(
    'logs:append',
    (_e, level: 'info' | 'warn' | 'error', category: string, message: string, details?: string) =>
      logEvent(level, category, message, details)
  )
  ipcMain.handle('logs:clear', () => clearMemoryLogs())
  ipcMain.handle('logs:openFile', async () => {
    const file = getLogFilePath()
    if (file && fs.existsSync(file)) {
      await shell.openPath(file)
      return true
    }
    return false
  })
  ipcMain.handle('logs:revealFile', () => {
    const file = getLogFilePath()
    if (file && fs.existsSync(file)) {
      shell.showItemInFolder(path.normalize(file))
      return true
    }
    return false
  })

  // Music / nowPlaylisting
  ipcMain.handle('music:getState', () => getMusicWorkspaceState())
  ipcMain.handle('music:getTrackCoverArt', (_e, trackId: string) => getTrackCoverArt(trackId))
  ipcMain.handle('music:createLibrary', (_e, name: string, desc?: string) => {
    createMp3Library(name, desc)
    return getMusicWorkspaceState()
  })
  ipcMain.handle('music:renameLibrary', (_e, id: string, name: string) => {
    renameMp3Library(id, name)
    return getMusicWorkspaceState()
  })
  ipcMain.handle('music:deleteLibrary', (_e, id: string) => {
    deleteMp3Library(id)
    return getMusicWorkspaceState()
  })
  ipcMain.handle(
    'music:importMedia',
    async (
      _e,
      paths: string[],
      libraryId: string,
      copyToManaged: boolean,
      options?: { targetFolderPath?: string; move?: boolean }
    ) => {
      const batch = await importMp3FilesOrFolders(paths, libraryId, copyToManaged, options)
      return { batch, state: getMusicWorkspaceState() }
    }
  )
  ipcMain.handle(
    'music:copyToManaged',
    (_e, trackIds: string[], options?: { targetFolderPath?: string; move?: boolean }) => {
      const res = copyTracksToManagedStorage(trackIds, options)
      return { ...res, state: getMusicWorkspaceState() }
    }
  )
  ipcMain.handle('music:removeTracks', (_e, trackIds: string[], deleteManaged = false) => {
    removeTracksFromMp3Library(trackIds, deleteManaged)
    return getMusicWorkspaceState()
  })
  ipcMain.handle('music:deleteTracksFromDisk', (_e, trackIds: string[]) => {
    const res = deleteTracksFromDisk(trackIds)
    return { ...res, state: getMusicWorkspaceState() }
  })
  ipcMain.handle(
    'music:deletePlaylistItemsFromDisk',
    (_e, playlistId: string, itemIds: string[]) => {
      const res = deleteMusicPlaylistItemsFromDisk(playlistId, itemIds)
      return { ...res, state: getMusicWorkspaceState() }
    }
  )
  ipcMain.handle('music:updateTags', (_e, payload) => {
    const res = updateMp3Tags(payload)
    return { ...res, state: getMusicWorkspaceState() }
  })
  ipcMain.handle('music:setRating', (_e, trackIds: string[], rating: number) => {
    const res = setMp3TracksRating(trackIds, rating)
    return { ...res, state: getMusicWorkspaceState() }
  })
  ipcMain.handle('music:inspectTrackMetadata', async (_e, trackId: string) => {
    const detail = await inspectMp3TrackDetailedMetadata(trackId)
    return { detail, state: getMusicWorkspaceState() }
  })
  ipcMain.handle('music:refreshMetadata', async (_e, trackIds?: string[]) => {
    const res = await refreshMp3TracksMetadata(trackIds)
    return { ...res, state: getMusicWorkspaceState() }
  })
  ipcMain.handle('music:importJsonFile', async (_e, filePath: string, markActive: boolean) => {
    const res = await importMusicJsonFile(filePath, markActive)
    return { ...res, state: getMusicWorkspaceState() }
  })
  ipcMain.handle('music:createPlaylist', (_e, name: string, addToActive = false) => {
    const newId = createMusicPlaylist(name, addToActive)
    return { newId, state: getMusicWorkspaceState() }
  })
  ipcMain.handle('music:renamePlaylist', (_e, id: string, newName: string) => {
    renameMusicPlaylist(id, newName)
    return getMusicWorkspaceState()
  })
  ipcMain.handle('music:duplicatePlaylist', (_e, id: string) => {
    const newId = duplicateMusicPlaylist(id)
    return { newId, state: getMusicWorkspaceState() }
  })
  ipcMain.handle('music:deletePlaylist', (_e, id: string) => {
    deleteMusicPlaylist(id)
    return getMusicWorkspaceState()
  })
  ipcMain.handle(
    'music:addTracksToPlaylist',
    (_e, playlistId: string, trackIds: string[], pos?: number) => {
      addTracksToMusicPlaylist(playlistId, trackIds, pos)
      return getMusicWorkspaceState()
    }
  )
  ipcMain.handle('music:removeItemsFromPlaylist', (_e, playlistId: string, itemIds: string[]) => {
    removeItemsFromMusicPlaylist(playlistId, itemIds)
    return getMusicWorkspaceState()
  })
  ipcMain.handle('music:reorderPlaylistItems', (_e, playlistId: string, orderedIds: string[]) => {
    reorderMusicPlaylistItems(playlistId, orderedIds)
    return getMusicWorkspaceState()
  })
  ipcMain.handle('music:updatePlaylistItemInline', (_e, itemId: string, updates) => {
    updateMusicPlaylistItemInline(itemId, updates)
    return getMusicWorkspaceState()
  })
  ipcMain.handle('music:setActiveJsonPlaylists', (_e, orderedPlaylistIds: string[]) => {
    setActiveMusicJsonPlaylists(orderedPlaylistIds)
    return getMusicWorkspaceState()
  })
  ipcMain.handle('music:publishSavedPlaylists', async () => {
    const res = publishMusicPlaylistsToSavedJson()
    try {
      await obsService.publishAudioQueueToObs()
    } catch {
      // ignore if milkyWay Audio source not yet configured
    }
    return { ...res, state: getMusicWorkspaceState() }
  })
  ipcMain.handle('music:exportSinglePlaylist', (_e, playlistId: string, targetPath: string) => {
    exportSingleMusicPlaylistToJson(playlistId, targetPath)
    return true
  })
  ipcMain.handle('music:discardDraft', async () => {
    await discardMusicDraft()
    return getMusicWorkspaceState()
  })

  // Presets / obSpiltMilk
  ipcMain.handle('presets:getState', () => getPresetWorkspaceState())
  ipcMain.handle('presets:createLibrary', (_e, name: string, desc?: string) => {
    createPresetLibrary(name, desc)
    return getPresetWorkspaceState()
  })
  ipcMain.handle('presets:renameLibrary', (_e, id: string, name: string) => {
    renamePresetLibrary(id, name)
    return getPresetWorkspaceState()
  })
  ipcMain.handle('presets:deleteLibrary', (_e, id: string) => {
    deletePresetLibrary(id)
    return getPresetWorkspaceState()
  })
  ipcMain.handle(
    'presets:importPresets',
    (
      _e,
      paths: string[],
      libraryId: string,
      copyToManaged: boolean,
      options?: { targetFolderPath?: string; move?: boolean }
    ) => {
      const batch = importPresetFilesOrFolders(paths, libraryId, copyToManaged, options)
      return { batch, state: getPresetWorkspaceState() }
    }
  )
  ipcMain.handle('presets:importLibraryJson', (_e, jsonPath: string, libraryId: string) => {
    const res = importPresetLibraryJsonFile(jsonPath, libraryId)
    return { ...res, state: getPresetWorkspaceState() }
  })
  ipcMain.handle(
    'presets:importPlaylistDat',
    (_e, datPath: string, playlistName: string, markActive: boolean) => {
      const res = importPresetPlaylistDatFile(datPath, playlistName, markActive)
      return { ...res, state: getPresetWorkspaceState() }
    }
  )
  ipcMain.handle(
    'presets:copyToManaged',
    (
      _e,
      presetIds: string[],
      libraryId?: string,
      options?: { targetFolderPath?: string; move?: boolean }
    ) => {
      const res = copyPresetsToManagedStorage(presetIds, libraryId, options)
      return { ...res, state: getPresetWorkspaceState() }
    }
  )
  ipcMain.handle('presets:setRating', (_e, presetIds: string[], rating: number) => {
    setPresetsRating(presetIds, rating)
    return getPresetWorkspaceState()
  })
  ipcMain.handle('presets:relabel', (_e, presetId: string, newLabel: string) => {
    relabelPreset(presetId, newLabel)
    return getPresetWorkspaceState()
  })
  ipcMain.handle('presets:removePresets', (_e, presetIds: string[], libraryId?: string) => {
    removePresetsFromLibrary(presetIds, libraryId)
    return getPresetWorkspaceState()
  })
  ipcMain.handle('presets:deletePresetsFromDisk', (_e, presetIds: string[], libraryId?: string) => {
    const res = deletePresetsFromDisk(presetIds, libraryId)
    return { ...res, state: getPresetWorkspaceState() }
  })
  ipcMain.handle(
    'presets:deletePlaylistItemsFromDisk',
    (_e, playlistId: string, itemIds: string[]) => {
      const res = deletePresetPlaylistItemsFromDisk(playlistId, itemIds)
      return { ...res, state: getPresetWorkspaceState() }
    }
  )
  ipcMain.handle('presets:inspect', (_e, presetId: string) => inspectPreset(presetId))
  ipcMain.handle('presets:previewInMilkdrop', (_e, presetIdOrPath: string) =>
    previewPresetInMilkdrop(presetIdOrPath)
  )
  ipcMain.handle('presets:createPlaylist', (_e, name: string, setAsActive = false) => {
    const newId = createPresetPlaylist(name, setAsActive)
    return { newId, state: getPresetWorkspaceState() }
  })
  ipcMain.handle('presets:renamePlaylist', (_e, id: string, newName: string) => {
    renamePresetPlaylist(id, newName)
    return getPresetWorkspaceState()
  })
  ipcMain.handle('presets:duplicatePlaylist', (_e, id: string) => {
    const newId = duplicatePresetPlaylist(id)
    return { newId, state: getPresetWorkspaceState() }
  })
  ipcMain.handle('presets:deletePlaylist', (_e, id: string) => {
    deletePresetPlaylist(id)
    return getPresetWorkspaceState()
  })
  ipcMain.handle('presets:setActivePlaylist', (_e, id: string) => {
    setActivePresetPlaylist(id)
    return getPresetWorkspaceState()
  })
  ipcMain.handle(
    'presets:addPresetsToPlaylist',
    (_e, playlistId: string, presetIds: string[], pos?: number) => {
      addPresetsToPresetPlaylist(playlistId, presetIds, pos)
      return getPresetWorkspaceState()
    }
  )
  ipcMain.handle('presets:removeItemsFromPlaylist', (_e, playlistId: string, itemIds: string[]) => {
    removeItemsFromPresetPlaylist(playlistId, itemIds)
    return getPresetWorkspaceState()
  })
  ipcMain.handle('presets:reorderPlaylistItems', (_e, playlistId: string, orderedIds: string[]) => {
    reorderPresetPlaylistItems(playlistId, orderedIds)
    return getPresetWorkspaceState()
  })
  ipcMain.handle('presets:publish', async () => {
    const res = publishPresetsToObspiltMilk()
    try {
      await obsService.publishVideoQueueToObs()
    } catch {
      // ignore if milkyWay Video source not yet configured
    }
    return { ...res, state: getPresetWorkspaceState() }
  })
  ipcMain.handle('presets:discardDraft', () => {
    discardPresetDraft()
    return getPresetWorkspaceState()
  })
  ipcMain.handle('projectm:getPort', async () => {
    return await startProjectMHost()
  })

  // milkLab Preset IDE Integration
  ipcMain.handle(
    'milklab:open',
    async (
      _e,
      options: { mode: 'new' | 'edit'; presetId?: string; libraryId?: string }
    ) => {
      return await openMilkLabEditor(options)
    }
  )

  // OBS Integration (milkyWay Audio & milkyWay Video)
  ipcMain.handle('obs:getConnectionState', () => obsService.getConnectionState())
  ipcMain.handle('obs:connect', (_e, endpoint?: string, password?: string) =>
    obsService.connect(endpoint, password)
  )
  ipcMain.handle('obs:disconnect', () => obsService.disconnect())
  ipcMain.handle('obs:refreshSources', () => obsService.refreshSources())
  ipcMain.handle('obs:getSourceStatus', (_e, sourceId: string) =>
    obsService.getSourceStatus(sourceId)
  )
  ipcMain.handle('obs:getSourceQueue', (_e, sourceId: string) =>
    obsService.getSourceQueue(sourceId)
  )
  ipcMain.handle('obs:controlSource', (_e, control) =>
    obsService.controlSource(control)
  )
  ipcMain.handle(
    'obs:setPlaybackModes',
    (
      _e,
      sourceId: string,
      loop: boolean,
      shuffle: boolean,
      advanceOnSongChange?: boolean,
      crossfadeSec?: number
    ) => obsService.setPlaybackModes(sourceId, loop, shuffle, advanceOnSongChange, crossfadeSec)
  )
  ipcMain.handle(
    'obs:setPresetTiming',
    (
      _e,
      sourceId: string,
      intervalMs: number,
      autoAdvance: boolean,
      advanceOnSongChange?: boolean
    ) => obsService.setPresetTiming(sourceId, intervalMs, autoAdvance, advanceOnSongChange)
  )
  ipcMain.handle('obs:getAudioSettings', (_e, sourceId: string) =>
    obsService.getAudioSettings(sourceId)
  )
  ipcMain.handle('obs:setAudioSettings', (_e, settings) =>
    obsService.setAudioSettings(settings)
  )
  ipcMain.handle('obs:getVideoSettings', (_e, sourceId: string) =>
    obsService.getVideoSettings(sourceId)
  )
  ipcMain.handle('obs:setVideoSettings', (_e, settings) =>
    obsService.setVideoSettings(settings)
  )
  ipcMain.handle('obs:getAudioDrivers', (_e, sourceId: string) =>
    obsService.getAudioDrivers(sourceId)
  )
  ipcMain.handle('obs:publishAudioQueue', (_e, options) =>
    obsService.publishAudioQueueToObs(options)
  )
  ipcMain.handle('obs:publishClipQueue', (_e, options) =>
    obsService.publishClipQueueToObs(options)
  )
  ipcMain.handle('obs:publishVideoQueue', (_e, options) =>
    obsService.publishVideoQueueToObs(options)
  )
  ipcMain.handle('obs:resolvePublishedAssetPath', (_e, relativeAsset: string) =>
    obsService.resolvePublishedAssetPath(relativeAsset)
  )
  ipcMain.handle('obs:getPluginStatus', () => obsService.getPluginStatus())
  ipcMain.handle('obs:selectObsExecutable', () => obsService.selectObsExecutable(mainWindow))
  ipcMain.handle('obs:installPlugin', () => obsService.installPlugin())

  // Video Studio (Curationist Video Libraries & Playlists)
  ipcMain.handle('video:getState', () => getVideoWorkspaceState())
  ipcMain.handle('video:createLibrary', (_e, name: string, desc?: string) => {
    createVideoLibrary(name, desc)
    return getVideoWorkspaceState()
  })
  ipcMain.handle('video:renameLibrary', (_e, id: string, name: string) => {
    renameVideoLibrary(id, name)
    return getVideoWorkspaceState()
  })
  ipcMain.handle('video:deleteLibrary', (_e, id: string) => {
    deleteVideoLibrary(id)
    return getVideoWorkspaceState()
  })
  ipcMain.handle(
    'video:importMedia',
    async (
      _e,
      paths: string[],
      libraryId: string,
      copyToManaged: boolean,
      options?: { targetFolderPath?: string; move?: boolean }
    ) => {
      const batch = await importVideoFilesOrFolders(paths, libraryId, copyToManaged, options)
      return { batch, state: getVideoWorkspaceState() }
    }
  )
  ipcMain.handle(
    'video:copyToManaged',
    (_e, clipIds: string[], options?: { targetFolderPath?: string; move?: boolean }) => {
      const res = copyClipsToManagedStorage(clipIds, options)
      return { ...res, state: getVideoWorkspaceState() }
    }
  )
  ipcMain.handle('video:removeClips', (_e, clipIds: string[]) => {
    removeClipsFromVideoLibrary(clipIds)
    return getVideoWorkspaceState()
  })
  ipcMain.handle('video:deleteClipsFromDisk', (_e, clipIds: string[]) => {
    const res = deleteClipsFromDisk(clipIds)
    return { ...res, state: getVideoWorkspaceState() }
  })
  ipcMain.handle('video:setRating', (_e, clipIds: string[], rating: number) => {
    setVideoClipsRating(clipIds, rating)
    return getVideoWorkspaceState()
  })
  ipcMain.handle(
    'video:updateMetadata',
    (_e, payload: { clipId: string; title?: string; artist?: string; duration?: number }) => {
      updateVideoClipMetadata(payload)
      return getVideoWorkspaceState()
    }
  )
  ipcMain.handle('video:createPlaylist', (_e, name: string, makeActive = false) => {
    const newId = createVideoPlaylist(name, makeActive)
    return { newId, state: getVideoWorkspaceState() }
  })
  ipcMain.handle('video:renamePlaylist', (_e, id: string, newName: string) => {
    renameVideoPlaylist(id, newName)
    return getVideoWorkspaceState()
  })
  ipcMain.handle('video:duplicatePlaylist', (_e, id: string) => {
    const newId = duplicateVideoPlaylist(id)
    return { newId, state: getVideoWorkspaceState() }
  })
  ipcMain.handle('video:deletePlaylist', (_e, id: string) => {
    deleteVideoPlaylist(id)
    return getVideoWorkspaceState()
  })
  ipcMain.handle('video:setActivePlaylist', (_e, id: string) => {
    setActiveVideoPlaylist(id)
    return getVideoWorkspaceState()
  })
  ipcMain.handle(
    'video:addClipsToPlaylist',
    (_e, playlistId: string, clipIds: string[], pos?: number) => {
      addClipsToVideoPlaylist(playlistId, clipIds, pos)
      return getVideoWorkspaceState()
    }
  )
  ipcMain.handle('video:removeItemsFromPlaylist', (_e, playlistId: string, itemIds: string[]) => {
    removeItemsFromVideoPlaylist(playlistId, itemIds)
    return getVideoWorkspaceState()
  })
  ipcMain.handle(
    'video:deletePlaylistItemsFromDisk',
    (_e, playlistId: string, itemIds: string[]) => {
      const res = deleteVideoPlaylistItemsFromDisk(playlistId, itemIds)
      return { ...res, state: getVideoWorkspaceState() }
    }
  )
  ipcMain.handle(
    'video:reorderPlaylistItems',
    (_e, playlistId: string, orderedIds: string[]) => {
      reorderVideoPlaylistItems(playlistId, orderedIds)
      return getVideoWorkspaceState()
    }
  )
  ipcMain.handle('video:publish', async () => {
    const res = publishVideoPlaylists()
    let publishedSources = 0
    try {
      const obsRes = await obsService.publishClipQueueToObs()
      publishedSources = obsRes.publishedSources
    } catch {
      // ignore if Curationist Video source not yet configured
    }
    return { ...res, publishedSources, state: getVideoWorkspaceState() }
  })
}
