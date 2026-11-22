import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  getDb,
  getPresetWorkspaceState,
  getSettings,
  invalidateFileExistsCache,
  invalidatePresetLibraryCache,
  setDomainModified
} from './db'
import { logEvent } from './logger'
import { preparePresetFileForLibrary } from './preset-import'
import { importPresetFilesOrFolders } from './sync-service'
import type { PresetWorkspaceState } from '../src/types'

export const blankPreset = `MILKDROP_PRESET_VERSION=201
PSVERSION=2
PSVERSION_WARP=0
PSVERSION_COMP=0
[preset00]
// A new sketch. Drop an effect from the Effects panel to begin.
fRating=3.000
fGammaAdj=1.000
fDecay=0.970
fVideoEchoZoom=1.000
fVideoEchoAlpha=0.000
nWaveMode=0
bAdditiveWaves=1
bWaveDots=0
bWaveThick=1
fWaveAlpha=0.800
fWaveScale=1.000
zoom=1.010
rot=0.000
cx=0.500
cy=0.500
dx=0.000
dy=0.000
wave_r=0.600
wave_g=0.400
wave_b=1.000
wave_x=0.500
wave_y=0.500
// Per-frame equations
per_frame_1=wave_r=0.5+0.4*sin(time*0.7);
per_frame_2=wave_g=0.5+0.4*sin(time*0.9+2);
per_frame_3=wave_b=0.5+0.4*sin(time*0.6+4);
// Per-pixel equations
per_pixel_1=zoom=zoom+0.003*sin(rad*12-time);
`

export const starterPresets = [
  {
    name: 'Spectral drift.milk',
    content: blankPreset
      .replace(
        '// A new sketch. Drop an effect from the Effects panel to begin.',
        '// Spectral drift · milkLab original\n// Slowly rotating, audio-reactive feedback with a shifting palette.'
      )
      .replace('rot=0.000', 'rot=0.006')
      .replace(
        'per_pixel_1=zoom=zoom+0.003*sin(rad*12-time);',
        'per_frame_4=rot=0.006+0.003*sin(time*0.3);\nper_frame_5=zoom=1.012+0.003*bass_att;\nper_pixel_1=rot=rot+0.008*sin(ang*3+time*0.4);\nper_pixel_2=zoom=zoom+0.005*sin(rad*14-time*0.6);'
      )
  },
  {
    name: 'Orbit study.milk',
    content: blankPreset
      .replace('nWaveMode=0', 'nWaveMode=1')
      .replace('rot=0.000', 'rot=0.012')
      .replace(
        'per_pixel_1=zoom=zoom+0.003*sin(rad*12-time);',
        'per_frame_4=cx=0.5+0.05*sin(time*0.4);\nper_frame_5=cy=0.5+0.05*cos(time*0.4);\nper_pixel_1=rot=rot+0.004*cos(rad*10-time);'
      )
  },
  {
    name: 'Pulse field.milk',
    content: blankPreset
      .replace('nWaveMode=0', 'nWaveMode=7')
      .replace(
        'per_pixel_1=zoom=zoom+0.003*sin(rad*12-time);',
        'per_frame_4=zoom=1.005+0.015*bass_att;\nper_pixel_1=zoom=zoom+0.008*sin(rad*24-time*2);'
      )
  }
]

interface EvalResult {
  message: string
  line: number
  column: number
}
type Evaluate = (code: string) => EvalResult

interface MilkLabDiagnostic {
  from: number
  to: number
  severity: 'error' | 'warning'
  message: string
  line: number
}

interface MilkLabDocument {
  id: string
  name: string
  path: string | null
  content: string
  savedContent: string
  dirty: boolean
  view?: 'source' | 'workflow'
}

interface MilkLabLayout {
  leftWidth: number
  rightWidth: number
  problems: boolean
  left: Array<{ id: 'library' | 'playlist' | 'preview' | 'effects'; collapsed: boolean; weight: number }>
  right: Array<{ id: 'library' | 'playlist' | 'preview' | 'effects'; collapsed: boolean; weight: number }>
}

interface MilkLabWorkspace {
  version: 1
  documents: MilkLabDocument[]
  activeId: string | null
  layout: MilkLabLayout
  activePlaylist: string | null
}

interface MilkLabSettings {
  version: 1
  storageRoot: string
  autoPreview: boolean
  fontSize: number
}

