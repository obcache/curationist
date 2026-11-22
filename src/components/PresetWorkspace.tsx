import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Code2,
  Copy,
  Edit3,
  ExternalLink,
  FileCode,
  FolderPlus,
  HardDriveDownload,
  Library,
  ListChecks,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UploadCloud,
  Wrench,
  X
} from 'lucide-react'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { DockableSection } from './DockableSection'
import { extractNormalizedDir, FolderTreeFilter } from './FolderTreeFilter'
import { ManagedStorageSelector } from './ManagedStorageSelector'
import { ObsLedToggle } from './ObsSourceSettingsModal'
import { ProjectMPreviewPanel } from './ProjectMPreviewPanel'
import { StarRatingCell } from './StarRatingCell'
import { useColumnOrder } from '../hooks/useColumnOrder'
import { useResizableColumns } from '../hooks/useResizableColumns'
import { useVirtualTable } from '../hooks/useVirtualTable'
import type { PanelViewItem } from './TitleBar'
import type {
  AppSettings,
  ObsConnectionState,
  PresetInspectionResult,
  PresetItem,
  PresetPlaylist,
  PresetPlaylistItem,
  PresetWorkspaceState,
  SectionLayoutState,
  SidebarSide
} from '../types'

export const PRESET_PANELS_DEF = [
  { id: 'preset-libraries', label: 'Preset Logical Libraries' },
  { id: 'preset-playlists', label: 'All Preset Playlists' },
  { id: 'projectm-preview', label: 'projectM Visualizer Preview' },
  { id: 'preset-inspector', label: 'Preset Validator & Shader Inspector' },
  { id: 'active-obspiltmilk', label: 'Active library.json & playlist.dat' }
]

interface PresetWorkspaceProps {
  state: PresetWorkspaceState
  settings: AppSettings
  onStateChange: (next: PresetWorkspaceState) => void
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onNotify: (msg: string) => void
  layoutResetCounter: number
  onPanelsChange?: (panels: PanelViewItem[]) => void
  panelActionRef?: React.MutableRefObject<{
    togglePanel: (id: string) => void
    showAllPanels: () => void
  } | null>
  milkLabActionRef?: React.MutableRefObject<{
    openNew: () => void
    openEditSelected: () => void
    getSelectedPresetId: () => string | null
  } | null>
  obsVideoMode: boolean
  onToggleObsVideoMode: () => void
  obsConnection: ObsConnectionState
  selectedObsVideoSourceId: string
  onSelectObsVideoSourceId: (id: string) => void
}

const PRESET_SECTIONS_STORAGE_KEY = 'curationist:preset-sections:v3'
const PRESET_SPLIT_STORAGE_KEY = 'curationist:preset-split-ratio'

const DEFAULT_PRESET_SECTIONS: SectionLayoutState[] = [
  { id: 'preset-libraries', side: 'left', collapsed: false, order: 0, visible: true, size: 0.8 },
  { id: 'preset-playlists', side: 'left', collapsed: false, order: 1, visible: true, size: 1.0 },
  { id: 'projectm-preview', side: 'left', collapsed: false, order: 2, visible: true, size: 1.4 },
  { id: 'preset-inspector', side: 'right', collapsed: false, order: 0, visible: true, size: 1.2 },
  { id: 'active-obspiltmilk', side: 'right', collapsed: false, order: 1, visible: true, size: 0.8 }
]

function loadInitialPresetSections(): SectionLayoutState[] {
  try {
    const saved = localStorage.getItem(PRESET_SECTIONS_STORAGE_KEY)
    if (!saved) return DEFAULT_PRESET_SECTIONS
    const parsed = JSON.parse(saved) as SectionLayoutState[]
    const map = new Map(parsed.map((s) => [s.id, s]))
    return DEFAULT_PRESET_SECTIONS.map((def) => {
      const existing = map.get(def.id)
      if (existing) {
        return {
          ...def,
          ...existing,
          visible: existing.visible !== false,
          size: existing.size || def.size || 1
        }
      }
      return def
    })
  } catch {
    return DEFAULT_PRESET_SECTIONS
  }
}