interface MilkLabPreset {
  id: string
  name: string
  path: string
  originalPath: string
  importedAt: string
  hash: string
  status: 'ready' | 'repaired' | 'review'
  repairs: string[]
  warnings: string[]
}

interface MilkLabPlaylist {
  id: string
  name: string
  paths: string[]
}

const defaultMilkLabLayout: MilkLabLayout = {
  leftWidth: 270,
  rightWidth: 370,
  problems: true,
  left: [
    { id: 'library', collapsed: false, weight: 57 },
    { id: 'playlist', collapsed: false, weight: 43 }
  ],
  right: [
    { id: 'preview', collapsed: false, weight: 43 },
    { id: 'effects', collapsed: false, weight: 57 }
  ]
}

function resolveMilkLabVendorRoot(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'milklab'),
    path.join(app.getAppPath(), 'vendor', 'milklab'),
    path.join(process.cwd(), 'vendor', 'milklab')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'renderer', 'index.html'))) {
      return candidate
    }
  }
  return candidates[1]
}

async function loadEvaluator(modulePath: string): Promise<Evaluate | undefined> {
  try {
    if (!fs.existsSync(modulePath)) return undefined
    const mod = await import(pathToFileURL(modulePath).href)
    const createModule = mod.default
    const instance = await createModule({ print: () => {}, printErr: () => {} })
    return (code: string) => ({
      message: instance.ccall('ml_validate', 'string', ['string'], [code]),
      line: instance.ccall('ml_line', 'number', [], []),
      column: instance.ccall('ml_column', 'number', [], [])
    })
  } catch {
    return undefined
  }
}

function diagnosePreset(content: string, evaluate?: Evaluate): MilkLabDiagnostic[] {
  const diagnostics: MilkLabDiagnostic[] = []
  const groups = new Map<string, { code: string; from: number; line: number; number: number }[]>()
  let offset = 0
  let sections = 0
  const keys = new Set<string>()

  content.split('\n').forEach((text, i) => {
    const line = i + 1
    const add = (message: string, severity: 'error' | 'warning' = 'error') =>
      diagnostics.push({
        from: offset,
        to: offset + Math.max(1, text.length),
        line,
        message,
        severity
      })
    const trimmed = text.trim()
    if (/^\[preset/i.test(trimmed)) {
      sections++
      if (!/^\[preset0+\]$/i.test(trimmed) || sections > 1) {
        add('Only one [preset00] section is supported.')
      }
    } else if (trimmed && !/^(\/\/|;|\/\*|\*)/.test(trimmed)) {
      const kv = /^\s*(\w+)\s*=/.exec(text)
      if (!kv) {
        add('Expected a preset key followed by =.')
      } else {
        const key = kv[1].toLowerCase()
        const duplicate = keys.has(key)
        if (duplicate) {
          add(`Duplicate preset key: ${kv[1]}; projectM uses the first occurrence.`, 'warning')
        }
        keys.add(key)
        const group =
          /^(per_frame_init_|per_frame_|per_pixel_|wave_\d+_init|wave_\d+_per_frame|wave_\d+_per_point|shape_\d+_init|shape_\d+_per_frame)\d+$/.exec(
            key
          )?.[1]
        if (group && !duplicate) {
          if (!groups.has(group)) groups.set(group, [])
          groups.get(group)!.push({
            code: text.slice(kv[0].length).replace(/^`/, ''),
            from: offset + kv[0].length,
            line,
            number: Number(key.slice(group.length))
          })
        }
      }
    }
    offset += text.length + 1
  })

  for (const [name, unsorted] of groups) {
    const lines = unsorted.sort((a, b) => a.number - b.number)
    const gap = lines.findIndex((line, i) => line.number !== i + 1)
    if (gap !== -1) {
      const entry = lines[gap]
      diagnostics.push({
        from: entry.from,
        to: Math.min(content.length, entry.from + entry.code.length),
        line: entry.line,
        severity: 'warning',
        message: `${name}: numbering must be consecutive from 1. projectM ignores code after the gap.`
      })
    }
    if (!evaluate) continue
    const result = evaluate(lines.map((l) => l.code).join('\n'))
    if (!result.message) continue
    const line = lines[Math.max(0, Math.min(lines.length - 1, result.line - 1))]
    const col = Math.max(0, Math.min(line.code.length, result.column - (result.line > 1 ? 1 : 0)))
    const from = line.from + col
    diagnostics.push({
      from,
      to: Math.min(
        content.length,
        from + Math.max(1, /^[A-Za-z_0-9]+/.exec(line.code.slice(col))?.[0].length || 1)
      ),
      line: line.line,
      severity: 'error',
      message: `${name}: ${result.message}`
    })
  }
  if (!sections) {
    diagnostics.push({
      from: 0,
      to: Math.min(1, content.length),
      line: 1,
      severity: 'warning',
      message: 'Add [preset00] to identify the single preset section.'
    })
  }
  return diagnostics
}

const hashStr = (content: string) => crypto.createHash('sha256').update(content).digest('hex')

async function atomicWriteFile(target: string, content: string | Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  try {
    await fsp.writeFile(temporary, content, 'utf8')
    await fsp.rename(temporary, target)
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {})
  }
}

function safeName(name: string): string {
  const clean = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
  return (clean || 'Preset').slice(0, 180)
}

interface PresetOriginContext {
  presetId?: string
  libraryId: string
  originalPath?: string
  managedPath?: string
}

let milkLabWindow: BrowserWindow | null = null
let milkLabReadyToClose = false
let ipcRegistered = false
let evaluatorFn: Evaluate | undefined
let evaluatorLoaded = false

let mlSettings: MilkLabSettings | null = null
let mlWorkspace: MilkLabWorkspace = {
  version: 1,
  documents: [],
  activeId: null,
  layout: structuredClone(defaultMilkLabLayout),
  activePlaylist: null
}
let mlLibrary: MilkLabPreset[] = []
let mlPlaylists: MilkLabPlaylist[] = []
const documentPaths = new Map<string, string>()
const documentOrigins = new Map<string, PresetOriginContext>()
let activeTargetLibraryId = 'default-preset-lib'
let onPresetStateUpdatedCallback: ((state: PresetWorkspaceState) => void) | null = null

function getMilkLabUserDataDir(): string {
  return path.join(app.getPath('userData'), 'milklab')
}

function getDefaultPresetStorageDir(): string {
  const settings = getSettings()
  const folders = settings.managedStorageFolders || []
  const selected =
    folders.find((f) => f.id === settings.selectedPresetStorageFolderId) || folders[0]
  return selected?.path || settings.presetManagedStoragePath
}

async function ensureMilkLabInitialized(): Promise<void> {
  const userData = getMilkLabUserDataDir()
  await fsp.mkdir(path.join(userData, 'drafts'), { recursive: true })

  if (!evaluatorLoaded) {
    evaluatorLoaded = true
    const vendorRoot = resolveMilkLabVendorRoot()
    const engineMjs = path.join(vendorRoot, 'renderer', 'engine', 'milklab-projectm.mjs')
    evaluatorFn = await loadEvaluator(engineMjs)
  }

  const settingsFile = path.join(userData, 'settings.json')
  if (!mlSettings) {
    try {
      const raw = JSON.parse(await fsp.readFile(settingsFile, 'utf8'))
      mlSettings = {
        version: 1,
        storageRoot: raw.storageRoot || getDefaultPresetStorageDir(),
        autoPreview: raw.autoPreview !== false,
        fontSize: Number(raw.fontSize) || 13
      }
    } catch {
      mlSettings = {
        version: 1,
        storageRoot: getDefaultPresetStorageDir(),
        autoPreview: true,
        fontSize: 13
      }
    }
  }

  // Sync milkLab's library list from Curationist's Preset Library so all Curationist presets are browsable inside milkLab too
  syncMilkLabLibraryFromCurationist()

  const workspaceFile = path.join(userData, 'workspace.json')
  if (mlWorkspace.documents.length === 0 && fs.existsSync(workspaceFile)) {
    try {
      const raw = JSON.parse(await fsp.readFile(workspaceFile, 'utf8'))
      const docs: MilkLabDocument[] = []
      for (const doc of raw.documents || []) {
        let content = doc.savedContent || blankPreset
        try {
          content = await fsp.readFile(path.join(userData, 'drafts', `${doc.id}.milk`), 'utf8')
        } catch {
          // fallback to savedContent
        }
        docs.push({
          id: doc.id,
          name: doc.name,
          path: doc.path || null,
          content,
          savedContent: doc.savedContent || '',
          dirty: Boolean(doc.dirty || content !== doc.savedContent),
          view: doc.view === 'workflow' ? 'workflow' : 'source'
        })
        if (doc.path) {
          documentPaths.set(doc.id, doc.path)
        }
      }
      mlWorkspace = {
        version: 1,
        documents: docs,
        activeId: raw.activeId || docs[0]?.id || null,
        layout: raw.layout || structuredClone(defaultMilkLabLayout),
        activePlaylist: raw.activePlaylist || mlPlaylists[0]?.id || null
      }
    } catch {
      // ignore corrupted workspace file
    }
  }

  if (mlPlaylists.length === 0) {
    const cState = getPresetWorkspaceState()
    mlPlaylists = cState.playlists.map((pl) => ({
      id: pl.id.replace(/[^a-zA-Z0-9_-]/g, '_'),
      name: pl.name,
      paths: (pl.items || []).map((it) => it.managedPath || it.originalPath)
    }))
    if (mlPlaylists.length === 0) {
      mlPlaylists = [{ id: 'Studio_session', name: 'Studio session', paths: [] }]
    }
    if (!mlWorkspace.activePlaylist) {
      mlWorkspace.activePlaylist = mlPlaylists[0]?.id || null
    }
  }
}

function syncMilkLabLibraryFromCurationist(): void {
  const cState = getPresetWorkspaceState()
  const seen = new Set<string>()
  const list: MilkLabPreset[] = []
  for (const p of cState.presets) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const cleanId = p.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomUUID()
    const effectivePath =
      p.managedPath && fs.existsSync(p.managedPath) ? p.managedPath : p.originalPath
    list.push({
      id: cleanId,
      name: p.label.endsWith('.milk') ? p.label : `${p.label}.milk`,
      path: effectivePath,
      originalPath: p.originalPath,
      importedAt: p.addedAt || new Date().toISOString(),
      hash: p.digest,
      status: p.warnings.length > 0 ? 'review' : p.repairs.length > 0 ? 'repaired' : 'ready',
      repairs: p.repairs,
      warnings: p.warnings
    })
  }
  mlLibrary = list
}

async function persistMilkLabWorkspace(workspace: MilkLabWorkspace): Promise<void> {
  const userData = getMilkLabUserDataDir()
  await fsp.mkdir(path.join(userData, 'drafts'), { recursive: true })
  const docs = workspace.documents.map((doc) => ({
    ...doc,
    path: documentPaths.get(doc.id) ?? doc.path ?? null
  }))
  for (const doc of docs) {
    await atomicWriteFile(path.join(userData, 'drafts', `${doc.id}.milk`), doc.content)
  }
  const metadata = docs.map(({ content: _, ...rest }) => rest)
  await atomicWriteFile(
    path.join(userData, 'workspace.json'),
    `${JSON.stringify({ ...workspace, documents: metadata }, null, 2)}\n`
  )
  mlWorkspace = { ...workspace, documents: docs }
}

/**
 * Synchronizes a saved or Save-As .milk file back into Curationist's SQLite database
 * and notifies Curationist's main window so the library and playlists update immediately.
 */
async function syncSavedMilkFileToCurationist(
  docId: string,
  targetPath: string,
  content: string,
  isSaveAs: boolean
): Promise<void> {
  const origin = documentOrigins.get(docId)
  const targetLibraryId = origin?.libraryId || activeTargetLibraryId || 'default-preset-lib'
  const db = getDb()
  const normTarget = path.resolve(targetPath).toLowerCase()

  // Check if this file already belongs to an existing Curationist preset
  const allRows = db
    .prepare(
      `SELECT id, library_id, filename, managed_path, original_path, label FROM preset_items`
    )
    .all() as Array<{
    id: string
    library_id: string
    filename: string
    managed_path: string
    original_path: string
    label: string
  }>

  const matchingRows = allRows.filter((row) => {
    if (!isSaveAs && origin?.presetId && row.id === origin.presetId) return true
    const mPath = row.managed_path ? path.resolve(row.managed_path).toLowerCase() : ''
    const oPath = row.original_path ? path.resolve(row.original_path).toLowerCase() : ''
    return mPath === normTarget || oPath === normTarget
  })

  if (matchingRows.length > 0 && !isSaveAs) {
    const preparedResult = preparePresetFileForLibrary(targetPath)
    const digest = preparedResult.ok
      ? preparedResult.preset.digest
      : crypto.createHash('sha256').update(content, 'utf8').digest('hex')
    const repairs = preparedResult.ok ? preparedResult.preset.repairs : []
    const warnings = preparedResult.ok ? preparedResult.preset.warnings : []
    const repairedContent = preparedResult.ok ? preparedResult.preset.repairedContent : content

    const updateStmt = db.prepare(`
      UPDATE preset_items
      SET digest = ?,
          repairs_json = ?,
          warnings_json = ?,
          repaired_content = ?
      WHERE id = ? AND library_id = ?
    `)

    for (const row of matchingRows) {
      updateStmt.run(
        digest,
        JSON.stringify(repairs),
        JSON.stringify(warnings),
        repairedContent,
        row.id,
        row.library_id
      )
      // Keep both managed_path and original_path in sync if they exist
      if (
        row.managed_path &&
        path.resolve(row.managed_path).toLowerCase() !== normTarget &&
        fs.existsSync(path.dirname(row.managed_path))
      ) {
        try {
          await atomicWriteFile(row.managed_path, repairedContent)
          invalidateFileExistsCache(row.managed_path)
        } catch {
          // ignore
        }
      }
      if (
        row.original_path &&
        path.resolve(row.original_path).toLowerCase() !== normTarget &&
        fs.existsSync(row.original_path)
      ) {
        try {
          await atomicWriteFile(row.original_path, content)
          invalidateFileExistsCache(row.original_path)
        } catch {
          // ignore
        }
      }
    }

    invalidateFileExistsCache(targetPath)
    invalidatePresetLibraryCache()
    setDomainModified('presets', true)

    logEvent(
      'info',
      'milkLab',
      `Updated preset "${matchingRows[0].label}" in Curationist library from milkLab`,
      targetPath
    )
  } else {
    // New preset or Save As -> import into Curationist's active Preset Library
    invalidateFileExistsCache(targetPath)
    const batch = importPresetFilesOrFolders([targetPath], targetLibraryId, false)
    // Link this docId to the newly imported preset
    const nextState = getPresetWorkspaceState()
    const created = nextState.presets.find(
      (p) =>
        path.resolve(p.originalPath).toLowerCase() === normTarget ||
        path.resolve(p.managedPath).toLowerCase() === normTarget
    )
    if (created) {
      documentOrigins.set(docId, {
        presetId: created.id,
        libraryId: created.libraryId,
        originalPath: created.originalPath,
        managedPath: created.managedPath
      })
    }
    logEvent(
      'info',
      'milkLab',
      `Added saved preset "${path.basename(targetPath)}" to Curationist library (${batch.imported} imported)`,
      targetPath
    )
  }

  syncMilkLabLibraryFromCurationist()
  if (onPresetStateUpdatedCallback) {
    onPresetStateUpdatedCallback(getPresetWorkspaceState())
  }
}

export function registerMilkLabService(
  onPresetStateUpdated: (state: PresetWorkspaceState) => void
): void {
  onPresetStateUpdatedCallback = onPresetStateUpdated
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('bootstrap', async () => {
    await ensureMilkLabInitialized()
    syncMilkLabLibraryFromCurationist()
    return {
      settings: mlSettings!,
      workspace: mlWorkspace,
      library: mlLibrary,
      playlists: mlPlaylists
    }
  })

  ipcMain.handle('lint', async (_e, content: string) => {
    await ensureMilkLabInitialized()
    return diagnosePreset(String(content || ''), evaluatorFn)
  })

  ipcMain.handle('import-presets', async (_e, folder: boolean) => {
    await ensureMilkLabInitialized()
    const isFolder = Boolean(folder)
    const selection = await dialog.showOpenDialog(milkLabWindow!, {
      title: isFolder ? 'Import preset folder' : 'Import .milk presets',
      properties: isFolder ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters: [{ name: 'MilkDrop presets', extensions: ['milk'] }]
    })
    if (selection.canceled || selection.filePaths.length === 0) {
      return { imported: [], rejected: [] }
    }
    const batch = importPresetFilesOrFolders(
      selection.filePaths,
      activeTargetLibraryId,
      false
    )
    syncMilkLabLibraryFromCurationist()
    if (onPresetStateUpdatedCallback) {
      onPresetStateUpdatedCallback(getPresetWorkspaceState())
    }
    return {
      imported: mlLibrary.slice(0, Math.max(1, batch.imported)),
      rejected: batch.errors.map((err) => ({ name: 'Preset', reason: err }))
    }
  })

  ipcMain.handle('read-preset', async (_e, id: string) => {
    await ensureMilkLabInitialized()
    const preset = mlLibrary.find((p) => p.id === id)
    if (!preset) throw new Error('Preset not found in library.')
    const filePath =
      preset.path && fs.existsSync(preset.path) ? preset.path : preset.originalPath
    const content = await fsp.readFile(filePath, 'utf8')
    const docId = crypto.randomUUID()
    const doc: MilkLabDocument = {
      id: docId,
      name: preset.name,
      path: filePath,
      content,
      savedContent: content,
      dirty: false
    }
    documentPaths.set(docId, filePath)
    documentOrigins.set(docId, {
      presetId: preset.id,
      libraryId: activeTargetLibraryId,
      originalPath: preset.originalPath,
      managedPath: preset.path
    })
    return doc
  })

  ipcMain.handle('save-document', async (_e, doc: MilkLabDocument, saveAs: boolean) => {
    await ensureMilkLabInitialized()
    const isSaveAs = Boolean(saveAs)
    let targetPath = !isSaveAs ? documentPaths.get(doc.id) || doc.path : null

    if (isSaveAs || !targetPath) {
      const defaultDir = getDefaultPresetStorageDir()
      await fsp.mkdir(defaultDir, { recursive: true })
      const baseFilename = doc.name.toLowerCase().endsWith('.milk')
        ? safeName(doc.name)
        : `${safeName(doc.name)}.milk`
      const result = await dialog.showSaveDialog(milkLabWindow!, {
        title: isSaveAs ? 'Save Preset As (Adds to Curationist Library)' : 'Save New Preset to Curationist Library',
        defaultPath: path.join(defaultDir, baseFilename),
        filters: [{ name: 'MilkDrop preset', extensions: ['milk'] }]
      })
      if (result.canceled || !result.filePath) return null
      targetPath = result.filePath.toLowerCase().endsWith('.milk')
        ? result.filePath
        : `${result.filePath}.milk`
    }

    await atomicWriteFile(targetPath, doc.content)
    documentPaths.set(doc.id, targetPath)

    await syncSavedMilkFileToCurationist(doc.id, targetPath, doc.content, isSaveAs || !doc.path)

    const savedDoc: MilkLabDocument = {
      ...doc,
      path: targetPath,
      name: path.basename(targetPath),
      savedContent: doc.content,
      dirty: false
    }
    return savedDoc
  })

  ipcMain.handle('persist-workspace', async (_e, workspace: MilkLabWorkspace) => {
    await ensureMilkLabInitialized()
    await persistMilkLabWorkspace(workspace)
  })

  ipcMain.handle('choose-storage', async () => {
    const result = await dialog.showOpenDialog(milkLabWindow!, {
      title: 'Managed preset storage',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('update-settings', async (_e, settings: MilkLabSettings) => {
    await ensureMilkLabInitialized()
    mlSettings = {
      version: 1,
      storageRoot: settings.storageRoot || getDefaultPresetStorageDir(),
      autoPreview: Boolean(settings.autoPreview),
      fontSize: Number(settings.fontSize) || 13
    }
    await atomicWriteFile(
      path.join(getMilkLabUserDataDir(), 'settings.json'),
      `${JSON.stringify(mlSettings, null, 2)}\n`
    )
    return {
      settings: mlSettings,
      workspace: mlWorkspace,
      library: mlLibrary,
      playlists: mlPlaylists
    }
  })

  ipcMain.handle('save-playlist', async (_e, playlist: MilkLabPlaylist) => {
    mlPlaylists = [...mlPlaylists.filter((p) => p.id !== playlist.id), playlist]
    return playlist
  })

  ipcMain.handle('add-preset-to-playlist', async (_e, playlistId: string, presetId: string) => {
    const playlist = mlPlaylists.find((p) => p.id === playlistId)
    const preset = mlLibrary.find((p) => p.id === presetId)
    if (!playlist || !preset) throw new Error('Choose a preset and playlist.')
    const updated = { ...playlist, paths: [...playlist.paths, preset.path] }
    mlPlaylists = [...mlPlaylists.filter((p) => p.id !== playlist.id), updated]
    return updated
  })

  ipcMain.handle('create-playlist', async (_e, name: string) => {
    const id = safeName(name).replace(/[^a-zA-Z0-9_-]/g, '_') || `Playlist_${Date.now()}`
    const created: MilkLabPlaylist = { id, name, paths: [] }
    mlPlaylists.push(created)
    return created
  })

  ipcMain.handle('import-playlist', async () => null)
  ipcMain.handle('export-playlist', async () => false)
  ipcMain.handle('export-workspace', async () => false)
  ipcMain.handle('import-workspace', async () => null)

  ipcMain.on('window-control', (event, action: string) => {
    if (!milkLabWindow || event.sender !== milkLabWindow.webContents) return
    if (action === 'minimize') milkLabWindow.minimize()
    else if (action === 'maximize') {
      if (milkLabWindow.isMaximized()) milkLabWindow.unmaximize()
      else milkLabWindow.maximize()
    } else if (action === 'close') {
      milkLabWindow.close()
    } else if (action === 'close-ready') {
      milkLabReadyToClose = true
      milkLabWindow.close()
    }
  })
}

export async function openMilkLabEditor(options: {
  mode: 'new' | 'edit'
  presetId?: string
  libraryId?: string
}): Promise<{ ok: boolean; message: string }> {
  await ensureMilkLabInitialized()

  if (options.libraryId && options.libraryId !== 'all') {
    activeTargetLibraryId = options.libraryId
  }

  let openedLabel = 'New Preset'

  if (options.mode === 'edit' && options.presetId) {
    const cState = getPresetWorkspaceState()
    const targetKey = options.presetId.replace(/\\/g, '/').toLowerCase()
    let preset: {
      id: string
      libraryId: string
      label: string
      managedPath: string
      originalPath: string
    } | undefined = cState.presets.find(
      (p) =>
        p.id === options.presetId ||
        p.managedPath.replace(/\\/g, '/').toLowerCase() === targetKey ||
        p.originalPath.replace(/\\/g, '/').toLowerCase() === targetKey
    )

    if (!preset) {
      for (const pl of cState.playlists) {
        const plItem = (pl.items || []).find(
          (it) =>
            it.id === options.presetId ||
            it.presetId === options.presetId ||
            (it.managedPath && it.managedPath.replace(/\\/g, '/').toLowerCase() === targetKey) ||
            (it.originalPath && it.originalPath.replace(/\\/g, '/').toLowerCase() === targetKey)
        )
        if (plItem) {
          preset = {
            id: plItem.presetId || plItem.id,
            libraryId:
              options.libraryId && options.libraryId !== 'all'
                ? options.libraryId
                : cState.libraries[0]?.id || 'default-preset-lib',
            label: plItem.label,
            managedPath: plItem.managedPath,
            originalPath: plItem.originalPath
          }
          break
        }
      }
    }

    if (!preset && fs.existsSync(options.presetId)) {
      preset = {
        id: options.presetId,
        libraryId:
          options.libraryId && options.libraryId !== 'all'
            ? options.libraryId
            : cState.libraries[0]?.id || 'default-preset-lib',
        label: path.basename(options.presetId, path.extname(options.presetId)),
        managedPath: options.presetId,
        originalPath: options.presetId
      }
    }

    if (!preset) {
      throw new Error('Selected preset was not found in the library or playlist.')
    }
    activeTargetLibraryId =
      options.libraryId && options.libraryId !== 'all' ? options.libraryId : preset.libraryId

    const physicalPath =
      preset.managedPath && fs.existsSync(preset.managedPath)
        ? preset.managedPath
        : preset.originalPath

    let content = blankPreset
    if (physicalPath && fs.existsSync(physicalPath)) {
      content = await fsp.readFile(physicalPath, 'utf8')
    } else {
      const row = getDb()
        .prepare(`SELECT repaired_content FROM preset_items WHERE id = ? LIMIT 1`)
        .get(preset.id) as { repaired_content: string } | undefined
      if (row?.repaired_content) content = row.repaired_content
    }

    const existingDoc = mlWorkspace.documents.find(
      (d) =>
        (d.path && path.resolve(d.path).toLowerCase() === path.resolve(physicalPath).toLowerCase()) ||
        (documentPaths.get(d.id) &&
          path.resolve(documentPaths.get(d.id)!).toLowerCase() ===
            path.resolve(physicalPath).toLowerCase())
    )

    if (existingDoc) {
      mlWorkspace = {
        ...mlWorkspace,
        activeId: existingDoc.id
      }
      documentOrigins.set(existingDoc.id, {
        presetId: preset.id,
        libraryId: activeTargetLibraryId,
        originalPath: preset.originalPath,
        managedPath: preset.managedPath
      })
    } else {
      const docId = crypto.randomUUID()
      const displayName = preset.label.toLowerCase().endsWith('.milk')
        ? preset.label
        : `${preset.label}.milk`
      const newDoc: MilkLabDocument = {
        id: docId,
        name: displayName,
        path: physicalPath,
        content,
        savedContent: content,
        dirty: false,
        view: 'source'
      }
      documentPaths.set(docId, physicalPath)
      documentOrigins.set(docId, {
        presetId: preset.id,
        libraryId: activeTargetLibraryId,
        originalPath: preset.originalPath,
        managedPath: preset.managedPath
      })
      mlWorkspace = {
        ...mlWorkspace,
        documents: [...mlWorkspace.documents, newDoc],
        activeId: docId
      }
    }
    openedLabel = preset.label
    await persistMilkLabWorkspace(mlWorkspace)
  } else {
    // New blank preset document
    const docId = crypto.randomUUID()
    const untitledNum = mlWorkspace.documents.filter((d) => !d.path).length + 1
    const docName = `Untitled ${untitledNum}.milk`
    const newDoc: MilkLabDocument = {
      id: docId,
      name: docName,
      path: null,
      content: blankPreset,
      savedContent: '',
      dirty: true,
      view: 'source'
    }
    documentOrigins.set(docId, {
      libraryId: activeTargetLibraryId
    })
    mlWorkspace = {
      ...mlWorkspace,
      documents: [...mlWorkspace.documents, newDoc],
      activeId: docId
    }
    openedLabel = docName
    await persistMilkLabWorkspace(mlWorkspace)
  }

  const vendorRoot = resolveMilkLabVendorRoot()
  const preloadPath = path.join(vendorRoot, 'preload.cjs')
  const indexHtmlPath = path.join(vendorRoot, 'renderer', 'index.html')

  if (milkLabWindow && !milkLabWindow.isDestroyed()) {
    milkLabWindow.webContents.reload()
    if (milkLabWindow.isMinimized()) milkLabWindow.restore()
    milkLabWindow.show()
    milkLabWindow.focus()
    return {
      ok: true,
      message: `Opened "${openedLabel}" in milkLab Preset IDE`
    }
  }

  const iconCandidates = [
    path.join(app.getAppPath(), 'dist', 'icon.ico'),
    path.join(app.getAppPath(), 'public', 'icon.ico'),
    path.join(app.getAppPath(), 'build', 'icon.ico')
  ]
  const resolvedIcon = iconCandidates.find((c) => fs.existsSync(c))

  milkLabReadyToClose = false
  milkLabWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1060,
    minHeight: 680,
    backgroundColor: '#1e1e1e',
    frame: false,
    title: 'milkLab — Preset IDE',
    icon: resolvedIcon,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  milkLabWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  milkLabWindow.webContents.session.setPermissionRequestHandler((_web, permission, callback) =>
    callback(permission === 'media')
  )

  milkLabWindow.on('close', (event) => {
    if (!milkLabReadyToClose && milkLabWindow && !milkLabWindow.isDestroyed()) {
      event.preventDefault()
      milkLabWindow.webContents.send('closing')
    }
  })

  milkLabWindow.on('closed', () => {
    milkLabWindow = null
    milkLabReadyToClose = false
  })

  milkLabWindow.once('ready-to-show', () => {
    milkLabWindow?.show()
    milkLabWindow?.focus()
  })

  await milkLabWindow.loadFile(indexHtmlPath)
  logEvent('info', 'milkLab', `Launched milkLab Preset IDE (${options.mode}): ${openedLabel}`)

  return {
    ok: true,
    message: `Opened "${openedLabel}" in milkLab Preset IDE`
  }
}

export function closeMilkLabWindowOnQuit(): void {
  if (milkLabWindow && !milkLabWindow.isDestroyed()) {
    milkLabReadyToClose = true
    milkLabWindow.destroy()
    milkLabWindow = null
  }
}