export const PresetWorkspace: React.FC<PresetWorkspaceProps> = ({
  state,
  settings,
  onStateChange,
  onUpdateSettings,
  onNotify,
  layoutResetCounter,
  onPanelsChange,
  panelActionRef,
  milkLabActionRef,
  obsVideoMode,
  onToggleObsVideoMode,
  obsConnection,
  selectedObsVideoSourceId,
  onSelectObsVideoSourceId
}) => {
  const [sections, setSections] = useState<SectionLayoutState[]>(loadInitialPresetSections)

  const [centerTopRatio, setCenterTopRatio] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(PRESET_SPLIT_STORAGE_KEY))
      return saved >= 0.18 && saved <= 0.82 ? saved : 0.52
    } catch {
      return 0.52
    }
  })
  const centerSplitContainerRef = useRef<HTMLDivElement>(null)
  const leftSidebarRef = useRef<HTMLDivElement>(null)
  const rightSidebarRef = useRef<HTMLDivElement>(null)

  const [activePreviewPresetPath, setActivePreviewPresetPath] = useState<string | null>(null)
  const [activePreviewPresetLabel, setActivePreviewPresetLabel] = useState<string | null>(null)
  const [previewNonce, setPreviewNonce] = useState<number>(0)
  const [isPlaylistPlaying, setIsPlaylistPlaying] = useState<boolean>(false)
  const [playingPlaylistId, setPlayingPlaylistId] = useState<string | null>(null)

  const presetDurationSec = Math.max(2, settings.presetPlaylistDurationSec || 15)

  const updateCenterTopRatio = (next: number) => {
    const clamped = Math.max(0.18, Math.min(0.82, next))
    setCenterTopRatio(clamped)
    try {
      localStorage.setItem(PRESET_SPLIT_STORAGE_KEY, String(clamped))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (layoutResetCounter > 0) {
      setSections(DEFAULT_PRESET_SECTIONS)
      localStorage.setItem(
        PRESET_SECTIONS_STORAGE_KEY,
        JSON.stringify(DEFAULT_PRESET_SECTIONS)
      )
      updateCenterTopRatio(0.52)
    }
  }, [layoutResetCounter])

  const updateSections = (updater: (prev: SectionLayoutState[]) => SectionLayoutState[]) => {
    setSections((prev) => {
      const next = updater(prev)
      localStorage.setItem(PRESET_SECTIONS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const toggleCollapse = (id: string) => {
    updateSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, collapsed: !s.collapsed } : s))
    )
  }

  const swapSide = (id: string) => {
    updateSections((prev) => {
      const target = prev.find((s) => s.id === id)
      if (!target) return prev
      const nextSide: SidebarSide = target.side === 'left' ? 'right' : 'left'
      const maxOrder = prev
        .filter((s) => s.side === nextSide)
        .reduce((acc, s) => Math.max(acc, s.order), -1)
      return prev.map((s) =>
        s.id === id ? { ...s, side: nextSide, order: maxOrder + 1 } : s
      )
    })
  }

  const hideSection = (id: string) => {
    updateSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, visible: false } : s))
    )
  }

  const toggleVisibility = useCallback((id: string) => {
    updateSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, visible: s.visible === false ? true : false } : s))
    )
  }, [])

  const showAllPanels = useCallback(() => {
    updateSections((prev) => prev.map((s) => ({ ...s, visible: true })))
  }, [])

  useEffect(() => {
    if (onPanelsChange) {
      onPanelsChange(
        PRESET_PANELS_DEF.map((def) => {
          const sec = sections.find((s) => s.id === def.id)
          return {
            id: def.id,
            label: def.label,
            visible: sec ? sec.visible !== false : true
          }
        })
      )
    }
  }, [sections, onPanelsChange])

  useEffect(() => {
    if (panelActionRef) {
      panelActionRef.current = {
        togglePanel: toggleVisibility,
        showAllPanels
      }
    }
  }, [panelActionRef, toggleVisibility, showAllPanels])

  const moveSectionOrder = (id: string, delta: -1 | 1) => {
    updateSections((prev) => {
      const target = prev.find((s) => s.id === id)
      if (!target) return prev
      const sideList = prev
        .filter((s) => s.side === target.side)
        .sort((a, b) => a.order - b.order)
      const idx = sideList.findIndex((s) => s.id === id)
      const neighborIdx = idx + delta
      if (idx === -1 || neighborIdx < 0 || neighborIdx >= sideList.length) return prev
      const reordered = [...sideList]
      const tmp = reordered[idx]
      reordered[idx] = reordered[neighborIdx]
      reordered[neighborIdx] = tmp
      const orderMap = new Map(reordered.map((s, i) => [s.id, i]))
      return prev.map((s) => (orderMap.has(s.id) ? { ...s, order: orderMap.get(s.id)! } : s))
    })
  }

  const [leftWidth, setLeftWidth] = useState(330)
  const [rightWidth, setRightWidth] = useState(370)

  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('all')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [includeSubfolders, setIncludeSubfolders] = useState<boolean>(true)
  const [librarySearch, setLibrarySearch] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'rated' | '5star' | '4plus' | '3plus'>('all')
  const [copyOnImport, setCopyOnImport] = useState(settings.copyPresetToManagedByDefault)

  type PresetLibSortCol = 'label' | 'rating' | 'storage' | 'libraryName' | 'originalPath'
  type PresetPlSortCol = 'position' | 'label' | 'rating' | 'path'
  type PresetLibColKey = 'play' | PresetLibSortCol
  type PresetPlColKey = 'play' | 'pos' | 'label' | 'rating' | 'path' | 'dir'

  const [libSort, setLibSort] = useState<{ col: PresetLibSortCol | null; dir: 'asc' | 'desc' }>({
    col: null,
    dir: 'asc'
  })
  const [plSort, setPlSort] = useState<{ col: PresetPlSortCol | null; dir: 'asc' | 'desc' }>({
    col: null,
    dir: 'asc'
  })

  const { widths: libColWidths, startResize: startLibColResize } = useResizableColumns(
    'curationist:preset-lib-cols:v1',
    {
      play: 34,
      label: 300,
      rating: 108,
      storage: 92,
      libraryName: 145,
      originalPath: 340
    }
  )

  const {
    order: libColOrder,
    getHeaderDragProps: getLibHeaderDragProps
  } = useColumnOrder<PresetLibColKey>('curationist:preset-lib-col-order:v1', [
    'play',
    'label',
    'rating',
    'storage',
    'libraryName',
    'originalPath'
  ])

  const { widths: plColWidths, startResize: startPlColResize } = useResizableColumns(
    'curationist:preset-pl-cols:v1',
    {
      play: 34,
      pos: 48,
      label: 300,
      rating: 108,
      path: 380,
      dir: 42
    }
  )

  const {
    order: plColOrder,
    getHeaderDragProps: getPlHeaderDragProps
  } = useColumnOrder<PresetPlColKey>('curationist:preset-pl-col-order:v1', [
    'play',
    'pos',
    'label',
    'rating',
    'path',
    'dir'
  ])

  const cycleLibSort = (col: PresetLibSortCol) => {
    setLibSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return { col: null, dir: 'asc' }
    })
  }

  const cyclePlSort = (col: PresetPlSortCol) => {
    setPlSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return { col: null, dir: 'asc' }
    })
  }

  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([])
  const [lastClickedPresetId, setLastClickedPresetId] = useState<string | null>(null)

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [selectedPlaylistItemIds, setSelectedPlaylistItemIds] = useState<string[]>([])
  const [lastClickedItemId, setLastClickedItemId] = useState<string | null>(null)

  const selectedPresetIdSet = useMemo(() => new Set(selectedPresetIds), [selectedPresetIds])
  const selectedPlaylistItemIdSet = useMemo(
    () => new Set(selectedPlaylistItemIds),
    [selectedPlaylistItemIds]
  )

  const presetByIdMap = useMemo(() => {
    const map = new Map<string, PresetItem>()
    for (const p of state.presets) {
      if (!map.has(p.id)) map.set(p.id, p)
    }
    return map
  }, [state.presets])

  const [centerTab, setCenterTab] = useState<'split' | 'library' | 'playlist' | 'publish-preview'>(
    'split'
  )
  const [busy, setBusy] = useState(false)
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<string | null>(null)

  const [inspection, setInspection] = useState<PresetInspectionResult | null>(null)
  const [showOriginalSource, setShowOriginalSource] = useState(false)

  const [promptModal, setPromptModal] = useState<{
    title: string
    initialValue: string
    onConfirm: (val: string) => Promise<void>
  } | null>(null)
  const [promptInput, setPromptInput] = useState('')

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    entries: ContextMenuEntry[]
  } | null>(null)

  const [deleteDiskConfirm, setDeleteDiskConfirm] = useState<{
    title: string
    count: number
    onConfirm: () => Promise<void>
  } | null>(null)

  const getActiveManagedPresetFolderPath = useCallback(() => {
    const folders = settings.managedStorageFolders || []
    const found = folders.find((f) => f.id === settings.selectedPresetStorageFolderId) || folders[0]
    return found?.path || settings.presetManagedStoragePath
  }, [
    settings.managedStorageFolders,
    settings.selectedPresetStorageFolderId,
    settings.presetManagedStoragePath
  ])

  const presetTransferVerb = settings.presetManagedTransferMode === 'move' ? 'Move' : 'Copy'

  useEffect(() => {
    if (!selectedPlaylistId && state.playlists.length > 0) {
      const active = state.playlists.find((p) => p.isActiveDat) || state.playlists[0]
      setSelectedPlaylistId(active.id)
    } else if (
      selectedPlaylistId &&
      !state.playlists.some((p) => p.id === selectedPlaylistId)
    ) {
      setSelectedPlaylistId(state.playlists[0]?.id || null)
    }
  }, [state.playlists, selectedPlaylistId])

  useEffect(() => {
    setCopyOnImport(settings.copyPresetToManagedByDefault)
  }, [settings.copyPresetToManagedByDefault])

  // Deduplicate presets when viewing 'all' libraries
  const libraryScopedPresets = useMemo(() => {
    const seen = new Set<string>()
    return state.presets.filter((p) => {
      if (selectedLibraryId !== 'all' && p.libraryId !== selectedLibraryId) return false
      if (selectedLibraryId === 'all') {
        if (seen.has(p.id)) return false
        seen.add(p.id)
      }
      return true
    })
  }, [state.presets, selectedLibraryId])

  const libraryFilePaths = useMemo(
    () => libraryScopedPresets.map((p) => p.originalPath),
    [libraryScopedPresets]
  )

  const filteredPresets = useMemo(() => {
    const q = librarySearch.trim().toLowerCase()
    const folderLower = selectedFolder ? selectedFolder.toLowerCase() : null

    const base = libraryScopedPresets.filter((p) => {
      if (folderLower) {
        const dirLower = extractNormalizedDir(p.originalPath).toLowerCase()
        if (includeSubfolders) {
          if (dirLower !== folderLower && !dirLower.startsWith(`${folderLower}/`)) {
            return false
          }
        } else if (dirLower !== folderLower) {
          return false
        }
      }
      const r = p.rating || 0
      if (filterMode === 'rated' && r === 0) return false
      if (filterMode === '5star' && r < 5) return false
      if (filterMode === '4plus' && r < 4) return false
      if (filterMode === '3plus' && r < 3) return false
      if (!q) return true
      return (
        p.label.toLowerCase().includes(q) ||
        p.filename.toLowerCase().includes(q) ||
        p.originalPath.toLowerCase().includes(q)
      )
    })

    if (!libSort.col) return base
    const dirMul = libSort.dir === 'asc' ? 1 : -1
    const sorted = [...base]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (libSort.col) {
        case 'label':
          cmp = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
          break
        case 'rating':
          cmp = (a.rating || 0) - (b.rating || 0)
          break
        case 'storage': {
          const rankA = !a.fileExists ? 0 : a.isManaged ? 2 : 1
          const rankB = !b.fileExists ? 0 : b.isManaged ? 2 : 1
          cmp = rankA - rankB
          break
        }
        case 'libraryName':
          cmp = (a.libraryName || '').localeCompare(b.libraryName || '', undefined, {
            sensitivity: 'base'
          })
          break
        case 'originalPath':
          cmp = a.originalPath.localeCompare(b.originalPath, undefined, { sensitivity: 'base' })
          break
      }
      return cmp * dirMul
    })
    return sorted
  }, [libraryScopedPresets, selectedFolder, includeSubfolders, librarySearch, filterMode, libSort])

  const selectedPlaylist: PresetPlaylist | null = useMemo(
    () => state.playlists.find((p) => p.id === selectedPlaylistId) || null,
    [state.playlists, selectedPlaylistId]
  )

  const sortedPlaylistItems = useMemo(() => {
    const items = selectedPlaylist?.items || []
    if (!plSort.col) return items
    const dirMul = plSort.dir === 'asc' ? 1 : -1
    const sorted = [...items]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (plSort.col) {
        case 'position':
          cmp = a.position - b.position
          break
        case 'label':
          cmp = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
          break
        case 'rating':
          cmp = (a.rating || 0) - (b.rating || 0)
          break
        case 'path': {
          const pathA = settings.playlistDatUseManagedPaths ? a.managedPath : a.originalPath
          const pathB = settings.playlistDatUseManagedPaths ? b.managedPath : b.originalPath
          cmp = pathA.localeCompare(pathB, undefined, { sensitivity: 'base' })
          break
        }
      }
      return cmp * dirMul
    })
    return sorted
  }, [selectedPlaylist?.items, plSort, settings.playlistDatUseManagedPaths])

  const libVirtual = useVirtualTable(filteredPresets.length, 26, 24)
  const plVirtual = useVirtualTable(sortedPlaylistItems.length, 26, 24)

  const activeDatPlaylist: PresetPlaylist | null = useMemo(
    () => state.playlists.find((p) => p.isActiveDat) || null,
    [state.playlists]
  )

  // Inspect single selected preset
  const primaryInspectedPresetId = useMemo(() => {
    if (selectedPresetIds.length > 0) return selectedPresetIds[0]
    if (selectedPlaylist && selectedPlaylistItemIds.length > 0) {
      const item = (selectedPlaylist.items || []).find(
        (it) => it.id === selectedPlaylistItemIds[0]
      )
      return item?.presetId || null
    }
    return null
  }, [selectedPresetIds, selectedPlaylist, selectedPlaylistItemIds])

  useEffect(() => {
    if (!primaryInspectedPresetId) {
      setInspection(null)
      return
    }
    window.curationist
      .inspectPreset(primaryInspectedPresetId)
      .then((res) => setInspection(res))
      .catch(() => setInspection(null))
  }, [primaryInspectedPresetId, state.presets])

  // Windows Multi-select for Preset Library
  const handlePresetRowClick = (e: React.MouseEvent, presetId: string) => {
    if (e.shiftKey && lastClickedPresetId) {
      const ids = filteredPresets.map((p) => p.id)
      const start = ids.indexOf(lastClickedPresetId)
      const end = ids.indexOf(presetId)
      if (start !== -1 && end !== -1) {
        const [lo, hi] = start < end ? [start, end] : [end, start]
        const range = ids.slice(lo, hi + 1)
        setSelectedPresetIds(
          e.ctrlKey || e.metaKey
            ? Array.from(new Set([...selectedPresetIds, ...range]))
            : range
        )
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedPresetIds((prev) =>
        prev.includes(presetId)
          ? prev.filter((id) => id !== presetId)
          : [...prev, presetId]
      )
      setLastClickedPresetId(presetId)
    } else {
      setSelectedPresetIds([presetId])
      setLastClickedPresetId(presetId)
    }
  }

  // Windows Multi-select for Preset Playlist Items
  const handlePlaylistItemClick = (e: React.MouseEvent, itemId: string) => {
    const items = sortedPlaylistItems
    if (e.shiftKey && lastClickedItemId) {
      const ids = items.map((it) => it.id)
      const start = ids.indexOf(lastClickedItemId)
      const end = ids.indexOf(itemId)
      if (start !== -1 && end !== -1) {
        const [lo, hi] = start < end ? [start, end] : [end, start]
        const range = ids.slice(lo, hi + 1)
        setSelectedPlaylistItemIds(
          e.ctrlKey || e.metaKey
            ? Array.from(new Set([...selectedPlaylistItemIds, ...range]))
            : range
        )
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedPlaylistItemIds((prev) =>
        prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
      )
      setLastClickedItemId(itemId)
    } else {
      setSelectedPlaylistItemIds([itemId])
      setLastClickedItemId(itemId)
    }
  }

  const openPrompt = (
    title: string,
    initialValue: string,
    onConfirm: (val: string) => Promise<void>
  ) => {
    setPromptInput(initialValue)
    setPromptModal({ title, initialValue, onConfirm })
  }

  // Actions
  const handleSetPresetRating = async (presetIds: string[], rating: number) => {
    if (presetIds.length === 0) return
    const next = await window.curationist.setPresetsRating(presetIds, rating)
    onStateChange(next)
  }

  const handleImportPresets = async (mode: 'files' | 'folder') => {
    const targetLib =
      selectedLibraryId === 'all' ? 'default-preset-lib' : selectedLibraryId
    const paths = await window.curationist.pickFilesOrFolders({
      title:
        mode === 'folder'
          ? 'Import Folder of .milk Presets (Validates & Repairs projectM Shaders)'
          : 'Import .milk Preset Files',
      mode,
      filters:
        mode === 'files' ? [{ name: 'MilkDrop Presets', extensions: ['milk'] }] : undefined
    })
    if (paths.length === 0) return
    setBusy(true)
    onNotify('Validating & repairing .milk presets for projectM compatibility...')
    try {
      const targetFolderPath = getActiveManagedPresetFolderPath()
      const move = settings.presetManagedTransferMode === 'move'
      const { batch, state: nextState } = await window.curationist.importPresets(
        paths,
        targetLib,
        copyOnImport,
        { targetFolderPath, move }
      )
      onStateChange(nextState)
      onNotify(
        `Imported ${batch.imported} preset(s) (${batch.repaired} auto-repaired, ${batch.warnings} warning(s), ${batch.duplicates} duplicate(s), ${batch.errors.length} rejected)`
      )
    } finally {
      setBusy(false)
    }
  }

  const handleImportExternalLibraryJson = async () => {
    const targetLib =
      selectedLibraryId === 'all' ? 'default-preset-lib' : selectedLibraryId
    const files = await window.curationist.pickFilesOrFolders({
      title: 'Import obSpiltMilk library.json',
      mode: 'files',
      filters: [{ name: 'Library JSON', extensions: ['json'] }]
    })
    if (files.length === 0) return
    setBusy(true)
    try {
      const res = await window.curationist.importPresetLibraryJson(files[0], targetLib)
      onStateChange(res.state)
      onNotify(`Imported ${res.imported} preset record(s) from library.json`)
    } finally {
      setBusy(false)
    }
   }

  const handleImportExternalPlaylistDat = async () => {
    const files = await window.curationist.pickFilesOrFolders({
      title: 'Import obSpiltMilk playlist.dat or .txt preset list',
      mode: 'files',
      filters: [{ name: 'Preset Playlist', extensions: ['dat', 'txt'] }]
    })
    if (files.length === 0) return
    const filePath = files[0]
    const defaultName = filePath.split(/[\\/]/).pop() || 'Imported playlist.dat'
    const res = await window.curationist.importPresetPlaylistDat(
      filePath,
      defaultName,
      false
    )
    onStateChange(res.state)
    setSelectedPlaylistId(res.playlistId)
    onNotify(`Imported preset playlist "${defaultName}" (${res.itemCount} presets)`)
  }

  const handleCopyPresetsByIdsToManaged = async (ids: string[]) => {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const targetFolderPath = getActiveManagedPresetFolderPath()
      const move = settings.presetManagedTransferMode === 'move'
      const res = await window.curationist.copyPresetsToManaged(
        ids,
        selectedLibraryId === 'all' ? undefined : selectedLibraryId,
        { targetFolderPath, move }
      )
      onStateChange(res.state)
      onNotify(
        `${move ? 'Moved' : 'Copied'} ${res.copied} .milk preset(s) to managed storage (${targetFolderPath})`
      )
    } finally {
      setBusy(false)
    }
  }

  const handleCopySelectedToManaged = async () => {
    await handleCopyPresetsByIdsToManaged(selectedPresetIds)
  }

  const handleRemovePresetsByIds = async (ids: string[]) => {
    if (ids.length === 0) return
    const next = await window.curationist.removePresets(
      ids,
      selectedLibraryId === 'all' ? undefined : selectedLibraryId
    )
    onStateChange(next)
    setSelectedPresetIds((prev) => prev.filter((id) => !ids.includes(id)))
    onNotify(
      `Removed ${ids.length} preset(s) from visible library (retained for existing playlists)`
    )
  }

  const handleRemoveSelectedPresets = async () => {
    await handleRemovePresetsByIds(selectedPresetIds)
  }

  const handleDeletePresetsFromDisk = (ids: string[]) => {
    if (ids.length === 0) return
    setDeleteDiskConfirm({
      title: `Delete ${ids.length} Preset File(s) from Disk`,
      count: ids.length,
      onConfirm: async () => {
        setBusy(true)
        try {
          const res = await window.curationist.deletePresetsFromDisk(ids)
          onStateChange(res.state)
          setSelectedPresetIds((prev) => prev.filter((id) => !ids.includes(id)))
          onNotify(
            `Deleted ${res.deleted} .milk file(s) from disk and removed ${ids.length} preset record(s)`
          )
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const handleDeletePlaylistItemsFromDisk = (itemIds: string[]) => {
    if (!selectedPlaylist || itemIds.length === 0) return
    const plId = selectedPlaylist.id
    setDeleteDiskConfirm({
      title: `Delete ${itemIds.length} Playlist Preset File(s) from Disk`,
      count: itemIds.length,
      onConfirm: async () => {
        setBusy(true)
        try {
          const res = await window.curationist.deletePresetPlaylistItemsFromDisk(plId, itemIds)
          onStateChange(res.state)
          setSelectedPlaylistItemIds((prev) => prev.filter((id) => !itemIds.includes(id)))
          onNotify(
            `Deleted ${res.deleted} .milk file(s) from disk and removed ${itemIds.length} playlist item(s)`
          )
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const handleRenameSinglePresetById = (presetId: string) => {
    const p = presetByIdMap.get(presetId)
    if (!p) return
    openPrompt('Rename Preset Display Label', p.label, async (val) => {
      const next = await window.curationist.relabelPreset(p.id, val)
      onStateChange(next)
      onNotify(`Relabeled preset to "${val}"`)
    })
  }

  const handleRenameSinglePreset = () => {
    if (selectedPresetIds.length !== 1) return
    handleRenameSinglePresetById(selectedPresetIds[0])
  }

  const handleAddPresetsByIdsToPlaylist = async (
    ids: string[],
    targetPlaylistId?: string,
    insertPos?: number
  ) => {
    const plId = targetPlaylistId || selectedPlaylist?.id
    if (!plId || ids.length === 0) return
    const plName = state.playlists.find((p) => p.id === plId)?.name || 'playlist'
    const next = await window.curationist.addPresetsToPlaylist(plId, ids, insertPos)
    onStateChange(next)
    onNotify(`Added ${ids.length} preset(s) to "${plName}"`)
  }

  const handleAddSelectedToPlaylist = async (insertPos?: number) => {
    await handleAddPresetsByIdsToPlaylist(selectedPresetIds, selectedPlaylist?.id, insertPos)
  }

  const handleRemovePlaylistItemsByIds = async (itemIds: string[]) => {
    if (!selectedPlaylist || itemIds.length === 0) return
    const next = await window.curationist.removeItemsFromPresetPlaylist(
      selectedPlaylist.id,
      itemIds
    )
    onStateChange(next)
    setSelectedPlaylistItemIds((prev) => prev.filter((id) => !itemIds.includes(id)))
    onNotify(`Removed ${itemIds.length} item(s) from "${selectedPlaylist.name}"`)
  }

  const handleRemoveSelectedPlaylistItems = async () => {
    await handleRemovePlaylistItemsByIds(selectedPlaylistItemIds)
  }

  const handleMovePlaylistItems = async (direction: -1 | 1, overrideIds?: string[]) => {
    const targetIds = overrideIds || selectedPlaylistItemIds
    if (!selectedPlaylist || targetIds.length === 0) return
    const items = [...(selectedPlaylist.items || [])]
    const selSet = new Set(targetIds)
    const count = items.length

    for (let i = 0; i < count; ++i) {
      const idx = direction < 0 ? i : count - 1 - i
      const neighbor = idx + direction
      if (neighbor < 0 || neighbor >= count) continue
      if (selSet.has(items[idx].id) && !selSet.has(items[neighbor].id)) {
        const tmp = items[idx]
        items[idx] = items[neighbor]
        items[neighbor] = tmp
      }
    }

    const next = await window.curationist.reorderPresetPlaylistItems(
      selectedPlaylist.id,
      items.map((it) => it.id)
    )
    onStateChange(next)
  }

  const handlePublishPresets = async () => {
    setBusy(true)
    try {
      const res = await window.curationist.publishPresets()
      onStateChange(res.state)
      onNotify(
        `Published ${res.libraryPresetsWritten} library presets to library.json & ${res.playlistItemsWritten} items to playlist.dat`
      )
    } catch (err: any) {
      onNotify(`Publish error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleOpenMilkLabNew = useCallback(async () => {
    try {
      const res = await window.curationist.openMilkLab({
        mode: 'new',
        libraryId: selectedLibraryId === 'all' ? 'default-preset-lib' : selectedLibraryId
      })
      onNotify(res.message)
    } catch (err: any) {
      onNotify(`milkLab error: ${err?.message || String(err)}`)
    }
  }, [selectedLibraryId, onNotify])

  const handleOpenMilkLabEdit = useCallback(
    async (explicitPresetId?: string) => {
      const targetId = explicitPresetId || primaryInspectedPresetId
      if (!targetId) {
        onNotify('Select a preset first to edit it in milkLab')
        return
      }
      try {
        const res = await window.curationist.openMilkLab({
          mode: 'edit',
          presetId: targetId,
          libraryId: selectedLibraryId === 'all' ? undefined : selectedLibraryId
        })
        onNotify(res.message)
      } catch (err: any) {
        onNotify(`milkLab error: ${err?.message || String(err)}`)
      }
    },
    [primaryInspectedPresetId, selectedLibraryId, onNotify]
  )

  useEffect(() => {
    if (milkLabActionRef) {
      milkLabActionRef.current = {
        openNew: () => {
          void handleOpenMilkLabNew()
        },
        openEditSelected: () => {
          void handleOpenMilkLabEdit()
        },
        getSelectedPresetId: () => primaryInspectedPresetId
      }
    }
  }, [milkLabActionRef, handleOpenMilkLabNew, handleOpenMilkLabEdit, primaryInspectedPresetId])

  const resolvePresetTarget = useCallback(
    (presetIdOrPath: string): { id: string; path: string; label: string } => {
      const lower = presetIdOrPath.toLowerCase()
      const foundPreset =
        presetByIdMap.get(presetIdOrPath) ||
        state.presets.find(
          (p) =>
            p.id.toLowerCase() === lower ||
            p.managedPath.toLowerCase() === lower ||
            p.originalPath.toLowerCase() === lower
        )
      if (foundPreset) {
        return {
          id: foundPreset.id,
          path: foundPreset.managedPath || foundPreset.originalPath,
          label: foundPreset.label
        }
      }
      for (const pl of state.playlists) {
        for (const it of pl.items || []) {
          if (
            it.id === presetIdOrPath ||
            it.presetId === presetIdOrPath ||
            it.managedPath.toLowerCase() === lower ||
            it.originalPath.toLowerCase() === lower
          ) {
            const p = it.presetId ? presetByIdMap.get(it.presetId) : undefined
            const path = p
              ? p.managedPath || p.originalPath
              : it.managedPath || it.originalPath
            return {
              id: it.presetId || it.id,
              path,
              label:
                p?.label ||
                it.label ||
                path.split(/[/\\]/).pop()?.replace(/\.milk$/i, '') ||
                path
            }
          }
        }
      }
      return {
        id: presetIdOrPath,
        path: presetIdOrPath,
        label: presetIdOrPath.split(/[/\\]/).pop()?.replace(/\.milk$/i, '') || presetIdOrPath
      }
    },
    [presetByIdMap, state.presets, state.playlists]
  )

  const handleQueuePresetsToObs = useCallback(
    (presetIdsOrPaths: string[], mode: 'play_now' | 'play_next' | 'append') => {
      if (presetIdsOrPaths.length === 0) return
      const videoSources = obsConnection.sources.filter((s) => s.kind === 'video')
      const targetObsSourceId =
        selectedObsVideoSourceId &&
        (videoSources.length === 0 ||
          videoSources.some((s) => s.sourceId === selectedObsVideoSourceId))
          ? selectedObsVideoSourceId
          : videoSources[0]?.sourceId
      const firstResolved = resolvePresetTarget(presetIdsOrPaths[0])

      void window.curationist
        .publishObsVideoQueue({
          sourceId: targetObsSourceId,
          presetIds: presetIdsOrPaths,
          mode
        })
        .then(() => {
          if (mode === 'play_now') {
            onNotify(
              obsConnection.connected
                ? `Playing "${firstResolved.label}" now in OBS Curationist Visualizer`
                : `Staged "${firstResolved.label}" to play now in OBS Curationist Visualizer`
            )
          } else if (mode === 'play_next') {
            onNotify(
              `Staged ${presetIdsOrPaths.length} preset(s) to play next in OBS Curationist Visualizer (current preset uninterrupted)`
            )
          } else {
            onNotify(
              `Appended ${presetIdsOrPaths.length} preset(s) to OBS Curationist Visualizer live queue`
            )
          }
        })
        .catch((err: any) => {
          onNotify(`OBS Visualizer queue error: ${err?.message || String(err)}`)
        })
    },
    [obsConnection, selectedObsVideoSourceId, resolvePresetTarget, onNotify]
  )

  const handlePreviewPreset = useCallback(
    (presetIdOrPath: string, e?: React.MouseEvent, keepPlayingSet = false) => {
      if (e) e.stopPropagation()
      if (!keepPlayingSet) {
        setIsPlaylistPlaying(false)
      }
      const resolved = resolvePresetTarget(presetIdOrPath)
      const presetPath = resolved.path
      const presetLabel = resolved.label

      setActivePreviewPresetPath(presetPath)
      setActivePreviewPresetLabel(presetLabel)
      setPreviewNonce((n) => n + 1)

      // Ensure the projectm-preview section is visible and uncollapsed
      setSections((prev) => {
        const next = prev.map((s) =>
          s.id === 'projectm-preview' ? { ...s, visible: true, collapsed: false } : s
        )
        localStorage.setItem(PRESET_SECTIONS_STORAGE_KEY, JSON.stringify(next))
        return next
      })

      // When OB Remote LED is active, ship the preset to Curationist Visualizer in OBS
      if (obsVideoMode && presetPath) {
        handleQueuePresetsToObs([resolved.id || presetPath], 'play_now')
        return
      }

      onNotify(`Previewing preset in projectM: ${presetLabel}`)
    },
    [resolvePresetTarget, onNotify, obsVideoMode, handleQueuePresetsToObs]
  )

  const activePlayingPlaylist = useMemo(() => {
    if (playingPlaylistId) {
      const found = state.playlists.find((p) => p.id === playingPlaylistId)
      if (found) return found
    }
    return selectedPlaylist || activeDatPlaylist || null
  }, [playingPlaylistId, state.playlists, selectedPlaylist, activeDatPlaylist])

  const playlistItems = (activePlayingPlaylist || selectedPlaylist)?.items || []
  const currentPlaylistIdx = activePreviewPresetPath
    ? playlistItems.findIndex((it) => {
        const p = it.presetId ? presetByIdMap.get(it.presetId) : undefined
        const itPath = it.managedPath || it.originalPath
        const pPath = p ? p.managedPath || p.originalPath : ''
        return (
          (pPath && pPath.toLowerCase() === activePreviewPresetPath.toLowerCase()) ||
          itPath.toLowerCase() === activePreviewPresetPath.toLowerCase()
        )
      })
    : -1

  const handlePlayPresetPlaylist = useCallback(
    (pl: PresetPlaylist, startIndex = 0, e?: React.MouseEvent) => {
      if (e) e.stopPropagation()
      const items = pl.items || []
      if (items.length === 0) {
        onNotify(`Playlist "${pl.name}" is empty`)
        return
      }
      setSelectedPlaylistId(pl.id)
      setPlayingPlaylistId(pl.id)

      const idx = Math.max(0, Math.min(items.length - 1, startIndex))
      const firstItem = items[idx]
      const firstResolved = resolvePresetTarget(firstItem.presetId || firstItem.id)
      setActivePreviewPresetPath(firstResolved.path)
      setActivePreviewPresetLabel(firstResolved.label)
      setPreviewNonce((n) => n + 1)

      if (obsVideoMode) {
        const videoSources = obsConnection.sources.filter((s) => s.kind === 'video')
        const targetObsSourceId =
          selectedObsVideoSourceId &&
          (videoSources.length === 0 ||
            videoSources.some((s) => s.sourceId === selectedObsVideoSourceId))
            ? selectedObsVideoSourceId
            : videoSources[0]?.sourceId
        const orderedIds = items
          .slice(startIndex)
          .concat(items.slice(0, startIndex))
          .map((it) => it.presetId || it.managedPath || it.originalPath || it.id)
          .filter(Boolean)
        void window.curationist
          .publishObsVideoQueue({
            sourceId: targetObsSourceId,
            presetIds: orderedIds,
            mode: 'play_now'
          })
          .then(() => {
            onNotify(
              obsConnection.connected
                ? `Broadcasting preset playlist "${pl.name}" (${items.length} presets) to OBS Curationist Visualizer`
                : `Published playlist "${pl.name}" to OBS Curationist Visualizer queue`
            )
          })
          .catch((err: any) => {
            onNotify(`OBS Visualizer playlist error: ${err?.message || String(err)}`)
          })
        return
      }

      handlePreviewPreset(firstResolved.path, undefined, true)
      setIsPlaylistPlaying(true)
      onNotify(
        `Playing preset playlist "${pl.name}" (${items.length} presets, ${presetDurationSec}s per preset)`
      )
    },
    [
      resolvePresetTarget,
      handlePreviewPreset,
      onNotify,
      presetDurationSec,
      obsVideoMode,
      selectedObsVideoSourceId,
      obsConnection
    ]
  )

  const handleTogglePlaylistPlay = useCallback(() => {
    if (isPlaylistPlaying) {
      setIsPlaylistPlaying(false)
      onNotify('Stopped preset playlist auto-advance')
      return
    }
    const targetPl = selectedPlaylist || activeDatPlaylist
    if (!targetPl || (targetPl.items || []).length === 0) {
      onNotify('Select a non-empty preset playlist to play')
      return
    }
    const startIdx = currentPlaylistIdx >= 0 ? currentPlaylistIdx : 0
    handlePlayPresetPlaylist(targetPl, startIdx)
  }, [
    isPlaylistPlaying,
    selectedPlaylist,
    activeDatPlaylist,
    currentPlaylistIdx,
    handlePlayPresetPlaylist,
    onNotify
  ])

  const handlePrevPreset = useCallback(() => {
    if (playlistItems.length === 0) return
    const prevIdx =
      currentPlaylistIdx <= 0 ? playlistItems.length - 1 : currentPlaylistIdx - 1
    const item = playlistItems[prevIdx]
    const p = item.presetId ? presetByIdMap.get(item.presetId) : undefined
    const target = p ? p.managedPath || p.originalPath : item.managedPath || item.originalPath
    handlePreviewPreset(target, undefined, isPlaylistPlaying)
  }, [playlistItems, currentPlaylistIdx, presetByIdMap, handlePreviewPreset, isPlaylistPlaying])

  const handleNextPreset = useCallback(() => {
    if (playlistItems.length === 0) return
    const nextIdx =
      currentPlaylistIdx === -1 || currentPlaylistIdx >= playlistItems.length - 1
        ? 0
        : currentPlaylistIdx + 1
    const item = playlistItems[nextIdx]
    const p = item.presetId ? presetByIdMap.get(item.presetId) : undefined
    const target = p ? p.managedPath || p.originalPath : item.managedPath || item.originalPath
    handlePreviewPreset(target, undefined, isPlaylistPlaying)
  }, [playlistItems, currentPlaylistIdx, presetByIdMap, handlePreviewPreset, isPlaylistPlaying])

  // Auto-advance timer when playing a preset playlist locally
  useEffect(() => {
    if (!isPlaylistPlaying || obsVideoMode || playlistItems.length === 0) return
    const timer = setInterval(() => {
      handleNextPreset()
    }, presetDurationSec * 1000)
    return () => clearInterval(timer)
  }, [isPlaylistPlaying, obsVideoMode, playlistItems.length, presetDurationSec, handleNextPreset])

  // When OB Video Remote is switched ON while a local preset playlist is playing,
  // stop the local timer and hand off the entire playlist to OBS Curationist Visualizer
  useEffect(() => {
    if (obsVideoMode && isPlaylistPlaying) {
      setIsPlaylistPlaying(false)
      const targetPl = activePlayingPlaylist || selectedPlaylist || activeDatPlaylist
      if (targetPl && (targetPl.items || []).length > 0) {
        const startIdx = currentPlaylistIdx >= 0 ? currentPlaylistIdx : 0
        handlePlayPresetPlaylist(targetPl, startIdx)
      }
    }
  }, [
    obsVideoMode,
    isPlaylistPlaying,
    activePlayingPlaylist,
    selectedPlaylist,
    activeDatPlaylist,
    currentPlaylistIdx,
    handlePlayPresetPlaylist
  ])

  // Context Menu for Preset Library rows
  const handlePresetContextMenu = (e: React.MouseEvent, preset: PresetItem) => {
    e.preventDefault()
    e.stopPropagation()
    let targetIds = selectedPresetIds
    if (!selectedPresetIdSet.has(preset.id)) {
      targetIds = [preset.id]
      setSelectedPresetIds(targetIds)
      setLastClickedPresetId(preset.id)
    }
    const count = targetIds.length
    const entries: ContextMenuEntry[] = [
      {
        type: 'rating',
        id: 'rate-preset',
        label: count > 1 ? `Rate (${count})` : 'Rate Preset',
        currentRating: preset.rating || 0,
        onSelectRating: (r: number) => {
          void handleSetPresetRating(targetIds, r)
        }
      },
      { type: 'separator', id: 'sep-rate' },
      {
        id: 'play-now',
        label: obsVideoMode
          ? 'Play Now in OBS (Curationist Visualizer)'
          : 'Play Now in projectM Preview',
        icon: <Play size={12} />,
        onClick: () => handlePreviewPreset(preset.id)
      },
      {
        id: 'play-next-obs',
        label: `Play Next in OBS Live Queue (${count})`,
        icon: <ArrowRight size={12} />,
        onClick: () => handleQueuePresetsToObs(targetIds, 'play_next')
      },
      {
        id: 'append-obs',
        label: `Add to OBS Live Queue (${count})`,
        icon: <Plus size={12} />,
        onClick: () => handleQueuePresetsToObs(targetIds, 'append')
      },
      { type: 'separator', id: 'sep-milklab' },
      {
        id: 'edit-in-milklab',
        label: 'Edit Preset in milkLab...',
        icon: <Code2 size={12} />,
        onClick: () => {
          void handleOpenMilkLabEdit(preset.id)
        }
      },
      {
        id: 'new-in-milklab',
        label: 'New Preset in milkLab...',
        icon: <Plus size={12} />,
        onClick: () => {
          void handleOpenMilkLabNew()
        }
      },
      { type: 'separator', id: 'sep-pl' },
      {
        id: 'add-to-playlist',
        label: `Add to "${selectedPlaylist?.name || 'Selected Playlist'}" (${count})`,
        icon: <ArrowRight size={12} />,
        disabled: !selectedPlaylist,
        onClick: () => {
          void handleAddPresetsByIdsToPlaylist(targetIds, selectedPlaylist?.id)
        }
      },
      {
        id: 'rename-preset',
        label: 'Rename Display Label...',
        icon: <Edit3 size={12} />,
        disabled: count !== 1,
        onClick: () => handleRenameSinglePresetById(targetIds[0])
      },
      {
        id: 'copy-to-managed',
        label: `${presetTransferVerb} to Managed Storage (${count})`,
        icon: <HardDriveDownload size={12} />,
        onClick: () => {
          void handleCopyPresetsByIdsToManaged(targetIds)
        }
      },
      {
        id: 'reveal-explorer',
        label: 'Reveal in Windows Explorer',
        icon: <ExternalLink size={12} />,
        onClick: () => {
          window.curationist.showItemInFolder(preset.managedPath || preset.originalPath)
        }
      },
      { type: 'separator', id: 'sep-remove' },
      {
        id: 'remove-from-lib',
        label: `Remove from Library (${count})`,
        icon: <Trash2 size={12} />,
        onClick: () => {
          void handleRemovePresetsByIds(targetIds)
        }
      },
      {
        id: 'delete-from-disk',
        label: `Delete from Disk Permanently (${count})...`,
        icon: <Trash2 size={12} />,
        danger: true,
        onClick: () => handleDeletePresetsFromDisk(targetIds)
      }
    ]
    setContextMenu({ x: e.clientX, y: e.clientY, entries })
  }

  // Context Menu for Preset Playlist rows
  const handlePlaylistItemContextMenu = (e: React.MouseEvent, item: PresetPlaylistItem) => {
    e.preventDefault()
    e.stopPropagation()
    let targetItemIds = selectedPlaylistItemIds
    if (!selectedPlaylistItemIdSet.has(item.id)) {
      targetItemIds = [item.id]
      setSelectedPlaylistItemIds(targetItemIds)
      setLastClickedItemId(item.id)
    }
    const count = targetItemIds.length
    const selectedItems = (selectedPlaylist?.items || []).filter((it) =>
      targetItemIds.includes(it.id)
    )
    const presetIds = selectedItems.filter((it) => it.presetId).map((it) => it.presetId!)
    const queueTokens = selectedItems.map(
      (it) => it.presetId || it.managedPath || it.originalPath || it.id
    )

    const entries: ContextMenuEntry[] = [
      {
        type: 'rating',
        id: 'rate-pl-preset',
        label: count > 1 ? `Rate (${count})` : 'Rate Preset',
        currentRating: item.rating || 0,
        onSelectRating: (r: number) => {
          if (presetIds.length > 0) {
            void handleSetPresetRating(presetIds, r)
          }
        }
      },
      { type: 'separator', id: 'sep-pl-rate' },
      {
        id: 'preview-pl-projectm',
        label: obsVideoMode
          ? 'Play Now in OBS (Curationist Visualizer)'
          : 'Play Now in projectM Preview',
        icon: <Play size={12} />,
        onClick: () => handlePreviewPreset(item.presetId || item.id)
      },
      {
        id: 'play-next-pl-obs',
        label: `Play Next in OBS Live Queue (${count})`,
        icon: <ArrowRight size={12} />,
        onClick: () => handleQueuePresetsToObs(queueTokens, 'play_next')
      },
      {
        id: 'append-pl-obs',
        label: `Add to OBS Live Queue (${count})`,
        icon: <Plus size={12} />,
        onClick: () => handleQueuePresetsToObs(queueTokens, 'append')
      },
      {
        id: 'play-pl-set',
        label: `Play Entire Playlist from Here (${presetDurationSec}s/preset)`,
        icon: <Play size={12} />,
        disabled: !selectedPlaylist,
        onClick: () => {
          if (selectedPlaylist) {
            handlePlayPresetPlaylist(selectedPlaylist, item.position)
          }
        }
      },
      { type: 'separator', id: 'sep-pl-milklab' },
      {
        id: 'edit-pl-in-milklab',
        label: 'Edit Preset in milkLab...',
        icon: <Code2 size={12} />,
        disabled: !item.presetId,
        onClick: () => {
          if (item.presetId) void handleOpenMilkLabEdit(item.presetId)
        }
      },
      {
        id: 'new-pl-in-milklab',
        label: 'New Preset in milkLab...',
        icon: <Plus size={12} />,
        onClick: () => {
          void handleOpenMilkLabNew()
        }
      },
      { type: 'separator', id: 'sep-pl-move' },
      {
        id: 'move-pl-up',
        label: `Move Up (${count})`,
        icon: <ArrowUp size={12} />,
        onClick: () => {
          void handleMovePlaylistItems(-1, targetItemIds)
        }
      },
      {
        id: 'move-pl-down',
        label: `Move Down (${count})`,
        icon: <ArrowDown size={12} />,
        onClick: () => {
          void handleMovePlaylistItems(1, targetItemIds)
        }
      },
      {
        id: 'copy-pl-managed',
        label: `${presetTransferVerb} to Managed Storage (${presetIds.length})`,
        icon: <HardDriveDownload size={12} />,
        disabled: presetIds.length === 0,
        onClick: () => {
          void handleCopyPresetsByIdsToManaged(presetIds)
        }
      },
      {
        id: 'reveal-pl-explorer',
        label: 'Reveal in Windows Explorer',
        icon: <ExternalLink size={12} />,
        onClick: () => {
          window.curationist.showItemInFolder(item.managedPath || item.originalPath)
        }
      },
      { type: 'separator', id: 'sep-pl-remove' },
      {
        id: 'remove-from-pl',
        label: `Remove from Playlist (${count})`,
        icon: <Trash2 size={12} />,
        onClick: () => {
          void handleRemovePlaylistItemsByIds(targetItemIds)
        }
      },
      {
        id: 'delete-pl-disk',
        label: `Delete from Disk Permanently (${count})...`,
        icon: <Trash2 size={12} />,
        danger: true,
        onClick: () => handleDeletePlaylistItemsFromDisk(targetItemIds)
      }
    ]
    setContextMenu({ x: e.clientX, y: e.clientY, entries })
  }

  const renderSection = (
    sec: SectionLayoutState,
    idxInSide: number,
    totalInSide: number,
    style?: React.CSSProperties
  ) => {
    const canMoveUp = idxInSide > 0
    const canMoveDown = idxInSide < totalInSide - 1
    switch (sec.id) {
      case 'projectm-preview':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="projectM Visualizer Preview"
            side={sec.side}
            collapsed={sec.collapsed}
            onToggleCollapse={toggleCollapse}
            onSwapSide={swapSide}
            onHide={hideSection}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveOrder={moveSectionOrder}
            style={style}
          >
            <ProjectMPreviewPanel
              activePresetPath={activePreviewPresetPath}
              activePresetLabel={activePreviewPresetLabel}
              previewNonce={previewNonce}
              onPrevPreset={handlePrevPreset}
              onNextPreset={handleNextPreset}
              hasPrevPreset={playlistItems.length > 1}
              hasNextPreset={playlistItems.length > 1}
              isPlaylistPlaying={isPlaylistPlaying}
              onTogglePlaylistPlay={handleTogglePlaylistPlay}
              presetDurationSec={presetDurationSec}
              onChangePresetDurationSec={(sec) => {
                void onUpdateSettings({ presetPlaylistDurationSec: sec })
              }}
              isCollapsed={sec.collapsed}
              onNotify={onNotify}
              obsVideoMode={obsVideoMode}
              onToggleObsVideoMode={onToggleObsVideoMode}
              obsConnection={obsConnection}
              selectedObsVideoSourceId={selectedObsVideoSourceId}
              onSelectObsVideoSourceId={onSelectObsVideoSourceId}
            />
          </DockableSection>
        )

      case 'preset-playlists':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="All Preset Playlists"
            count={state.playlists.length}
            side={sec.side}
            collapsed={sec.collapsed}
            onToggleCollapse={toggleCollapse}
            onSwapSide={swapSide}
            onHide={hideSection}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveOrder={moveSectionOrder}
            style={style}
            actions={
              <>
                <button
                  className="icon-btn"
                  title="New Preset Playlist"
                  onClick={() =>
                    openPrompt('New Preset Playlist Name', 'New Preset Set', async (val) => {
                      const res = await window.curationist.createPresetPlaylist(val, false)
                      onStateChange(res.state)
                      setSelectedPlaylistId(res.newId)
                    })
                  }
                >
                  <Plus size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Rename Selected Playlist"
                  disabled={!selectedPlaylist}
                  onClick={() => {
                    if (!selectedPlaylist) return
                    openPrompt('Rename Preset Playlist', selectedPlaylist.name, async (val) => {
                      const next = await window.curationist.renamePresetPlaylist(
                        selectedPlaylist.id,
                        val
                      )
                      onStateChange(next)
                    })
                  }}
                >
                  <Edit3 size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Duplicate Selected Playlist"
                  disabled={!selectedPlaylist}
                  onClick={async () => {
                    if (!selectedPlaylist) return
                    const res = await window.curationist.duplicatePresetPlaylist(
                      selectedPlaylist.id
                    )
                    onStateChange(res.state)
                    setSelectedPlaylistId(res.newId)
                  }}
                >
                  <Copy size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Import playlist.dat or .txt Preset List"
                  onClick={handleImportExternalPlaylistDat}
                >
                  <Upload size={13} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete Selected Playlist"
                  disabled={!selectedPlaylist}
                  onClick={async () => {
                    if (!selectedPlaylist) return
                    const next = await window.curationist.deletePresetPlaylist(
                      selectedPlaylist.id
                    )
                    onStateChange(next)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </>
            }
          >
            <div className="list-scroll">
              {state.playlists.map((pl) => {
                const isSelected = pl.id === selectedPlaylistId
                const isDragTarget = dragOverPlaylistId === `all-${pl.id}`
                const isPlayingThis = isPlaylistPlaying && playingPlaylistId === pl.id
                return (
                  <div
                    key={pl.id}
                    className={`list-row ${isSelected ? 'selected' : ''} ${
                      isDragTarget ? 'drag-target-playlist' : ''
                    }`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        'application/x-curationist-preset-playlist-id',
                        pl.id
                      )
                      e.dataTransfer.effectAllowed = 'copyMove'
                    }}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes('application/x-curationist-preset-ids') ||
                        e.dataTransfer.types.includes('application/x-curationist-preset-playlist-id')
                      ) {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'copy'
                        setDragOverPlaylistId(`all-${pl.id}`)
                      }
                    }}
                    onDragLeave={() => {
                      setDragOverPlaylistId((prev) => (prev === `all-${pl.id}` ? null : prev))
                    }}
                    onDrop={async (e) => {
                      setDragOverPlaylistId(null)
                      const rawPlId = e.dataTransfer.getData(
                        'application/x-curationist-preset-playlist-id'
                      )
                      if (rawPlId && rawPlId !== pl.id) {
                        const sourcePl = state.playlists.find((p) => p.id === rawPlId)
                        if (sourcePl) {
                          const presetIds = (sourcePl.items || [])
                            .map((it) => it.presetId)
                            .filter((id): id is string => Boolean(id))
                          if (presetIds.length > 0) {
                            await handleAddPresetsByIdsToPlaylist(presetIds, pl.id)
                          }
                        }
                        return
                      }
                      const raw = e.dataTransfer.getData('application/x-curationist-preset-ids')
                      if (raw) {
                        try {
                          const ids = JSON.parse(raw) as string[]
                          if (ids.length > 0) {
                            await handleAddPresetsByIdsToPlaylist(ids, pl.id)
                          }
                        } catch {
                          // ignore
                        }
                      }
                    }}
                    onClick={() => {
                      setSelectedPlaylistId(pl.id)
                      setSelectedPlaylistItemIds([])
                    }}
                  >
                    <div className="list-row-main">
                      <ListChecks size={13} />
                      <span className="list-row-title">{pl.name}</span>
                    </div>
                    <div className="list-row-meta">
                      {pl.isActiveDat && <span className="badge synced">Active .dat</span>}
                      <span>{pl.itemCount}</span>
                      <button
                        className="icon-btn accent"
                        title={
                          isPlayingThis
                            ? 'Stop Playing Preset Playlist'
                            : `Play Preset Playlist "${pl.name}" in projectM (${presetDurationSec}s/preset)`
                        }
                        disabled={pl.itemCount === 0}
                        onClick={(e) => {
                          if (isPlayingThis) {
                            e.stopPropagation()
                            setIsPlaylistPlaying(false)
                            onNotify('Stopped preset playlist auto-advance')
                          } else {
                            handlePlayPresetPlaylist(pl, 0, e)
                          }
                        }}
                      >
                        {isPlayingThis ? <Square size={10} /> : <Play size={11} />}
                      </button>
                      {!pl.isActiveDat && (
                        <button
                          className="icon-btn accent"
                          title="Stage as Active playlist.dat Target"
                          onClick={async (e) => {
                            e.stopPropagation()
                            const next = await window.curationist.setActivePresetPlaylist(pl.id)
                            onStateChange(next)
                            onNotify(`Staged "${pl.name}" as active playlist.dat target (Modified)`)
                          }}
                        >
                          <ArrowRight size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </DockableSection>
        )

      case 'preset-libraries':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="Preset Logical Libraries"
            count={state.presets.length}
            side={sec.side}
            collapsed={sec.collapsed}
            onToggleCollapse={toggleCollapse}
            onSwapSide={swapSide}
            onHide={hideSection}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveOrder={moveSectionOrder}
            style={style}
            actions={
              <>
                <button
                  className="icon-btn"
                  title="New Logical Preset Library"
                  onClick={() =>
                    openPrompt('New Preset Library Name', 'Custom Pack Library', async (val) => {
                      const next = await window.curationist.createPresetLibrary(val)
                      onStateChange(next)
                    })
                  }
                >
                  <Plus size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Import existing library.json"
                  onClick={handleImportExternalLibraryJson}
                >
                  <Upload size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Rename Selected Library"
                  disabled={selectedLibraryId === 'all'}
                  onClick={() => {
                    const lib = state.libraries.find((l) => l.id === selectedLibraryId)
                    if (!lib) return
                    openPrompt('Rename Preset Library', lib.name, async (val) => {
                      const next = await window.curationist.renamePresetLibrary(lib.id, val)
                      onStateChange(next)
                    })
                  }}
                >
                  <Edit3 size={13} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete Selected Library"
                  disabled={
                    selectedLibraryId === 'all' || selectedLibraryId === 'default-preset-lib'
                  }
                  onClick={async () => {
                    const next = await window.curationist.deletePresetLibrary(selectedLibraryId)
                    onStateChange(next)
                    setSelectedLibraryId('all')
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </>
            }
          >
            <div className="sub-toolbar" style={{ flexWrap: 'wrap' }}>
              <label className="checkbox-row" title={getActiveManagedPresetFolderPath()}>
                <input
                  type="checkbox"
                  checked={copyOnImport}
                  onChange={(e) => setCopyOnImport(e.target.checked)}
                />
                <span>{presetTransferVerb} Repaired .milk to Selected Managed Storage</span>
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="vscode-btn"
                  disabled={busy}
                  onClick={() => handleImportPresets('files')}
                  title="Import & Validate .milk Files"
                >
                  <Plus size={12} /> .milk Files
                </button>
                <button
                  className="vscode-btn primary"
                  disabled={busy}
                  onClick={() => handleImportPresets('folder')}
                  title="Import & Validate Folder of .milk Presets"
                >
                  <FolderPlus size={12} /> Folder
                </button>
              </div>
            </div>

            <div className="list-scroll">
              <div
                className={`list-row ${selectedLibraryId === 'all' ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedLibraryId('all')
                  setSelectedFolder(null)
                }}
              >
                <div className="list-row-main">
                  <Library size={13} />
                  <span className="list-row-title">All Validated Presets (Aggregate)</span>
                </div>
                <div className="list-row-meta">{state.presets.length}</div>
              </div>
              {state.libraries.map((lib) => (
                <div
                  key={lib.id}
                  className={`list-row ${selectedLibraryId === lib.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedLibraryId(lib.id)
                    setSelectedFolder(null)
                  }}
                >
                  <div className="list-row-main">
                    <Sparkles size={13} />
                    <span className="list-row-title">{lib.name}</span>
                  </div>
                  <div className="list-row-meta">{lib.presetCount}</div>
                </div>
              ))}

              <FolderTreeFilter
                filePaths={libraryFilePaths}
                selectedFolder={selectedFolder}
                includeSubfolders={includeSubfolders}
                onSelectFolder={setSelectedFolder}
                onToggleIncludeSubfolders={() => setIncludeSubfolders((v) => !v)}
              />
            </div>
          </DockableSection>
        )

      case 'active-obspiltmilk':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="Active library.json & playlist.dat"
            count={activeDatPlaylist?.itemCount || 0}
            badgeText={state.isModified ? 'MODIFIED' : 'SYNCED'}
            badgeVariant={state.isModified ? 'modified' : 'synced'}
            side={sec.side}
            collapsed={sec.collapsed}
            onToggleCollapse={toggleCollapse}
            onSwapSide={swapSide}
            onHide={hideSection}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveOrder={moveSectionOrder}
            style={style}
            actions={
              <>
                <button
                  className="icon-btn"
                  title="New Preset Playlist (Create Locally & Stage as Active playlist.dat)"
                  onClick={() =>
                    openPrompt(
                      'New Staged Preset Playlist Name',
                      'New Preset Set',
                      async (val) => {
                        const res = await window.curationist.createPresetPlaylist(val, true)
                        onStateChange(res.state)
                        setSelectedPlaylistId(res.newId)
                        onNotify(`Created and staged "${val}" as active playlist.dat target`)
                      }
                    )
                  }
                >
                  <Plus size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Preview Generated library.json & playlist.dat"
                  onClick={() =>
                    setCenterTab(centerTab === 'publish-preview' ? 'split' : 'publish-preview')
                  }
                >
                  <FileCode size={13} />
                </button>
                {state.isModified && (
                  <button
                    className="icon-btn danger"
                    title="Discard Draft & Reload from Disk"
                    onClick={async () => {
                      const next = await window.curationist.discardPresetDraft()
                      onStateChange(next)
                      onNotify('Discarded preset draft and reloaded library.json & playlist.dat')
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </>
            }
          >
            <div className="sub-toolbar">
              <span
                style={{
                  fontSize: 11,
                  color: state.isModified ? '#e2c08d' : '#8b949e',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {activeDatPlaylist
                  ? `Staged: ${activeDatPlaylist.name}`
                  : 'Drag a preset playlist here'}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {activeDatPlaylist && (
                  <button
                    className="vscode-btn"
                    disabled={(activeDatPlaylist.items || []).length === 0}
                    onClick={(e) => {
                      if (isPlaylistPlaying && playingPlaylistId === activeDatPlaylist.id) {
                        setIsPlaylistPlaying(false)
                        onNotify('Stopped preset playlist auto-advance')
                      } else {
                        handlePlayPresetPlaylist(activeDatPlaylist, 0, e)
                      }
                    }}
                    title="Play or stop staged playlist.dat in projectM"
                  >
                    {isPlaylistPlaying && playingPlaylistId === activeDatPlaylist.id ? (
                      <>
                        <Square size={11} /> Stop
                      </>
                    ) : (
                      <>
                        <Play size={11} /> Play
                      </>
                    )}
                  </button>
                )}
                <button
                  className="vscode-btn"
                  disabled={busy}
                  onClick={() =>
                    openPrompt(
                      'New Staged Preset Playlist Name',
                      'New Preset Set',
                      async (val) => {
                        const res = await window.curationist.createPresetPlaylist(val, true)
                        onStateChange(res.state)
                        setSelectedPlaylistId(res.newId)
                        onNotify(`Created and staged "${val}" as active playlist.dat target`)
                      }
                    )
                  }
                  title="Create a new preset playlist and automatically stage it as active playlist.dat"
                >
                  <Plus size={12} /> New Playlist
                </button>
                <button
                  className={`vscode-btn ${state.isModified ? 'publish' : 'primary'}`}
                  disabled={busy}
                  onClick={handlePublishPresets}
                  title="Write managed .milk files, library.json, and playlist.dat"
                >
                  <UploadCloud size={12} /> Publish
                </button>
              </div>
            </div>

            <div
              className="list-scroll"
              onDragOver={(e) => {
                if (
                  e.dataTransfer.types.includes(
                    'application/x-curationist-preset-playlist-id'
                  ) ||
                  e.dataTransfer.types.includes('application/x-curationist-preset-ids')
                ) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={async (e) => {
                const plId = e.dataTransfer.getData(
                  'application/x-curationist-preset-playlist-id'
                )
                if (plId) {
                  const next = await window.curationist.setActivePresetPlaylist(plId)
                  onStateChange(next)
                  setSelectedPlaylistId(plId)
                  onNotify('Staged playlist as active playlist.dat target (Modified)')
                  return
                }
                const rawPresets = e.dataTransfer.getData('application/x-curationist-preset-ids')
                if (rawPresets && activeDatPlaylist) {
                  try {
                    const ids = JSON.parse(rawPresets) as string[]
                    if (ids.length > 0) {
                      await handleAddPresetsByIdsToPlaylist(ids, activeDatPlaylist.id)
                    }
                  } catch {
                    // ignore
                  }
                }
              }}
            >
              <div style={{ padding: '8px 10px', borderBottom: '1px solid #2b2b2b', fontSize: 11 }}>
                <div style={{ color: '#8b949e' }}>
                  <strong>library.json:</strong> {state.presets.length} validated presets across{' '}
                  {state.libraries.length} library(s)
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5,
                    color: '#6e7681',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={state.targetLibraryJsonPath}
                >
                  {state.targetLibraryJsonPath}
                </div>
                <div style={{ color: '#8b949e', marginTop: 4 }}>
                  <strong>playlist.dat:</strong>{' '}
                  {activeDatPlaylist
                    ? `${activeDatPlaylist.name} (${activeDatPlaylist.itemCount} presets)`
                    : 'None selected'}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5,
                    color: '#6e7681',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={state.targetPlaylistDatPath}
                >
                  {state.targetPlaylistDatPath}
                </div>
              </div>

              {activeDatPlaylist &&
                (activeDatPlaylist.items || []).map((item, idx) => (
                  <div
                    key={item.id}
                    className="list-row"
                    onClick={() => {
                      setSelectedPlaylistId(activeDatPlaylist.id)
                      setSelectedPlaylistItemIds([item.id])
                    }}
                    onDoubleClick={(e) => handlePreviewPreset(item.presetId || item.id, e)}
                  >
                    <div className="list-row-main">
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10.5,
                          color: '#8b949e',
                          width: 22
                        }}
                      >
                        #{idx + 1}
                      </span>
                      <span className="list-row-title">{item.label}</span>
                    </div>
                    <div className="list-row-meta">
                      {(item.rating || 0) > 0 && (
                        <span style={{ color: '#f5b335', fontSize: 10.5, letterSpacing: -1 }}>
                          {'★'.repeat(item.rating || 0)}
                        </span>
                      )}
                      <button
                        className="icon-btn accent"
                        title="Preview Preset in projectM"
                        onClick={(e) => handlePreviewPreset(item.presetId || item.id, e)}
                      >
                        <Play size={11} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </DockableSection>
        )

      case 'preset-inspector':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="Preset Validator & Shader Inspector"
            side={sec.side}
            collapsed={sec.collapsed}
            onToggleCollapse={toggleCollapse}
            onSwapSide={swapSide}
            onHide={hideSection}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveOrder={moveSectionOrder}
            style={style}
          >
            {!inspection ? (
              <div className="empty-placeholder">
                <span>
                  Select any .milk preset to inspect its projectM shader repairs, compatibility warnings, and source code
                </span>
              </div>
            ) : (
              <div className="inspector-pane">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <strong style={{ color: '#ffffff', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inspection.label}
                  </strong>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      className="vscode-btn"
                      onClick={() => void handleOpenMilkLabEdit(inspection.id)}
                      title="Open this preset in milkLab Preset IDE"
                    >
                      <Code2 size={11} /> Edit in milkLab
                    </button>
                    <button
                      className="vscode-btn primary"
                      onClick={(e) => handlePreviewPreset(inspection.id, e)}
                      title="Preview preset in projectM"
                    >
                      <Play size={11} /> Preview in projectM
                    </button>
                    <button
                      className="vscode-btn"
                      onClick={handleRenameSinglePreset}
                      title="Rename Friendly Display Label"
                    >
                      <Edit3 size={11} /> Relabel
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: '#8b949e', fontFamily: 'var(--font-mono)' }}>
                  <div>ID: {inspection.id.slice(0, 24)}…</div>
                  <div>Digest: {inspection.digest.slice(0, 24)}…</div>
                </div>

                {inspection.repairs.length > 0 ? (
                  <div
                    style={{
                      background: 'rgba(197, 134, 192, 0.1)',
                      border: '1px solid rgba(197, 134, 192, 0.4)',
                      padding: 8,
                      borderRadius: 3
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        color: '#c586c0',
                        fontWeight: 600,
                        marginBottom: 4
                      }}
                    >
                      <Wrench size={13} />
                      <span>obSpiltMilk Automatic Repairs ({inspection.repairs.length})</span>
                    </div>
                    <ul style={{ paddingLeft: 16, fontSize: 11.5, color: '#e0e0e0' }}>
                      {inspection.repairs.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      color: '#4ec9b0',
                      fontSize: 11.5
                    }}
                  >
                    <ShieldCheck size={14} />
                    <span>Clean projectM preset — no shader variable collisions or tanh repairs needed</span>
                  </div>
                )}

                {inspection.warnings.length > 0 && (
                  <div
                    style={{
                      background: 'rgba(204, 167, 0, 0.12)',
                      border: '1px solid rgba(204, 167, 0, 0.45)',
                      padding: 8,
                      borderRadius: 3
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        color: '#cca700',
                        fontWeight: 600,
                        marginBottom: 4
                      }}
                    >
                      <AlertTriangle size={13} />
                      <span>Compatibility Warnings ({inspection.warnings.length})</span>
                    </div>
                    <ul style={{ paddingLeft: 16, fontSize: 11.5, color: '#f3d78b' }}>
                      {inspection.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="form-label">
                    <Code2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    {showOriginalSource ? 'Original .milk Source' : 'Repaired projectM .milk Source'}
                  </span>
                  <button
                    className="vscode-btn"
                    style={{ padding: '2px 7px', fontSize: 11 }}
                    onClick={() => setShowOriginalSource(!showOriginalSource)}
                  >
                    {showOriginalSource ? 'Show Repaired' : 'Show Original'}
                  </button>
                </div>

                <pre className="shader-code-view">
                  {showOriginalSource ? inspection.originalContent : inspection.repairedContent}
                </pre>
              </div>
            )}
          </DockableSection>
        )

      default:
        return null
    }
  }

  const leftSections = useMemo(
    () =>
      sections
        .filter((s) => s.side === 'left' && s.visible !== false)
        .sort((a, b) => a.order - b.order),
    [sections]
  )
  const rightSections = useMemo(
    () =>
      sections
        .filter((s) => s.side === 'right' && s.visible !== false)
        .sort((a, b) => a.order - b.order),
    [sections]
  )

  const startResize = (side: SidebarSide, e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const initialWidth = side === 'left' ? leftWidth : rightWidth
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      if (side === 'left') {
        setLeftWidth(Math.max(220, Math.min(600, initialWidth + delta)))
      } else {
        setRightWidth(Math.max(220, Math.min(600, initialWidth - delta)))
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startCenterVerticalResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const container = centerSplitContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.height <= 0) return

    const onMove = (ev: MouseEvent) => {
      const r = container.getBoundingClientRect()
      if (r.height <= 0) return
      const ratio = (ev.clientY - r.top) / r.height
      updateCenterTopRatio(ratio)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startSideVerticalResize = (
    secA: SectionLayoutState,
    secB: SectionLayoutState,
    containerRef: React.RefObject<HTMLDivElement | null>,
    e: React.MouseEvent
  ) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const containerHeight = container.getBoundingClientRect().height
    if (containerHeight <= 0) return

    const startY = e.clientY
    const startSizeA = secA.size || 1
    const startSizeB = secB.size || 1
    const totalSize = startSizeA + startSizeB

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const deltaY = ev.clientY - startY
      const deltaRatio = (deltaY / containerHeight) * totalSize * 2
      const newSizeA = Math.max(0.2, startSizeA + deltaRatio)
      const newSizeB = Math.max(0.2, totalSize - (newSizeA - startSizeA))
      updateSections((prev) =>
        prev.map((s) => {
          if (s.id === secA.id) return { ...s, size: newSizeA }
          if (s.id === secB.id) return { ...s, size: newSizeB }
          return s
        })
      )
    }

    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const renderSidebarSections = (
    sideList: SectionLayoutState[],
    containerRef: React.RefObject<HTMLDivElement | null>
  ) => {
    if (sideList.length === 0) return null

    const elements: React.ReactNode[] = []
    let prevExpandedSec: SectionLayoutState | null = null

    for (let i = 0; i < sideList.length; i++) {
      const sec = sideList[i]
      const isExpanded = !sec.collapsed

      if (isExpanded && prevExpandedSec) {
        const first = prevExpandedSec
        const second = sec
        elements.push(
          <div
            key={`splitter-${first.id}-${second.id}`}
            className="splitter-handle-horizontal"
            onMouseDown={(e) => startSideVerticalResize(first, second, containerRef, e)}
            onDoubleClick={() => {
              updateSections((prev) =>
                prev.map((s) =>
                  s.id === first.id || s.id === second.id ? { ...s, size: 1 } : s
                )
              )
            }}
            title="Drag to resize vertically (double-click to reset equal size)"
          />
        )
      }

      const style: React.CSSProperties = isExpanded
        ? { flex: `${sec.size || 1} 1 0%`, minHeight: 60, display: 'flex', flexDirection: 'column' }
        : { flex: '0 0 auto' }

      elements.push(renderSection(sec, i, sideList.length, style))

      if (isExpanded) {
        prevExpandedSec = sec
      }
    }

    return elements
  }

  return (
    <div className="workspace-columns">
      {/* LEFT SIDEBAR */}
      {leftSections.length > 0 && (
        <>
          <div className="sidebar-pane left" ref={leftSidebarRef} style={{ width: leftWidth }}>
            {renderSidebarSections(leftSections, leftSidebarRef)}
          </div>
          <div className="splitter-handle" onMouseDown={(e) => startResize('left', e)} />
        </>
      )}

      {/* CENTER WORKSPACE */}
      <div className="center-editor-pane">
        <div className="editor-tabbar">
          <div className="editor-tabs">
            <div
              className={`editor-tab ${centerTab === 'split' ? 'active' : ''}`}
              onClick={() => setCenterTab('split')}
            >
              <span>Split View: Preset Library &amp; Playlist Editor</span>
            </div>
            <div
              className={`editor-tab ${centerTab === 'library' ? 'active' : ''}`}
              onClick={() => setCenterTab('library')}
            >
              <span>Preset Library ({filteredPresets.length})</span>
            </div>
            <div
              className={`editor-tab ${centerTab === 'playlist' ? 'active' : ''}`}
              onClick={() => setCenterTab('playlist')}
            >
              <span>
                Preset Playlist: {selectedPlaylist ? selectedPlaylist.name : '(None)'} (
                {selectedPlaylist?.items?.length || 0})
              </span>
            </div>
            <div
              className={`editor-tab ${centerTab === 'publish-preview' ? 'active' : ''}`}
              onClick={() => setCenterTab('publish-preview')}
            >
              <span>playlist.dat &amp; library.json Draft Preview</span>
              {state.isModified && <span className="badge modified">Draft</span>}
            </div>
          </div>

          {/* Selected Storage Droplist + Copy/Move Toggle on the right above Copy/Move to Managed */}
          <ManagedStorageSelector
            domain="presets"
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            onNotify={onNotify}
          />
        </div>

        {centerTab === 'publish-preview' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="editor-toolbar">
              <div className="editor-toolbar-group">
                <strong>playlist.dat Target:</strong>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#9cdcfe' }}>
                  {state.targetPlaylistDatPath}
                </span>
              </div>
              <div className="editor-toolbar-group">
                <button className="vscode-btn publish" onClick={handlePublishPresets}>
                  <UploadCloud size={13} /> Publish library.json &amp; playlist.dat
                </button>
              </div>
            </div>
            <pre
              className="shader-code-view"
              style={{ maxHeight: 'none', flex: 1, border: 'none' }}
            >
              {(activeDatPlaylist?.items || [])
                .map((it) =>
                  settings.playlistDatUseManagedPaths ? it.managedPath : it.originalPath
                )
                .join('\n') || '(No items in active preset playlist)'}
            </pre>
          </div>
        ) : (
          <div
            ref={centerSplitContainerRef}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
          >
            {/* PRESET LIBRARY TABLE */}
            {(centerTab === 'split' || centerTab === 'library') && (
              <div
                style={{
                  flex:
                    centerTab === 'split'
                      ? `0 0 calc(${(centerTopRatio * 100).toFixed(2)}% - 3px)`
                      : 1,
                  minHeight: centerTab === 'split' ? 110 : 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden'
                }}
              >
                <div className="editor-toolbar">
                  <div className="editor-toolbar-group" style={{ flex: 1, maxWidth: 460 }}>
                    <input
                      className="vscode-input"
                      placeholder="Filter presets by label, filename, or path..."
                      value={librarySearch}
                      onChange={(e) => setLibrarySearch(e.target.value)}
                    />
                    <select
                      className="vscode-select"
                      value={filterMode}
                      onChange={(e) => setFilterMode(e.target.value as any)}
                      title="Filter presets by star rating"
                    >
                      <option value="all">All Presets</option>
                      <option value="rated">Rated (★1+)</option>
                      <option value="5star">★★★★★ (5 Stars)</option>
                      <option value="4plus">★★★★+ (4+ Stars)</option>
                      <option value="3plus">★★★+ (3+ Stars)</option>
                    </select>
                    {selectedFolder && (
                      <span className="active-folder-pill" title={`Folder filter: ${selectedFolder}`}>
                        <span className="active-folder-pill-text">{selectedFolder}</span>
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ width: 16, height: 16 }}
                          onClick={() => setSelectedFolder(null)}
                          title="Clear folder filter"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    )}
                  </div>

                  <div className="editor-toolbar-group">
                    <button
                      className="vscode-btn"
                      onClick={() => void handleOpenMilkLabNew()}
                      title="Create a new .milk preset in milkLab Preset IDE"
                    >
                      <Code2 size={12} /> New in milkLab
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={selectedPresetIds.length === 0}
                      onClick={() => void handleOpenMilkLabEdit(selectedPresetIds[0])}
                      title="Edit selected .milk preset in milkLab Preset IDE"
                    >
                      <Edit3 size={12} /> Edit in milkLab
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={selectedPresetIds.length === 0}
                      onClick={(e) => handlePreviewPreset(selectedPresetIds[0], e)}
                      title="Preview Selected Preset in projectM"
                    >
                      <Play size={12} /> Preview in projectM
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={busy}
                      onClick={() => handleImportPresets('files')}
                      title="Import & Validate .milk Files"
                    >
                      <Plus size={12} /> Add .milk
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={busy}
                      onClick={() => handleImportPresets('folder')}
                      title="Import & Validate Folder of .milk Presets"
                    >
                      <FolderPlus size={12} /> Add Folder
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={selectedPresetIds.length !== 1}
                      onClick={handleRenameSinglePreset}
                      title="Rename preset display label"
                    >
                      <Edit3 size={12} /> Rename
                    </button>
                    <button
                      className="vscode-btn primary"
                      disabled={!selectedPlaylist || selectedPresetIds.length === 0}
                      onClick={() => handleAddSelectedToPlaylist()}
                      title={`Add selected presets to "${selectedPlaylist?.name || 'Playlist'}"`}
                    >
                      <ArrowRight size={12} /> Add to Playlist ({selectedPresetIds.length})
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={selectedPresetIds.length === 0}
                      onClick={handleRemoveSelectedPresets}
                      title="Remove selected presets from library"
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={selectedPresetIds.length === 0 || busy}
                      onClick={handleCopySelectedToManaged}
                      title={`${presetTransferVerb} selected .milk preset(s) to ${getActiveManagedPresetFolderPath()}`}
                    >
                      <HardDriveDownload size={12} /> {presetTransferVerb} to Managed (
                      {selectedPresetIds.length})
                    </button>
                  </div>
                </div>

                <div
                  className="data-table-container"
                  ref={libVirtual.containerRef}
                  onScroll={libVirtual.onScroll}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                      e.preventDefault()
                      setSelectedPresetIds(filteredPresets.map((p) => p.id))
                    } else if (e.key === 'Delete' && selectedPresetIds.length > 0) {
                      handleRemoveSelectedPresets()
                    }
                  }}
                >
                  <table className="data-table">
                    <thead>
                      <tr>
                        {libColOrder.map((col) => {
                          const dragProps = getLibHeaderDragProps(col)
                          if (col === 'play') {
                            return (
                              <th
                                key={col}
                                {...dragProps}
                                className={dragProps.className}
                                style={{ width: libColWidths.play, cursor: 'grab' }}
                                title="Drag column header to reorder"
                              />
                            )
                          }
                          const labelMap: Record<PresetLibSortCol, string> = {
                            label: 'Preset Label',
                            rating: 'Rating',
                            storage: 'Storage',
                            libraryName: 'Library',
                            originalPath: 'Original / Managed Path'
                          }
                          return (
                            <th
                              key={col}
                              {...dragProps}
                              className={`sortable-th ${dragProps.className}`.trim()}
                              style={{ width: libColWidths[col], cursor: 'grab' }}
                              onClick={() => cycleLibSort(col)}
                              title="Click to sort • Drag column header to reorder"
                            >
                              <div className="th-sort-content">
                                <span>{labelMap[col]}</span>
                                {libSort.col === col && (
                                  <span className="sort-indicator">
                                    {libSort.dir === 'asc' ? '▲' : '▼'}
                                  </span>
                                )}
                              </div>
                              <div
                                className="col-resize-handle"
                                onMouseDown={(e) => startLibColResize(col, e)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {libVirtual.topSpacerHeight > 0 && (
                        <tr aria-hidden="true" style={{ height: libVirtual.topSpacerHeight }}>
                          <td colSpan={libColOrder.length} style={{ padding: 0, border: 'none' }} />
                        </tr>
                      )}
                      {filteredPresets
                        .slice(libVirtual.startIndex, libVirtual.endIndex)
                        .map((preset) => {
                          const isSel = selectedPresetIdSet.has(preset.id)
                          return (
                            <tr
                              key={`${preset.libraryId}-${preset.id}`}
                              className={isSel ? 'selected' : ''}
                              draggable
                              onDragStart={(e) => {
                                const dragIds = isSel ? selectedPresetIds : [preset.id]
                                e.dataTransfer.setData(
                                  'application/x-curationist-preset-ids',
                                  JSON.stringify(dragIds)
                                )
                                e.dataTransfer.effectAllowed = 'copy'
                              }}
                              onClick={(e) => handlePresetRowClick(e, preset.id)}
                              onContextMenu={(e) => handlePresetContextMenu(e, preset)}
                              onDoubleClick={(e) => handlePreviewPreset(preset.id, e)}
                            >
                              {libColOrder.map((col) => {
                                switch (col) {
                                  case 'play':
                                    return (
                                      <td key={col} style={{ textAlign: 'center' }}>
                                        <button
                                          className="icon-btn accent"
                                          title="Preview Preset in projectM"
                                          onClick={(e) => handlePreviewPreset(preset.id, e)}
                                        >
                                          <Play size={11} />
                                        </button>
                                      </td>
                                    )
                                  case 'label':
                                    return (
                                      <td key={col} title={preset.label}>
                                        <strong>{preset.label}</strong>
                                      </td>
                                    )
                                  case 'rating':
                                    return (
                                      <td key={col}>
                                        <StarRatingCell
                                          rating={preset.rating || 0}
                                          onRate={(r) => {
                                            void handleSetPresetRating([preset.id], r)
                                          }}
                                        />
                                      </td>
                                    )
                                  case 'storage':
                                    return (
                                      <td key={col}>
                                        {!preset.fileExists ? (
                                          <span className="badge missing">Missing</span>
                                        ) : preset.isManaged ? (
                                          <span className="badge managed">Managed</span>
                                        ) : (
                                          <span className="badge">Logical</span>
                                        )}
                                      </td>
                                    )
                                  case 'libraryName':
                                    return <td key={col}>{preset.libraryName}</td>
                                  case 'originalPath':
                                    return (
                                      <td
                                        key={col}
                                        style={{
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: 11,
                                          color: '#8b949e'
                                        }}
                                        title={`Managed: ${preset.managedPath}\nOriginal: ${preset.originalPath}`}
                                      >
                                        {preset.originalPath}
                                      </td>
                                    )
                                }
                              })}
                            </tr>
                          )
                        })}
                      {libVirtual.bottomSpacerHeight > 0 && (
                        <tr aria-hidden="true" style={{ height: libVirtual.bottomSpacerHeight }}>
                          <td colSpan={libColOrder.length} style={{ padding: 0, border: 'none' }} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {centerTab === 'split' && (
              <div
                className="splitter-handle-horizontal"
                onMouseDown={startCenterVerticalResize}
                onDoubleClick={() => updateCenterTopRatio(0.5)}
                title="Drag to resize Library and Playlist panels (double-click to reset 50/50)"
              />
            )}

            {/* PRESET PLAYLIST EDITOR */}
            {(centerTab === 'split' || centerTab === 'playlist') && (
              <div
                style={{
                  flex: 1,
                  minHeight: centerTab === 'split' ? 110 : 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden'
                }}
                onDragOver={(e) => {
                  if (
                    e.dataTransfer.types.includes('application/x-curationist-preset-ids') ||
                    e.dataTransfer.types.includes('application/x-curationist-preset-playlist-id')
                  ) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }
                }}
                onDrop={(e) => {
                  if (!selectedPlaylist) return
                  const rawPlId = e.dataTransfer.getData(
                    'application/x-curationist-preset-playlist-id'
                  )
                  if (rawPlId && rawPlId !== selectedPlaylist.id) {
                    const sourcePl = state.playlists.find((p) => p.id === rawPlId)
                    if (sourcePl) {
                      const presetIds = (sourcePl.items || [])
                        .map((it) => it.presetId)
                        .filter((id): id is string => Boolean(id))
                      if (presetIds.length > 0) {
                        void handleAddPresetsByIdsToPlaylist(presetIds, selectedPlaylist.id)
                      }
                    }
                    return
                  }
                  const raw = e.dataTransfer.getData('application/x-curationist-preset-ids')
                  if (raw) {
                    try {
                      const ids = JSON.parse(raw) as string[]
                      if (ids.length > 0) {
                        void handleAddPresetsByIdsToPlaylist(ids, selectedPlaylist.id)
                      }
                    } catch {
                      // ignore
                    }
                  }
                }}
              >
                <div className="editor-toolbar playlist-header-toolbar">
                  <div className="playlist-toolbar-left">
                    <Sparkles size={15} color="#4d85bd" />
                    <span className="playlist-header-title">
                      {selectedPlaylist ? selectedPlaylist.name : 'Select a Preset Playlist'}
                    </span>
                    {selectedPlaylist && (
                      <span
                        className="playlist-count-circle"
                        title={`${selectedPlaylist.items?.length || 0} presets in playlist`}
                      >
                        {selectedPlaylist.items?.length || 0}
                      </span>
                    )}
                  </div>

                  <div className="playlist-toolbar-center">
                    {selectedPlaylist?.isActiveDat ? (
                      <span className="badge synced">Staged for Active playlist.dat</span>
                    ) : (
                      selectedPlaylist && (
                        <button
                          className="vscode-btn"
                          onClick={async () => {
                            const next = await window.curationist.setActivePresetPlaylist(
                              selectedPlaylist.id
                            )
                            onStateChange(next)
                            onNotify(
                              `Staged "${selectedPlaylist.name}" for playlist.dat (Modified)`
                            )
                          }}
                        >
                          <ArrowRight size={11} /> Stage for playlist.dat
                        </button>
                      )
                    )}
                  </div>

                  <div className="playlist-toolbar-right">
                    <button
                      className="vscode-btn"
                      disabled={!selectedPlaylist || selectedPresetIds.length === 0}
                      onClick={() => handleAddSelectedToPlaylist()}
                      title="Add selected library presets to this playlist"
                    >
                      <Plus size={12} /> Add Selected Presets ({selectedPresetIds.length})
                    </button>
                    <button
                      className="icon-btn"
                      disabled={selectedPlaylistItemIds.length === 0}
                      onClick={() => handleMovePlaylistItems(-1)}
                      title="Move Selected Up"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      className="icon-btn"
                      disabled={selectedPlaylistItemIds.length === 0}
                      onClick={() => handleMovePlaylistItems(1)}
                      title="Move Selected Down"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={selectedPlaylistItemIds.length === 0}
                      onClick={handleRemoveSelectedPlaylistItems}
                      title="Remove selected items from preset playlist"
                    >
                      <Trash2 size={12} /> Remove ({selectedPlaylistItemIds.length})
                    </button>
                    {selectedPlaylist && (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11,
                            color: '#b0b8c2'
                          }}
                          title="How long (in seconds) each preset plays before advancing to the next preset"
                        >
                          <span>Duration:</span>
                          <input
                            type="number"
                            min={2}
                            max={600}
                            className="vscode-input"
                            style={{ width: 52, padding: '2px 5px', fontSize: 11 }}
                            value={presetDurationSec}
                            onChange={(e) => {
                              const val = Math.max(2, Math.min(600, Number(e.target.value) || 15))
                              void onUpdateSettings({ presetPlaylistDurationSec: val })
                            }}
                          />
                          <span>sec</span>
                        </div>
                        <ObsLedToggle
                          active={obsVideoMode}
                          connected={obsConnection.connected}
                          kind="video"
                          onToggle={onToggleObsVideoMode}
                        />
                        <button
                          className={`vscode-btn ${
                            isPlaylistPlaying && playingPlaylistId === selectedPlaylist.id
                              ? 'danger'
                              : 'primary'
                          }`}
                          disabled={(selectedPlaylist.items || []).length === 0}
                          onClick={(e) => {
                            if (isPlaylistPlaying && playingPlaylistId === selectedPlaylist.id) {
                              setIsPlaylistPlaying(false)
                              onNotify('Stopped preset playlist auto-advance')
                            } else {
                              handlePlayPresetPlaylist(selectedPlaylist, 0, e)
                            }
                          }}
                          title="Play or stop entire preset playlist in projectM"
                        >
                          {isPlaylistPlaying && playingPlaylistId === selectedPlaylist.id ? (
                            <>
                              <Square size={11} /> Stop Playlist
                            </>
                          ) : (
                            <>
                              <Play size={11} /> Play Playlist
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div
                  className="data-table-container"
                  ref={plVirtual.containerRef}
                  onScroll={plVirtual.onScroll}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                      e.preventDefault()
                      setSelectedPlaylistItemIds(
                        (selectedPlaylist?.items || []).map((it) => it.id)
                      )
                    } else if (e.key === 'Delete' && selectedPlaylistItemIds.length > 0) {
                      handleRemoveSelectedPlaylistItems()
                    }
                  }}
                >
                  {!selectedPlaylist ? (
                    <div className="empty-placeholder">
                      <span>Select or create a preset playlist to edit its preset order</span>
                    </div>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          {plColOrder.map((col) => {
                            const dragProps = getPlHeaderDragProps(col)
                            if (col === 'play' || col === 'dir') {
                              return (
                                <th
                                  key={col}
                                  {...dragProps}
                                  className={dragProps.className}
                                  style={{ width: plColWidths[col], cursor: 'grab' }}
                                  title="Drag column header to reorder"
                                >
                                  {col === 'dir' ? 'Dir' : ''}
                                </th>
                              )
                            }
                            const sortKey: PresetPlSortCol = col === 'pos' ? 'position' : col
                            const labelMap: Record<Exclude<PresetPlColKey, 'play' | 'dir'>, string> = {
                              pos: '#',
                              label: 'Preset Label',
                              rating: 'Rating',
                              path: 'Target Path in playlist.dat'
                            }
                            return (
                              <th
                                key={col}
                                {...dragProps}
                                className={`sortable-th ${dragProps.className}`.trim()}
                                style={{ width: plColWidths[col], cursor: 'grab' }}
                                onClick={() => cyclePlSort(sortKey)}
                                title="Click to sort • Drag column header to reorder"
                              >
                                <div className="th-sort-content">
                                  <span>{labelMap[col]}</span>
                                  {plSort.col === sortKey && (
                                    <span className="sort-indicator">
                                      {plSort.dir === 'asc' ? '▲' : '▼'}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="col-resize-handle"
                                  onMouseDown={(e) => startPlColResize(col, e)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {plVirtual.topSpacerHeight > 0 && (
                          <tr aria-hidden="true" style={{ height: plVirtual.topSpacerHeight }}>
                            <td colSpan={plColOrder.length} style={{ padding: 0, border: 'none' }} />
                          </tr>
                        )}
                        {sortedPlaylistItems
                          .slice(plVirtual.startIndex, plVirtual.endIndex)
                          .map((item) => {
                            const isSel = selectedPlaylistItemIdSet.has(item.id)
                            const effectivePath = settings.playlistDatUseManagedPaths
                              ? item.managedPath
                              : item.originalPath
                            return (
                              <tr
                                key={item.id}
                                className={isSel ? 'selected' : ''}
                                draggable
                                onDragStart={(e) => {
                                  const dragIds = isSel ? selectedPlaylistItemIds : [item.id]
                                  e.dataTransfer.setData(
                                    'application/x-curationist-preset-playlist-item-ids',
                                    JSON.stringify(dragIds)
                                  )
                                  const dragSet = new Set(dragIds)
                                  const presetIds = (selectedPlaylist.items || [])
                                    .filter((it) => dragSet.has(it.id) && it.presetId)
                                    .map((it) => it.presetId as string)
                                  if (presetIds.length > 0) {
                                    e.dataTransfer.setData(
                                      'application/x-curationist-preset-ids',
                                      JSON.stringify(presetIds)
                                    )
                                  }
                                  e.dataTransfer.effectAllowed = 'copyMove'
                                }}
                                onDragOver={(e) => {
                                  if (
                                    e.dataTransfer.types.includes(
                                      'application/x-curationist-preset-playlist-item-ids'
                                    ) ||
                                    e.dataTransfer.types.includes(
                                      'application/x-curationist-preset-ids'
                                    ) ||
                                    e.dataTransfer.types.includes(
                                      'application/x-curationist-preset-playlist-id'
                                    )
                                  ) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }
                                }}
                                onDrop={async (e) => {
                                  e.stopPropagation()
                                  const rawItemIds = e.dataTransfer.getData(
                                    'application/x-curationist-preset-playlist-item-ids'
                                  )
                                  if (rawItemIds && selectedPlaylist) {
                                    try {
                                      const draggedIds = JSON.parse(rawItemIds) as string[]
                                      if (
                                        draggedIds.length > 0 &&
                                        !draggedIds.includes(item.id)
                                      ) {
                                        const allItems = [...(selectedPlaylist.items || [])]
                                        const dragSet = new Set(draggedIds)
                                        const moving = allItems.filter((it) => dragSet.has(it.id))
                                        const remaining = allItems.filter(
                                          (it) => !dragSet.has(it.id)
                                        )
                                        const targetIdx = remaining.findIndex(
                                          (it) => it.id === item.id
                                        )
                                        const insertAt =
                                          targetIdx === -1 ? remaining.length : targetIdx
                                        remaining.splice(insertAt, 0, ...moving)
                                        const next =
                                          await window.curationist.reorderPresetPlaylistItems(
                                            selectedPlaylist.id,
                                            remaining.map((it) => it.id)
                                          )
                                        onStateChange(next)
                                      }
                                    } catch {
                                      // ignore
                                    }
                                    return
                                  }
                                  const rawPlId = e.dataTransfer.getData(
                                    'application/x-curationist-preset-playlist-id'
                                  )
                                  if (rawPlId && selectedPlaylist && rawPlId !== selectedPlaylist.id) {
                                    const sourcePl = state.playlists.find((p) => p.id === rawPlId)
                                    if (sourcePl) {
                                      const presetIds = (sourcePl.items || [])
                                        .map((it) => it.presetId)
                                        .filter((id): id is string => Boolean(id))
                                      if (presetIds.length > 0) {
                                        await handleAddPresetsByIdsToPlaylist(
                                          presetIds,
                                          selectedPlaylist.id,
                                          item.position
                                        )
                                      }
                                    }
                                    return
                                  }
                                  const rawPresets = e.dataTransfer.getData(
                                    'application/x-curationist-preset-ids'
                                  )
                                  if (rawPresets && selectedPlaylist) {
                                    try {
                                      const ids = JSON.parse(rawPresets) as string[]
                                      if (ids.length > 0) {
                                        await handleAddPresetsByIdsToPlaylist(
                                          ids,
                                          selectedPlaylist.id,
                                          item.position
                                        )
                                      }
                                    } catch {
                                      // ignore
                                    }
                                    return
                                  }
                                }}
                                onClick={(e) => handlePlaylistItemClick(e, item.id)}
                                onContextMenu={(e) => handlePlaylistItemContextMenu(e, item)}
                                onDoubleClick={(e) =>
                                  handlePreviewPreset(item.presetId || item.id, e)
                                }
                              >
                                {plColOrder.map((col) => {
                                  switch (col) {
                                    case 'play':
                                      return (
                                        <td key={col} style={{ textAlign: 'center' }}>
                                          <button
                                            className="icon-btn accent"
                                            title="Preview Preset in projectM"
                                            onClick={(e) =>
                                              handlePreviewPreset(item.presetId || item.id, e)
                                            }
                                          >
                                            <Play size={11} />
                                          </button>
                                        </td>
                                      )
                                    case 'pos':
                                      return (
                                        <td
                                          key={col}
                                          style={{ fontFamily: 'var(--font-mono)', color: '#8b949e' }}
                                        >
                                          {item.position + 1}
                                        </td>
                                      )
                                    case 'label':
                                      return (
                                        <td key={col}>
                                          <strong>{item.label}</strong>
                                        </td>
                                      )
                                    case 'rating':
                                      return (
                                        <td key={col}>
                                          <StarRatingCell
                                            rating={item.rating || 0}
                                            onRate={(r) => {
                                              if (item.presetId) {
                                                void handleSetPresetRating([item.presetId], r)
                                              }
                                            }}
                                          />
                                        </td>
                                      )
                                    case 'path':
                                      return (
                                        <td
                                          key={col}
                                          style={{
                                            fontFamily: 'var(--font-mono)',
                                            fontSize: 11,
                                            color: item.fileExists === false ? '#f14c4c' : '#8b949e'
                                          }}
                                          title={effectivePath}
                                        >
                                          {effectivePath}
                                        </td>
                                      )
                                    case 'dir':
                                      return (
                                        <td key={col} style={{ textAlign: 'center' }}>
                                          <button
                                            className="icon-btn"
                                            title="Reveal in Windows Explorer"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              window.curationist.showItemInFolder(
                                                item.managedPath || item.originalPath
                                              )
                                            }}
                                          >
                                            <ExternalLink size={11} />
                                          </button>
                                        </td>
                                      )
                                  }
                                })}
                              </tr>
                            )
                          })}
                        {plVirtual.bottomSpacerHeight > 0 && (
                          <tr aria-hidden="true" style={{ height: plVirtual.bottomSpacerHeight }}>
                            <td colSpan={6} style={{ padding: 0, border: 'none' }} />
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT SIDEBAR */}
      {rightSections.length > 0 && (
        <>
          <div className="splitter-handle" onMouseDown={(e) => startResize('right', e)} />
          <div className="sidebar-pane right" ref={rightSidebarRef} style={{ width: rightWidth }}>
            {renderSidebarSections(rightSections, rightSidebarRef)}
          </div>
        </>
      )}

      {/* Right-click Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entries={contextMenu.entries}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Delete from Disk Confirmation Modal */}
      {deleteDiskConfirm && (
        <div className="modal-backdrop" onClick={() => setDeleteDiskConfirm(null)}>
          <div
            className="modal-window"
            style={{ width: 430 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span style={{ color: '#f14c4c' }}>{deleteDiskConfirm.title}</span>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12.5, lineHeight: 1.5, color: '#e0e0e0' }}>
                Are you sure you want to permanently delete{' '}
                <strong>{deleteDiskConfirm.count}</strong> .milk file(s) from your local disk and
                remove them from Curationist?
              </p>
              <p style={{ fontSize: 11.5, color: '#f14c4c' }}>
                This action deletes the physical file(s) from your hard drive and cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="vscode-btn"
                onClick={() => setDeleteDiskConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="vscode-btn danger"
                onClick={async () => {
                  const fn = deleteDiskConfirm.onConfirm
                  setDeleteDiskConfirm(null)
                  await fn()
                }}
              >
                <Trash2 size={12} /> Delete from Disk
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Prompt Modal */}
      {promptModal && (
        <div className="modal-backdrop" onClick={() => setPromptModal(null)}>
          <form
            className="modal-window"
            style={{ width: 400 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault()
              if (!promptInput.trim()) return
              await promptModal.onConfirm(promptInput.trim())
              setPromptModal(null)
            }}
          >
            <div className="modal-header">
              <span>{promptModal.title}</span>
            </div>
            <div className="modal-body">
              <input
                className="vscode-input"
                autoFocus
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="vscode-btn"
                onClick={() => setPromptModal(null)}
              >
                Cancel
              </button>
              <button type="submit" className="vscode-btn primary">
                <Check size={12} /> Confirm
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
