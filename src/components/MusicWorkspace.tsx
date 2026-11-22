import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileJson,
  FolderPlus,
  HardDriveDownload,
  ImagePlus,
  Library,
  ListMusic,
  Music,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Star,
  Trash2,
  Upload,
  UploadCloud,
  X
} from 'lucide-react'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { DockableSection } from './DockableSection'
import { extractNormalizedDir, FolderTreeFilter } from './FolderTreeFilter'
import { ManagedStorageSelector } from './ManagedStorageSelector'
import { useColumnOrder } from '../hooks/useColumnOrder'
import { useResizableColumns } from '../hooks/useResizableColumns'
import { useVirtualTable } from '../hooks/useVirtualTable'
import type { PanelViewItem } from './TitleBar'
import type {
  AppSettings,
  Mp3DetailedMetadata,
  Mp3Track,
  MusicPlaylist,
  MusicPlaylistItem,
  MusicWorkspaceState,
  SectionLayoutState,
  SidebarSide
} from '../types'

export const MUSIC_PANELS_DEF = [
  { id: 'mp3-libraries', label: 'MP3 Logical Libraries' },
  { id: 'known-playlists', label: 'All Known Playlists' },
  { id: 'id3-inspector', label: 'ID3 Tag & Cover Art Editor' },
  { id: 'active-json', label: 'Active OBS Audio Playlist' }
]

interface MusicWorkspaceProps {
  state: MusicWorkspaceState
  settings: AppSettings
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onStateChange: (next: MusicWorkspaceState) => void
  onPlayTrack: (
    track: Mp3Track,
    queue?: Mp3Track[],
    mode?: 'play_now' | 'play_next' | 'append'
  ) => void
  playingTrackId?: string
  focusTrackRequest?: {
    trackId?: string
    title?: string
    artist?: string
    nonce: number
  } | null
  onNotify: (msg: string) => void
  layoutResetCounter: number
  onPanelsChange?: (panels: PanelViewItem[]) => void
  panelActionRef?: React.MutableRefObject<{
    togglePanel: (id: string) => void
    showAllPanels: () => void
  } | null>
}

const MUSIC_SECTIONS_STORAGE_KEY = 'curationist:music-sections:v3'
const MUSIC_SPLIT_STORAGE_KEY = 'curationist:music-split-ratio'

const DEFAULT_SECTIONS: SectionLayoutState[] = [
  { id: 'mp3-libraries', side: 'left', collapsed: false, order: 0, visible: true, size: 0.8 },
  { id: 'known-playlists', side: 'left', collapsed: false, order: 1, visible: true, size: 1.2 },
  { id: 'id3-inspector', side: 'right', collapsed: false, order: 0, visible: true, size: 1.0 },
  { id: 'active-json', side: 'right', collapsed: false, order: 1, visible: true, size: 1.0 }
]

function loadInitialMusicSections(): SectionLayoutState[] {
  try {
    const saved = localStorage.getItem(MUSIC_SECTIONS_STORAGE_KEY)
    if (!saved) return DEFAULT_SECTIONS
    const parsed = JSON.parse(saved) as SectionLayoutState[]
    const map = new Map(parsed.map((s) => [s.id, s]))
    return DEFAULT_SECTIONS.map((def) => {
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
    return DEFAULT_SECTIONS
  }
}

function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return '—'
  const total = Math.round(sec)
  const mins = Math.floor(total / 60)
  const rem = total % 60
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`
}

function formatDateAdded(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

const DEFAULT_MUSIC_LIB_COLS = [
  'play',
  'title',
  'artist',
  'album',
  'rating',
  'duration',
  'addedAt',
  'storage',
  'filePath'
] as const
type MusicLibColKey = (typeof DEFAULT_MUSIC_LIB_COLS)[number]

const DEFAULT_MUSIC_PL_COLS = [
  'position',
  'play',
  'title',
  'artist',
  'rating',
  'show_tags',
  'value',
  'dir'
] as const
type MusicPlColKey = (typeof DEFAULT_MUSIC_PL_COLS)[number]

const Mp3StarRating: React.FC<{
  rating: number
  size?: number
  onChange: (nextRating: number) => void
}> = ({ rating, size = 13, onChange }) => {
  const [hover, setHover] = useState<number | null>(null)
  const displayRating = hover !== null ? hover : rating || 0

  return (
    <div
      className="star-rating-cell"
      onMouseLeave={() => setHover(null)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= displayRating
        return (
          <button
            key={star}
            type="button"
            className={`star-cell-btn ${filled ? 'filled' : ''}`}
            onMouseEnter={() => setHover(star)}
            title={
              rating === star
                ? `Clear rating (${star}★)`
                : `Set rating to ${star} star${star > 1 ? 's' : ''} (updates Library & ID3 tags)`
            }
            onClick={(e) => {
              e.stopPropagation()
              onChange(rating === star ? 0 : star)
            }}
          >
            <Star
              size={size}
              fill={filled ? '#f59e0b' : 'transparent'}
              color={filled ? '#f59e0b' : '#52525b'}
            />
          </button>
        )
      })}
    </div>
  )
}

export const MusicWorkspace: React.FC<MusicWorkspaceProps> = ({
  state,
  settings,
  onUpdateSettings,
  onStateChange,
  onPlayTrack,
  playingTrackId,
  focusTrackRequest,
  onNotify,
  layoutResetCounter,
  onPanelsChange,
  panelActionRef
}) => {
  // Resizable columns for MP3 Library Table and Music Playlist Table
  const { widths: libColWidths, startResize: startLibColResize } = useResizableColumns(
    'curationist:music-lib-cols:v2',
    {
      play: 38,
      title: 215,
      artist: 155,
      album: 140,
      rating: 104,
      duration: 64,
      addedAt: 124,
      storage: 88,
      filePath: 300
    },
    {
      play: 34,
      title: 80,
      artist: 70,
      album: 70,
      rating: 86,
      duration: 50,
      addedAt: 95,
      storage: 70,
      filePath: 110
    }
  )

  const { widths: plColWidths, startResize: startPlColResize } = useResizableColumns(
    'curationist:music-pl-cols:v2',
    {
      position: 44,
      play: 38,
      title: 210,
      artist: 165,
      rating: 102,
      show_tags: 82,
      value: 290,
      dir: 42
    },
    {
      position: 36,
      play: 34,
      title: 80,
      artist: 70,
      rating: 86,
      show_tags: 64,
      value: 110,
      dir: 38
    }
  )

  const {
    columnOrder: libColOrder,
    dragOverCol: dragOverLibCol,
    getHeaderDragProps: getLibHeaderDragProps,
    resetColumnOrder: resetLibColOrder
  } = useColumnOrder<MusicLibColKey>('curationist:music-lib-col-order:v1', DEFAULT_MUSIC_LIB_COLS)

  const {
    columnOrder: plColOrder,
    dragOverCol: dragOverPlCol,
    getHeaderDragProps: getPlHeaderDragProps,
    resetColumnOrder: resetPlColOrder
  } = useColumnOrder<MusicPlColKey>('curationist:music-pl-col-order:v1', DEFAULT_MUSIC_PL_COLS)

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    headerLabel?: string
    entries: ContextMenuEntry[]
  } | null>(null)

  const [confirmDeleteDiskModal, setConfirmDeleteDiskModal] = useState<{
    title: string
    message: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<string | null>(null)
  const [dragOverPlRowId, setDragOverPlRowId] = useState<string | null>(null)

  const activeStorageFolder = useMemo(() => {
    const folders = settings.managedStorageFolders || []
    return (
      folders.find((f) => f.id === settings.selectedMp3StorageFolderId) ||
      folders[0] || {
        id: 'default-mp3-storage',
        label: 'Managed MP3s',
        path: settings.mp3ManagedStoragePath
      }
    )
  }, [settings.managedStorageFolders, settings.selectedMp3StorageFolderId, settings.mp3ManagedStoragePath])

  const mp3TransferVerb = settings.mp3ManagedTransferMode === 'move' ? 'Move' : 'Copy'

  // Dockable section layout state persisted in localStorage
  const [sections, setSections] = useState<SectionLayoutState[]>(loadInitialMusicSections)

  const [centerTopRatio, setCenterTopRatio] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(MUSIC_SPLIT_STORAGE_KEY))
      return saved >= 0.18 && saved <= 0.82 ? saved : 0.52
    } catch {
      return 0.52
    }
  })
  const centerSplitContainerRef = useRef<HTMLDivElement>(null)
  const leftSidebarRef = useRef<HTMLDivElement>(null)
  const rightSidebarRef = useRef<HTMLDivElement>(null)

  const updateCenterTopRatio = (next: number) => {
    const clamped = Math.max(0.18, Math.min(0.82, next))
    setCenterTopRatio(clamped)
    try {
      localStorage.setItem(MUSIC_SPLIT_STORAGE_KEY, String(clamped))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (layoutResetCounter > 0) {
      setSections(DEFAULT_SECTIONS)
      localStorage.setItem(MUSIC_SECTIONS_STORAGE_KEY, JSON.stringify(DEFAULT_SECTIONS))
      updateCenterTopRatio(0.52)
      resetLibColOrder()
      resetPlColOrder()
    }
  }, [layoutResetCounter, resetLibColOrder, resetPlColOrder])

  const updateSections = (updater: (prev: SectionLayoutState[]) => SectionLayoutState[]) => {
    setSections((prev) => {
      const next = updater(prev)
      localStorage.setItem(MUSIC_SECTIONS_STORAGE_KEY, JSON.stringify(next))
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
        MUSIC_PANELS_DEF.map((def) => {
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

  // Resizable column widths
  const [leftWidth, setLeftWidth] = useState(330)
  const [rightWidth, setRightWidth] = useState(350)

  // Selection states
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('all')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [includeSubfolders, setIncludeSubfolders] = useState<boolean>(true)
  const [librarySearch, setLibrarySearch] = useState('')
  const [ratingFilter, setRatingFilter] = useState<'all' | 'rated' | '5star' | '4plus' | '3plus'>('all')
  const [copyOnImport, setCopyOnImport] = useState(settings.copyMp3ToManagedByDefault)

  type LibrarySortCol =
    | 'title'
    | 'artist'
    | 'album'
    | 'rating'
    | 'duration'
    | 'addedAt'
    | 'storage'
    | 'filePath'
  type PlaylistSortCol = 'position' | 'title' | 'artist' | 'rating' | 'show_tags' | 'value'

  const [libSort, setLibSort] = useState<{ col: LibrarySortCol | null; dir: 'asc' | 'desc' }>({
    col: null,
    dir: 'asc'
  })
  const [plSort, setPlSort] = useState<{ col: PlaylistSortCol | null; dir: 'asc' | 'desc' }>({
    col: null,
    dir: 'asc'
  })

  const cycleLibSort = (col: LibrarySortCol) => {
    setLibSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return { col: null, dir: 'asc' }
    })
  }

  const cyclePlSort = (col: PlaylistSortCol) => {
    setPlSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return { col: null, dir: 'asc' }
    })
  }

  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([])
  const [lastClickedTrackId, setLastClickedTrackId] = useState<string | null>(null)

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [selectedPlaylistItemIds, setSelectedPlaylistItemIds] = useState<string[]>([])
  const [lastClickedItemId, setLastClickedItemId] = useState<string | null>(null)

  const selectedTrackIdSet = useMemo(() => new Set(selectedTrackIds), [selectedTrackIds])
  const selectedPlaylistItemIdSet = useMemo(
    () => new Set(selectedPlaylistItemIds),
    [selectedPlaylistItemIds]
  )

  const trackLookup = useMemo(() => {
    const byId = new Map<string, Mp3Track>()
    const byPath = new Map<string, Mp3Track>()
    for (const t of state.tracks) {
      byId.set(t.id, t)
      byPath.set(t.filePath.replace(/\\/g, '/').toLowerCase(), t)
    }
    return { byId, byPath }
  }, [state.tracks])

  const [centerTab, setCenterTab] = useState<'split' | 'playlist' | 'library' | 'json-preview'>('split')
  const [busy, setBusy] = useState(false)

  // Dialog prompts
  const [promptModal, setPromptModal] = useState<{
    title: string
    initialValue: string
    onConfirm: (val: string) => Promise<void>
  } | null>(null)
  const [promptInput, setPromptInput] = useState('')

  // Select first playlist by default
  useEffect(() => {
    if (!selectedPlaylistId && state.playlists.length > 0) {
      setSelectedPlaylistId(state.playlists[0].id)
    } else if (
      selectedPlaylistId &&
      !state.playlists.some((p) => p.id === selectedPlaylistId)
    ) {
      setSelectedPlaylistId(state.playlists[0]?.id || null)
    }
  }, [state.playlists, selectedPlaylistId])

  useEffect(() => {
    setCopyOnImport(settings.copyMp3ToManagedByDefault)
  }, [settings.copyMp3ToManagedByDefault])

  const libraryScopedTracks = useMemo(() => {
    if (selectedLibraryId === 'all') return state.tracks
    return state.tracks.filter((t) => t.libraryId === selectedLibraryId)
  }, [state.tracks, selectedLibraryId])

  const libraryFilePaths = useMemo(
    () => libraryScopedTracks.map((t) => t.filePath),
    [libraryScopedTracks]
  )

  const filteredTracks = useMemo(() => {
    const q = librarySearch.trim().toLowerCase()
    const folderLower = selectedFolder ? selectedFolder.toLowerCase() : null

    const base = libraryScopedTracks.filter((t) => {
      if (folderLower) {
        const dirLower = extractNormalizedDir(t.filePath).toLowerCase()
        if (includeSubfolders) {
          if (dirLower !== folderLower && !dirLower.startsWith(`${folderLower}/`)) {
            return false
          }
        } else if (dirLower !== folderLower) {
          return false
        }
      }
      const r = t.rating || 0
      if (ratingFilter === 'rated' && r === 0) return false
      if (ratingFilter === '5star' && r < 5) return false
      if (ratingFilter === '4plus' && r < 4) return false
      if (ratingFilter === '3plus' && r < 3) return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.filename.toLowerCase().includes(q)
      )
    })

    if (!libSort.col) return base
    const dirMul = libSort.dir === 'asc' ? 1 : -1
    const sorted = [...base]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (libSort.col) {
        case 'title':
          cmp = (a.title || a.filename).localeCompare(b.title || b.filename, undefined, {
            sensitivity: 'base'
          })
          break
        case 'artist':
          cmp = (a.artist || '').localeCompare(b.artist || '', undefined, { sensitivity: 'base' })
          break
        case 'album':
          cmp = (a.album || '').localeCompare(b.album || '', undefined, { sensitivity: 'base' })
          break
        case 'rating':
          cmp = (a.rating || 0) - (b.rating || 0)
          break
        case 'duration':
          cmp = (a.duration || 0) - (b.duration || 0)
          break
        case 'addedAt':
          cmp = (a.addedAt || '').localeCompare(b.addedAt || '')
          break
        case 'storage': {
          const rankA = !a.fileExists ? 0 : a.isManaged ? 2 : 1
          const rankB = !b.fileExists ? 0 : b.isManaged ? 2 : 1
          cmp = rankA - rankB
          break
        }
        case 'filePath':
          cmp = a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' })
          break
      }
      return cmp * dirMul
    })
    return sorted
  }, [libraryScopedTracks, selectedFolder, includeSubfolders, librarySearch, ratingFilter, libSort])

  const selectedPlaylist: MusicPlaylist | null = useMemo(
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
        case 'title':
          cmp = (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
          break
        case 'artist':
          cmp = (a.artist || '').localeCompare(b.artist || '', undefined, { sensitivity: 'base' })
          break
        case 'rating':
          cmp = (a.rating || 0) - (b.rating || 0)
          break
        case 'show_tags':
          cmp = Number(a.show_tags) - Number(b.show_tags)
          break
        case 'value':
          cmp = (a.value || '').localeCompare(b.value || '', undefined, { sensitivity: 'base' })
          break
      }
      return cmp * dirMul
    })
    return sorted
  }, [selectedPlaylist?.items, plSort])

  const libVirtual = useVirtualTable(filteredTracks.length, 26, 24)
  const plVirtual = useVirtualTable(sortedPlaylistItems.length, 26, 24)

  const pendingFocusTrackIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!focusTrackRequest) return
    const { trackId, title, artist } = focusTrackRequest
    let found: Mp3Track | undefined
    if (trackId) {
      found = state.tracks.find((t) => t.id === trackId)
    }
    if (!found && title) {
      const tNorm = title.trim().toLowerCase()
      const aNorm = (artist || '').trim().toLowerCase()
      if (aNorm) {
        found = state.tracks.find(
          (t) =>
            (t.title || t.filename).trim().toLowerCase() === tNorm &&
            (t.artist || '').trim().toLowerCase() === aNorm
        )
      }
      if (!found) {
        found = state.tracks.find(
          (t) =>
            (t.title || '').trim().toLowerCase() === tNorm ||
            t.filename.trim().toLowerCase() === tNorm ||
            t.filename.replace(/\.[^.]+$/, '').trim().toLowerCase() === tNorm
        )
      }
    }
    if (!found) {
      onNotify(`Could not locate "${title || trackId || 'track'}" in MP3 library`)
      return
    }
    if (centerTab !== 'split' && centerTab !== 'library') {
      setCenterTab('split')
    }
    setSelectedTrackIds([found.id])
    setLastClickedTrackId(found.id)
    pendingFocusTrackIdRef.current = found.id

    const alreadyVisible = filteredTracks.some((t) => t.id === found!.id)
    if (!alreadyVisible) {
      setSelectedLibraryId('all')
      setSelectedFolder(null)
      setLibrarySearch('')
      setRatingFilter('all')
    } else {
      const idx = filteredTracks.findIndex((t) => t.id === found!.id)
      const container = libVirtual.containerRef.current
      if (container && idx >= 0) {
        const targetTop = Math.max(0, idx * 26 - container.clientHeight / 2 + 13)
        container.scrollTo({ top: targetTop, behavior: 'smooth' })
        container.focus({ preventScroll: true })
        pendingFocusTrackIdRef.current = null
      }
    }
  }, [focusTrackRequest?.nonce])

  useEffect(() => {
    const targetId = pendingFocusTrackIdRef.current
    if (!targetId) return
    const idx = filteredTracks.findIndex((t) => t.id === targetId)
    const container = libVirtual.containerRef.current
    if (container && idx >= 0) {
      const targetTop = Math.max(0, idx * 26 - container.clientHeight / 2 + 13)
      container.scrollTo({ top: targetTop, behavior: 'smooth' })
      container.focus({ preventScroll: true })
      pendingFocusTrackIdRef.current = null
    }
  }, [filteredTracks, centerTab])

  const activeJsonPlaylists: MusicPlaylist[] = useMemo(
    () =>
      state.playlists
        .filter((p) => p.inActiveJson)
        .sort((a, b) => a.activeOrder - b.activeOrder),
    [state.playlists]
  )

  const activeObsPlaylist: MusicPlaylist | null = useMemo(
    () => activeJsonPlaylists[0] || state.playlists[0] || null,
    [activeJsonPlaylists, state.playlists]
  )

  // Inspector track(s)
  const inspectedTracks = useMemo(() => {
    if (selectedTrackIds.length > 0) {
      return state.tracks.filter((t) => selectedTrackIdSet.has(t.id))
    }
    if (selectedPlaylist && selectedPlaylistItemIds.length > 0) {
      const items = (selectedPlaylist.items || []).filter((it) =>
        selectedPlaylistItemIdSet.has(it.id)
      )
      const trackIds = new Set(items.map((it) => it.trackId).filter(Boolean) as string[])
      return state.tracks.filter((t) => trackIds.has(t.id))
    }
    return []
  }, [
    state.tracks,
    selectedTrackIds.length,
    selectedTrackIdSet,
    selectedPlaylist,
    selectedPlaylistItemIds.length,
    selectedPlaylistItemIdSet
  ])

  const [tagForm, setTagForm] = useState({
    artist: '',
    title: '',
    album: '',
    year: '',
    genre: '',
    trackNumber: '',
    rating: 0,
    comment: '',
    syncedLyrics: '',
    unsyncedLyrics: '',
    showTags: true,
    coverArtMime: '' as string | null,
    coverArtBase64: '' as string | null,
    coverArtDirty: false,
    writeToFile: true
  })
  const [inspectedDetail, setInspectedDetail] = useState<Mp3DetailedMetadata | null>(null)
  const [syncedLyricsModalOpen, setSyncedLyricsModalOpen] = useState(false)
  const [syncedLyricsDraft, setSyncedLyricsDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    if (inspectedTracks.length === 1) {
      const t = inspectedTracks[0]
      setTagForm({
        artist: t.artist,
        title: t.title,
        album: t.album,
        year: t.year,
        genre: t.genre,
        trackNumber: t.trackNumber,
        rating: t.rating || 0,
        comment: t.comment || '',
        syncedLyrics: t.syncedLyrics || '',
        unsyncedLyrics: t.unsyncedLyrics || '',
        showTags: t.showTags,
        coverArtMime: t.coverArtMime || '',
        coverArtBase64: t.coverArtBase64 || '',
        coverArtDirty: false,
        writeToFile: true
      })
      setInspectedDetail(null)
      if (window.curationist?.inspectMp3TrackMetadata) {
        window.curationist
          .inspectMp3TrackMetadata(t.id)
          .then((res) => {
            if (cancelled || !res.detail) return
            setInspectedDetail(res.detail)
            onStateChange(res.state)
            setTagForm((prev) => ({
              ...prev,
              album: prev.album || res.detail!.album,
              year: prev.year || res.detail!.year,
              genre: prev.genre || res.detail!.genre,
              trackNumber: prev.trackNumber || res.detail!.trackNumber,
              rating: res.detail!.rating,
              comment: res.detail!.comment,
              syncedLyrics: res.detail!.syncedLyrics,
              unsyncedLyrics: res.detail!.unsyncedLyrics
            }))
          })
          .catch(() => {})
      }
      if (t.coverArtMime && !t.coverArtBase64 && window.curationist?.getTrackCoverArt) {
        window.curationist.getTrackCoverArt(t.id).then((art) => {
          if (!cancelled && art) {
            setTagForm((prev) => ({
              ...prev,
              coverArtMime: art.mime,
              coverArtBase64: art.base64
            }))
          }
        })
      }
    } else if (inspectedTracks.length > 1) {
      setInspectedDetail(null)
      const first = inspectedTracks[0]
      const sameArtist = inspectedTracks.every((t) => t.artist === first.artist)
      const sameAlbum = inspectedTracks.every((t) => t.album === first.album)
      const sameYear = inspectedTracks.every((t) => t.year === first.year)
      const sameGenre = inspectedTracks.every((t) => t.genre === first.genre)
      const sameRating = inspectedTracks.every((t) => (t.rating || 0) === (first.rating || 0))
      setTagForm({
        artist: sameArtist ? first.artist : '',
        title: '',
        album: sameAlbum ? first.album : '',
        year: sameYear ? first.year : '',
        genre: sameGenre ? first.genre : '',
        trackNumber: '',
        rating: sameRating ? first.rating || 0 : 0,
        comment: '',
        syncedLyrics: '',
        unsyncedLyrics: '',
        showTags: first.showTags,
        coverArtMime: first.coverArtMime || '',
        coverArtBase64: first.coverArtBase64 || '',
        coverArtDirty: false,
        writeToFile: true
      })
      if (first.coverArtMime && !first.coverArtBase64 && window.curationist?.getTrackCoverArt) {
        window.curationist.getTrackCoverArt(first.id).then((art) => {
          if (!cancelled && art) {
            setTagForm((prev) => ({
              ...prev,
              coverArtMime: art.mime,
              coverArtBase64: art.base64
            }))
          }
        })
      }
    } else {
      setInspectedDetail(null)
    }
    return () => {
      cancelled = true
    }
  }, [inspectedTracks.map((t) => t.id).join(',')])

  // Windows-style Multi-select handler for MP3 Library
  const handleTrackRowClick = (e: React.MouseEvent, trackId: string) => {
    if (e.shiftKey && lastClickedTrackId) {
      const ids = filteredTracks.map((t) => t.id)
      const start = ids.indexOf(lastClickedTrackId)
      const end = ids.indexOf(trackId)
      if (start !== -1 && end !== -1) {
        const [lo, hi] = start < end ? [start, end] : [end, start]
        const range = ids.slice(lo, hi + 1)
        setSelectedTrackIds(
          e.ctrlKey || e.metaKey
            ? Array.from(new Set([...selectedTrackIds, ...range]))
            : range
        )
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedTrackIds((prev) =>
        prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId]
      )
      setLastClickedTrackId(trackId)
    } else {
      setSelectedTrackIds([trackId])
      setLastClickedTrackId(trackId)
    }
  }

  // Windows-style Multi-select handler for Playlist Items
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

  const resolvePlaylistTracks = useCallback(
    (pl: MusicPlaylist): Mp3Track[] => {
      const items = pl.items || []
      const result: Mp3Track[] = []
      for (const it of items) {
        const found =
          (it.trackId && trackLookup.byId.get(it.trackId)) ||
          trackLookup.byPath.get(it.value.replace(/\\/g, '/').toLowerCase())
        if (found) {
          result.push(found)
        } else if (it.value) {
          result.push({
            id: it.trackId || it.id,
            libraryId: 'default-mp3-lib',
            filePath: it.value,
            originalPath: it.value,
            isManaged: false,
            filename: it.value.split(/[\\/]/).pop() || it.value,
            artist: it.artist || '',
            title: it.title || it.value.split(/[\\/]/).pop() || '',
            album: '',
            year: '',
            genre: '',
            trackNumber: '',
            duration: 0,
            bitrate: 0,
            sampleRate: 0,
            rating: it.rating || 0,
            showTags: it.show_tags,
            coverArtMime: undefined,
            coverArtBase64: undefined,
            addedAt: new Date().toISOString(),
            fileExists: it.fileExists !== false
          })
        }
      }
      return result
    },
    [trackLookup]
  )

  const handlePlayPlaylist = useCallback(
    (pl: MusicPlaylist) => {
      const tracks = resolvePlaylistTracks(pl)
      if (tracks.length === 0) {
        onNotify(`Playlist "${pl.name}" has no playable tracks`)
        return
      }
      onPlayTrack(tracks[0], tracks)
      onNotify(`Playing playlist "${pl.name}" (${tracks.length} tracks)`)
    },
    [resolvePlaylistTracks, onPlayTrack, onNotify]
  )

  // Actions
  const handleImportMedia = async (mode: 'files' | 'folder') => {
    const targetLib = selectedLibraryId === 'all' ? 'default-mp3-lib' : selectedLibraryId
    const paths = await window.curationist.pickFilesOrFolders({
      title: mode === 'folder' ? 'Import Folder of MP3s' : 'Import MP3 Files',
      mode,
      filters:
        mode === 'files'
          ? [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aiff', 'aif'] }]
          : undefined
    })
    if (paths.length === 0) return
    setBusy(true)
    onNotify('Importing audio files and extracting ID3 metadata...')
    try {
      const { batch, state: nextState } = await window.curationist.importMp3Media(
        paths,
        targetLib,
        copyOnImport,
        {
          targetFolderPath: activeStorageFolder.path,
          move: settings.mp3ManagedTransferMode === 'move'
        }
      )
      onStateChange(nextState)
      onNotify(
        `Imported ${batch.imported} track(s) (${batch.duplicates} duplicate(s) skipped${
          batch.errors.length ? `, ${batch.errors.length} error(s)` : ''
        })`
      )
    } finally {
      setBusy(false)
    }
  }

  const handleCopyTracksToManaged = async (trackIdsToConsolidate = selectedTrackIds) => {
    if (trackIdsToConsolidate.length === 0) return
    setBusy(true)
    const isMove = settings.mp3ManagedTransferMode === 'move'
    try {
      const res = await window.curationist.copyMp3ToManaged(trackIdsToConsolidate, {
        targetFolderPath: activeStorageFolder.path,
        move: isMove
      })
      onStateChange(res.state)
      onNotify(
        `${isMove ? 'Moved' : 'Copied'} ${res.copied} track(s) to "${activeStorageFolder.label}" (${activeStorageFolder.path})`
      )
    } finally {
      setBusy(false)
    }
  }

  const handleCopySelectedToManaged = () => handleCopyTracksToManaged(selectedTrackIds)

  const handleRemoveTracks = async (trackIdsToRemove = selectedTrackIds) => {
    if (trackIdsToRemove.length === 0) return
    const next = await window.curationist.removeMp3Tracks(trackIdsToRemove, false)
    onStateChange(next)
    setSelectedTrackIds((prev) => prev.filter((id) => !trackIdsToRemove.includes(id)))
    onNotify(`Removed ${trackIdsToRemove.length} track(s) from logical library`)
  }

  const handleRemoveSelectedTracks = () => handleRemoveTracks(selectedTrackIds)

  const requestDeleteTracksFromDisk = (trackIdsToDelete: string[]) => {
    if (trackIdsToDelete.length === 0) return
    setConfirmDeleteDiskModal({
      title: `Delete ${trackIdsToDelete.length} Track(s) from Disk`,
      message: `Are you sure you want to permanently delete ${trackIdsToDelete.length} audio file(s) from your hard drive and remove them from all libraries and playlists? This cannot be undone.`,
      onConfirm: async () => {
        setBusy(true)
        try {
          const res = await window.curationist.deleteMp3TracksFromDisk(trackIdsToDelete)
          onStateChange(res.state)
          setSelectedTrackIds((prev) => prev.filter((id) => !trackIdsToDelete.includes(id)))
          onNotify(
            `Deleted ${res.deleted} audio file(s) from disk${
              res.errors.length ? ` (${res.errors.length} error(s))` : ''
            }`
          )
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const requestDeletePlaylistItemsFromDisk = (playlistId: string, itemIdsToDelete: string[]) => {
    if (itemIdsToDelete.length === 0) return
    setConfirmDeleteDiskModal({
      title: `Delete ${itemIdsToDelete.length} Playlist Track(s) from Disk`,
      message: `Are you sure you want to permanently delete ${itemIdsToDelete.length} audio file(s) from your hard drive and remove them from all playlists and libraries? This cannot be undone.`,
      onConfirm: async () => {
        setBusy(true)
        try {
          const res = await window.curationist.deleteMusicPlaylistItemsFromDisk(
            playlistId,
            itemIdsToDelete
          )
          onStateChange(res.state)
          setSelectedPlaylistItemIds((prev) => prev.filter((id) => !itemIdsToDelete.includes(id)))
          onNotify(
            `Deleted ${res.deleted} audio file(s) from disk${
              res.errors.length ? ` (${res.errors.length} error(s))` : ''
            }`
          )
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const handleAddTracksToTargetPlaylist = async (
    targetPlaylist: MusicPlaylist,
    trackIdsToAdd: string[],
    insertPos?: number
  ) => {
    if (trackIdsToAdd.length === 0) return
    const next = await window.curationist.addTracksToMusicPlaylist(
      targetPlaylist.id,
      trackIdsToAdd,
      insertPos
    )
    onStateChange(next)
    onNotify(`Added ${trackIdsToAdd.length} track(s) to "${targetPlaylist.name}"`)
  }

  const handleAddSelectedTracksToPlaylist = async (insertPos?: number) => {
    if (!selectedPlaylist || selectedTrackIds.length === 0) return
    await handleAddTracksToTargetPlaylist(selectedPlaylist, selectedTrackIds, insertPos)
  }

  const handleRemovePlaylistItems = async (itemIdsToRemove = selectedPlaylistItemIds) => {
    if (!selectedPlaylist || itemIdsToRemove.length === 0) return
    const next = await window.curationist.removeItemsFromMusicPlaylist(
      selectedPlaylist.id,
      itemIdsToRemove
    )
    onStateChange(next)
    setSelectedPlaylistItemIds((prev) => prev.filter((id) => !itemIdsToRemove.includes(id)))
    onNotify(`Removed ${itemIdsToRemove.length} item(s) from "${selectedPlaylist.name}"`)
  }

  const handleRemoveSelectedPlaylistItems = () =>
    handleRemovePlaylistItems(selectedPlaylistItemIds)

  const handleMovePlaylistItems = async (direction: -1 | 1, itemIdsToMove = selectedPlaylistItemIds) => {
    if (!selectedPlaylist || itemIdsToMove.length === 0) return
    const items = [...(selectedPlaylist.items || [])]
    const selSet = new Set(itemIdsToMove)
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

    const next = await window.curationist.reorderMusicPlaylistItems(
      selectedPlaylist.id,
      items.map((it) => it.id)
    )
    onStateChange(next)
  }

  const handleSetMp3Rating = useCallback(
    async (trackIds: string[], rating: number) => {
      if (trackIds.length === 0) return
      try {
        const res = await window.curationist.setMp3TracksRating(trackIds, rating)
        onStateChange(res.state)
        if (inspectedTracks.some((t) => trackIds.includes(t.id))) {
          setTagForm((prev) => ({ ...prev, rating }))
          setInspectedDetail((prev) => (prev ? { ...prev, rating } : prev))
        }
        onNotify(
          `Set rating to ${rating}★ for ${res.updated} MP3 track(s) (saved to Library & ID3 tags)`
        )
      } catch (err: any) {
        onNotify(`Failed to update MP3 rating: ${err?.message || String(err)}`)
      }
    },
    [inspectedTracks, onStateChange, onNotify]
  )

  const handleRefreshMp3Metadata = useCallback(
    async (trackIdsToRefresh?: string[]) => {
      setBusy(true)
      const targets =
        trackIdsToRefresh && trackIdsToRefresh.length > 0
          ? trackIdsToRefresh
          : selectedTrackIds.length > 0
            ? selectedTrackIds
            : filteredTracks.map((t) => t.id)
      onNotify(
        `Refreshing ID3 metadata & ratings (<RATING>/<STARS>, <SYNCED LYRICS>, duration, sample rate) for ${targets.length} track(s)...`
      )
      try {
        const res = await window.curationist.refreshMp3Metadata(targets)
        onStateChange(res.state)
        if (inspectedTracks.length === 1) {
          const insp = await window.curationist.inspectMp3TrackMetadata(inspectedTracks[0].id)
          if (insp.detail) {
            setInspectedDetail(insp.detail)
            setTagForm((prev) => ({
              ...prev,
              artist: insp.detail!.artist,
              title: insp.detail!.title,
              album: insp.detail!.album,
              year: insp.detail!.year,
              genre: insp.detail!.genre,
              trackNumber: insp.detail!.trackNumber,
              rating: insp.detail!.rating,
              comment: insp.detail!.comment,
              syncedLyrics: insp.detail!.syncedLyrics,
              unsyncedLyrics: insp.detail!.unsyncedLyrics
            }))
          }
        }
        onNotify(
          `Refreshed ID3 metadata & ratings (<RATING>/<STARS>) for ${res.refreshed} track(s)`
        )
      } catch (err: any) {
        onNotify(`Metadata refresh error: ${err?.message || String(err)}`)
      } finally {
        setBusy(false)
      }
    },
    [selectedTrackIds, filteredTracks, inspectedTracks, onStateChange, onNotify]
  )

  const resolvePlaylistTrackIds = useCallback(
    (pl: MusicPlaylist): string[] => {
      const ids: string[] = []
      for (const it of pl.items || []) {
        const matched =
          (it.trackId && trackLookup.byId.get(it.trackId)) ||
          trackLookup.byPath.get(it.value.replace(/\\/g, '/').toLowerCase())
        if (matched) ids.push(matched.id)
        else if (it.trackId) ids.push(it.trackId)
      }
      return ids
    },
    [trackLookup]
  )

  const handleTrackContextMenu = (e: React.MouseEvent, track: Mp3Track) => {
    e.preventDefault()
    e.stopPropagation()

    let targetIds = selectedTrackIds
    if (!selectedTrackIdSet.has(track.id)) {
      targetIds = [track.id]
      setSelectedTrackIds(targetIds)
      setLastClickedTrackId(track.id)
    }

    const count = targetIds.length
    const targetTracks = filteredTracks.filter((t) => targetIds.includes(t.id))
    const firstTrack = targetTracks[0] || track

    const entries: ContextMenuEntry[] = [
      {
        type: 'rating',
        id: 'rate-mp3',
        label: count > 1 ? `Rate (${count})` : 'Rate MP3 (Library & ID3)',
        currentRating: track.rating || 0,
        onSelectRating: (r: number) => {
          void handleSetMp3Rating(targetIds, r)
        }
      },
      { type: 'separator', id: 'sep-rate' },
      {
        id: 'play-now',
        label:
          count > 1
            ? `Play Now (${count} Selected)`
            : `Play Now: "${track.title || track.filename}"`,
        icon: <Play size={13} />,
        onClick: () =>
          onPlayTrack(firstTrack, count > 1 ? targetTracks : filteredTracks, 'play_now')
      },
      {
        id: 'play-next',
        label:
          count > 1
            ? `Play Next in Queue (${count} Selected)`
            : `Play Next: "${track.title || track.filename}"`,
        icon: <ArrowRight size={13} />,
        onClick: () => onPlayTrack(firstTrack, targetTracks, 'play_next')
      },
      {
        id: 'append-queue',
        label:
          count > 1
            ? `Add to Live Queue (${count} Selected)`
            : `Add to Live Queue: "${track.title || track.filename}"`,
        icon: <Plus size={13} />,
        onClick: () => onPlayTrack(firstTrack, targetTracks, 'append')
      },
      { type: 'separator', id: 'sep-queue' },
      {
        id: 'add-to-playlist',
        label: selectedPlaylist
          ? `Add to "${selectedPlaylist.name}" (${count})`
          : 'Add to Playlist (None Selected)',
        icon: <ArrowRight size={13} />,
        disabled: !selectedPlaylist,
        onClick: () => {
          if (selectedPlaylist) {
            handleAddTracksToTargetPlaylist(selectedPlaylist, targetIds)
          }
        }
      },
      {
        id: 'consolidate',
        label: `${mp3TransferVerb} to "${activeStorageFolder.label}" (${count})`,
        icon: <HardDriveDownload size={13} />,
        onClick: () => handleCopyTracksToManaged(targetIds)
      },
      {
        id: 'reveal',
        label: 'Reveal in Windows Explorer',
        icon: <ExternalLink size={13} />,
        onClick: () => window.curationist.showItemInFolder(track.filePath)
      },
      {
        id: 'refresh-meta',
        label: `Refresh ID3 & Rating Tags from File (${count})`,
        icon: <RefreshCw size={13} />,
        onClick: () => {
          void handleRefreshMp3Metadata(targetIds)
        }
      },
      { type: 'separator', id: 'sep-1' },
      {
        id: 'remove-lib',
        label: `Remove from Library (${count})`,
        icon: <Trash2 size={13} />,
        onClick: () => handleRemoveTracks(targetIds)
      },
      {
        id: 'delete-disk',
        label: `Delete from Disk Permanently (${count})...`,
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: () => requestDeleteTracksFromDisk(targetIds)
      }
    ]

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      headerLabel:
        count > 1 ? `${count} Tracks Selected` : track.title || track.filename,
      entries
    })
  }

  const handlePlaylistItemContextMenu = (e: React.MouseEvent, item: MusicPlaylistItem) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selectedPlaylist) return

    let targetItemIds = selectedPlaylistItemIds
    if (!selectedPlaylistItemIdSet.has(item.id)) {
      targetItemIds = [item.id]
      setSelectedPlaylistItemIds(targetItemIds)
      setLastClickedItemId(item.id)
    }

    const count = targetItemIds.length
    const plQueue = resolvePlaylistTracks(selectedPlaylist)
    const clickedTrack =
      (item.trackId && trackLookup.byId.get(item.trackId)) ||
      trackLookup.byPath.get(item.value.replace(/\\/g, '/').toLowerCase())
    const targetItems = (selectedPlaylist.items || []).filter((it) =>
      targetItemIds.includes(it.id)
    )
    const selectedTracks = targetItems
      .map(
        (it) =>
          (it.trackId && trackLookup.byId.get(it.trackId)) ||
          trackLookup.byPath.get(it.value.replace(/\\/g, '/').toLowerCase())
      )
      .filter(Boolean) as Mp3Track[]
    const trackIdsForConsolidate = Array.from(
      new Set(targetItems.map((it) => it.trackId).filter(Boolean) as string[])
    )

    const entries: ContextMenuEntry[] = [
      {
        type: 'rating',
        id: 'rate-pl-mp3',
        label: count > 1 ? `Rate (${count})` : 'Rate MP3 (Library & ID3)',
        currentRating: clickedTrack?.rating ?? item.rating ?? 0,
        onSelectRating: (r: number) => {
          if (trackIdsForConsolidate.length > 0) {
            void handleSetMp3Rating(trackIdsForConsolidate, r)
          }
        }
      },
      { type: 'separator', id: 'sep-pl-rate' },
      {
        id: 'play-item',
        label:
          count > 1
            ? `Play Now (${selectedTracks.length} Selected)`
            : `Play Now: "${item.title || item.value.split(/[\\/]/).pop()}"`,
        icon: <Play size={13} />,
        disabled: !clickedTrack,
        onClick: () => {
          if (clickedTrack) {
            onPlayTrack(
              clickedTrack,
              count > 1 && selectedTracks.length > 0 ? selectedTracks : plQueue,
              'play_now'
            )
          }
        }
      },
      {
        id: 'play-next-item',
        label:
          count > 1
            ? `Play Next in Queue (${selectedTracks.length} Selected)`
            : `Play Next: "${item.title || item.value.split(/[\\/]/).pop()}"`,
        icon: <ArrowRight size={13} />,
        disabled: selectedTracks.length === 0,
        onClick: () => {
          if (selectedTracks.length > 0) {
            onPlayTrack(selectedTracks[0], selectedTracks, 'play_next')
          }
        }
      },
      {
        id: 'append-queue-item',
        label:
          count > 1
            ? `Add to Live Queue (${selectedTracks.length} Selected)`
            : `Add to Live Queue: "${item.title || item.value.split(/[\\/]/).pop()}"`,
        icon: <Plus size={13} />,
        disabled: selectedTracks.length === 0,
        onClick: () => {
          if (selectedTracks.length > 0) {
            onPlayTrack(selectedTracks[0], selectedTracks, 'append')
          }
        }
      },
      {
        id: 'play-playlist',
        label: `Play Entire Playlist ("${selectedPlaylist.name}")`,
        icon: <ListMusic size={13} />,
        onClick: () => handlePlayPlaylist(selectedPlaylist)
      },
      { type: 'separator', id: 'sep-move' },
      {
        id: 'move-up',
        label: `Move Up (${count})`,
        icon: <ArrowUp size={13} />,
        onClick: () => handleMovePlaylistItems(-1, targetItemIds)
      },
      {
        id: 'move-down',
        label: `Move Down (${count})`,
        icon: <ArrowDown size={13} />,
        onClick: () => handleMovePlaylistItems(1, targetItemIds)
      },
      {
        id: 'toggle-tags',
        label: `${item.show_tags ? 'Disable' : 'Enable'} Show Tags Overlay (${count})`,
        icon: <Check size={13} />,
        onClick: async () => {
          const nextShow = !item.show_tags
          let latest = state
          for (const id of targetItemIds) {
            latest = await window.curationist.updateMusicPlaylistItemInline(id, {
              show_tags: nextShow
            })
          }
          onStateChange(latest)
        }
      },
      {
        id: 'consolidate-pl',
        label: `${mp3TransferVerb} to "${activeStorageFolder.label}" (${trackIdsForConsolidate.length})`,
        icon: <HardDriveDownload size={13} />,
        disabled: trackIdsForConsolidate.length === 0,
        onClick: () => handleCopyTracksToManaged(trackIdsForConsolidate)
      },
      {
        id: 'reveal-pl',
        label: 'Reveal in Windows Explorer',
        icon: <ExternalLink size={13} />,
        onClick: () => window.curationist.showItemInFolder(item.value)
      },
      { type: 'separator', id: 'sep-del' },
      {
        id: 'remove-pl',
        label: `Remove from Playlist (${count})`,
        icon: <Trash2 size={13} />,
        onClick: () => handleRemovePlaylistItems(targetItemIds)
      },
      {
        id: 'delete-disk-pl',
        label: `Delete from Disk Permanently (${count})...`,
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: () => requestDeletePlaylistItemsFromDisk(selectedPlaylist.id, targetItemIds)
      }
    ]

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      headerLabel:
        count > 1 ? `${count} Playlist Items Selected` : item.title || item.value,
      entries
    })
  }

  const handleSaveId3Tags = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inspectedTracks.length === 0) return
    setBusy(true)
    try {
      const res = await window.curationist.updateMp3Tags({
        trackIds: inspectedTracks.map((t) => t.id),
        artist: tagForm.artist || undefined,
        title: inspectedTracks.length === 1 ? tagForm.title : undefined,
        album: tagForm.album || undefined,
        year: tagForm.year || undefined,
        genre: tagForm.genre || undefined,
        trackNumber: inspectedTracks.length === 1 ? tagForm.trackNumber : undefined,
        rating: tagForm.rating,
        comment: inspectedTracks.length === 1 ? tagForm.comment : undefined,
        syncedLyrics: inspectedTracks.length === 1 ? tagForm.syncedLyrics : undefined,
        unsyncedLyrics: inspectedTracks.length === 1 ? tagForm.unsyncedLyrics : undefined,
        showTags: tagForm.showTags,
        coverArtBase64: tagForm.coverArtDirty ? tagForm.coverArtBase64 : undefined,
        coverArtMime: tagForm.coverArtDirty ? tagForm.coverArtMime : undefined,
        writeToFile: tagForm.writeToFile
      })
      onStateChange(res.state)
      if (inspectedTracks.length === 1) {
        const insp = await window.curationist.inspectMp3TrackMetadata(inspectedTracks[0].id)
        if (insp.detail) setInspectedDetail(insp.detail)
      }
      onNotify(
        `Updated ID3 metadata for ${res.updated} track(s)${
          res.errors.length ? ` (${res.errors[0]})` : ''
        }`
      )
    } finally {
      setBusy(false)
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

  // Stage single active playlist for OBS Curationist Audio
  const stagePlaylistInActiveJson = async (playlistId: string) => {
    const plName = state.playlists.find((p) => p.id === playlistId)?.name || 'playlist'
    const next = await window.curationist.setActiveMusicJsonPlaylists([playlistId])
    onStateChange(next)
    onNotify(`Staged "${plName}" as active OBS Audio playlist (Modified)`)
  }

  const handlePublishMusic = async () => {
    setBusy(true)
    try {
      if (activeObsPlaylist && (state.activeJsonPlaylistIds.length !== 1 || state.activeJsonPlaylistIds[0] !== activeObsPlaylist.id)) {
        await window.curationist.setActiveMusicJsonPlaylists([activeObsPlaylist.id])
      }
      const res = await window.curationist.publishMusicPlaylists()
      onStateChange(res.state)
      onNotify(
        `Published "${activeObsPlaylist?.name || 'Active Playlist'}" (${activeObsPlaylist?.itemCount || 0} tracks) to OBS Curationist Audio`
      )
    } catch (err: any) {
      onNotify(`Publish error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleImportExternalJson = async () => {
    const files = await window.curationist.pickFilesOrFolders({
      title: 'Import saved-playlists.json or playlist-export.json',
      mode: 'files',
      filters: [{ name: 'JSON Playlists', extensions: ['json'] }]
    })
    if (files.length === 0) return
    setBusy(true)
    try {
      let latest = state
      let totalPl = 0
      for (const f of files) {
        const res = await window.curationist.importMusicJsonFile(f, false)
        latest = res.state
        totalPl += res.importedPlaylists
      }
      onStateChange(latest)
      onNotify(`Imported ${totalPl} playlist(s) into Known Playlists library`)
    } finally {
      setBusy(false)
    }
  }

  const handleExportSinglePlaylist = async (pl: MusicPlaylist) => {
    const savePath = await window.curationist.pickSaveFile({
      title: `Export "${pl.name}" as JSON`,
      defaultPath: `${pl.name}.json`,
      filters: [{ name: 'JSON File', extensions: ['json'] }]
    })
    if (!savePath) return
    await window.curationist.exportSingleMusicPlaylist(pl.id, savePath)
    onNotify(`Exported "${pl.name}" to ${savePath}`)
  }

  // Renderers for each dockable section
  const renderSection = (
    sec: SectionLayoutState,
    idxInSide: number,
    totalInSide: number,
    style?: React.CSSProperties
  ) => {
    const canMoveUp = idxInSide > 0
    const canMoveDown = idxInSide < totalInSide - 1
    switch (sec.id) {
      case 'known-playlists':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="All Known Playlists"
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
                  title="New Playlist"
                  onClick={() =>
                    openPrompt('New Music Playlist Name', 'New Playlist', async (val) => {
                      const res = await window.curationist.createMusicPlaylist(val, false)
                      onStateChange(res.state)
                      setSelectedPlaylistId(res.newId)
                      onNotify(`Created playlist "${val}"`)
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
                    openPrompt('Rename Playlist', selectedPlaylist.name, async (val) => {
                      const next = await window.curationist.renameMusicPlaylist(
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
                    const res = await window.curationist.duplicateMusicPlaylist(selectedPlaylist.id)
                    onStateChange(res.state)
                    setSelectedPlaylistId(res.newId)
                  }}
                >
                  <Copy size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Import saved-playlists.json or playlist-export.json"
                  onClick={handleImportExternalJson}
                >
                  <Upload size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Export Selected Playlist (.json)"
                  disabled={!selectedPlaylist}
                  onClick={() => selectedPlaylist && handleExportSinglePlaylist(selectedPlaylist)}
                >
                  <Download size={13} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete Selected Playlist"
                  disabled={!selectedPlaylist}
                  onClick={async () => {
                    if (!selectedPlaylist) return
                    const next = await window.curationist.deleteMusicPlaylist(selectedPlaylist.id)
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
                const isDragTarget = dragOverPlaylistId === `known-${pl.id}`
                return (
                  <div
                    key={pl.id}
                    className={`list-row ${isSelected ? 'selected' : ''} ${
                      isDragTarget ? 'drag-target-playlist' : ''
                    }`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-curationist-playlist-id', pl.id)
                      const plTrackIds = resolvePlaylistTrackIds(pl)
                      if (plTrackIds.length > 0) {
                        e.dataTransfer.setData(
                          'application/x-curationist-track-ids',
                          JSON.stringify(plTrackIds)
                        )
                      }
                      e.dataTransfer.effectAllowed = 'copyMove'
                    }}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes('application/x-curationist-track-ids') ||
                        e.dataTransfer.types.includes('application/x-curationist-playlist-id')
                      ) {
                        e.preventDefault()
                        e.stopPropagation()
                        e.dataTransfer.dropEffect = 'copy'
                        setDragOverPlaylistId(`known-${pl.id}`)
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverPlaylistId === `known-${pl.id}`) {
                        setDragOverPlaylistId(null)
                      }
                    }}
                    onDrop={(e) => {
                      setDragOverPlaylistId(null)
                      const sourcePlId = e.dataTransfer.getData(
                        'application/x-curationist-playlist-id'
                      )
                      if (sourcePlId && sourcePlId !== pl.id) {
                        e.preventDefault()
                        e.stopPropagation()
                        const sourcePl = state.playlists.find((p) => p.id === sourcePlId)
                        if (sourcePl) {
                          const ids = resolvePlaylistTrackIds(sourcePl)
                          if (ids.length > 0) {
                            void handleAddTracksToTargetPlaylist(pl, ids)
                          }
                        }
                        return
                      }
                      const raw = e.dataTransfer.getData('application/x-curationist-track-ids')
                      if (raw && !sourcePlId) {
                        e.preventDefault()
                        e.stopPropagation()
                        try {
                          const ids = JSON.parse(raw) as string[]
                          if (ids.length > 0) {
                            void handleAddTracksToTargetPlaylist(pl, ids)
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
                      <ListMusic size={13} />
                      <span className="list-row-title">{pl.name}</span>
                    </div>
                    <div className="list-row-meta" onClick={(e) => e.stopPropagation()}>
                      {activeObsPlaylist?.id === pl.id && (
                        <span className="badge synced">Active OBS</span>
                      )}
                      <span>{pl.itemCount}</span>
                      <button
                        className="icon-btn"
                        title={`Play Playlist "${pl.name}"`}
                        onClick={() => handlePlayPlaylist(pl)}
                      >
                        <Play size={11} />
                      </button>
                      {activeObsPlaylist?.id !== pl.id && (
                        <button
                          className="icon-btn accent"
                          title="Stage as Active OBS Audio Playlist"
                          onClick={() => stagePlaylistInActiveJson(pl.id)}
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

      case 'mp3-libraries':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="MP3 Logical Libraries"
            count={state.tracks.length}
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
                  title="New Logical MP3 Library"
                  onClick={() =>
                    openPrompt('New MP3 Library Name', 'New MP3 Library', async (val) => {
                      const next = await window.curationist.createMp3Library(val)
                      onStateChange(next)
                    })
                  }
                >
                  <Plus size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Rename Selected Library"
                  disabled={selectedLibraryId === 'all'}
                  onClick={() => {
                    const lib = state.libraries.find((l) => l.id === selectedLibraryId)
                    if (!lib) return
                    openPrompt('Rename MP3 Library', lib.name, async (val) => {
                      const next = await window.curationist.renameMp3Library(lib.id, val)
                      onStateChange(next)
                    })
                  }}
                >
                  <Edit3 size={13} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete Selected Library"
                  disabled={selectedLibraryId === 'all' || selectedLibraryId === 'default-mp3-lib'}
                  onClick={async () => {
                    const next = await window.curationist.deleteMp3Library(selectedLibraryId)
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
              <label className="checkbox-row" title={settings.mp3ManagedStoragePath}>
                <input
                  type="checkbox"
                  checked={copyOnImport}
                  onChange={(e) => setCopyOnImport(e.target.checked)}
                />
                <span>Copy to Managed Storage on Import</span>
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="vscode-btn"
                  disabled={busy}
                  onClick={() => handleImportMedia('files')}
                  title="Import Audio Files"
                >
                  <Plus size={12} /> Files
                </button>
                <button
                  className="vscode-btn primary"
                  disabled={busy}
                  onClick={() => handleImportMedia('folder')}
                  title="Import Folder of MP3s Recursively"
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
                  <span className="list-row-title">All Known MP3s (Aggregate)</span>
                </div>
                <div className="list-row-meta">{state.tracks.length}</div>
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
                    <Music size={13} />
                    <span className="list-row-title">{lib.name}</span>
                  </div>
                  <div className="list-row-meta">{lib.trackCount}</div>
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

      case 'active-json':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="Active OBS Audio Playlist"
            count={activeObsPlaylist?.itemCount || 0}
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
                  title="New Playlist (Create Locally & Stage as Active OBS Audio Playlist)"
                  onClick={() =>
                    openPrompt(
                      'New Staged Music Playlist Name',
                      'New Playlist',
                      async (val) => {
                        const res = await window.curationist.createMusicPlaylist(val, false)
                        const next = await window.curationist.setActiveMusicJsonPlaylists([
                          res.newId
                        ])
                        onStateChange(next)
                        setSelectedPlaylistId(res.newId)
                        onNotify(`Created and staged playlist "${val}" as active OBS Audio playlist`)
                      }
                    )
                  }
                >
                  <Plus size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="View Raw JSON Draft"
                  onClick={() =>
                    setCenterTab(centerTab === 'json-preview' ? 'split' : 'json-preview')
                  }
                >
                  <FileJson size={13} />
                </button>
                {state.isModified && (
                  <button
                    className="icon-btn danger"
                    title="Discard Draft & Reload from Disk"
                    onClick={async () => {
                      const next = await window.curationist.discardMusicDraft()
                      onStateChange(next)
                      onNotify('Discarded draft and reloaded saved-playlists.json from disk')
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
                {activeObsPlaylist
                  ? `Staged: ${activeObsPlaylist.name}`
                  : 'Drag a music playlist here'}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {activeObsPlaylist && (
                  <button
                    className="vscode-btn"
                    disabled={(activeObsPlaylist.items || []).length === 0}
                    onClick={() => handlePlayPlaylist(activeObsPlaylist)}
                    title={`Play staged playlist "${activeObsPlaylist.name}"`}
                  >
                    <Play size={11} /> Play
                  </button>
                )}
                <button
                  className="vscode-btn"
                  disabled={busy}
                  onClick={() =>
                    openPrompt(
                      'New Staged Music Playlist Name',
                      'New Playlist',
                      async (val) => {
                        const res = await window.curationist.createMusicPlaylist(val, false)
                        const next = await window.curationist.setActiveMusicJsonPlaylists([
                          res.newId
                        ])
                        onStateChange(next)
                        setSelectedPlaylistId(res.newId)
                        onNotify(`Created and staged playlist "${val}" as active OBS Audio playlist`)
                      }
                    )
                  }
                  title="Create a new local playlist and stage it as the active OBS Audio playlist"
                >
                  <Plus size={12} /> New Playlist
                </button>
                <button
                  className={`vscode-btn ${state.isModified ? 'publish' : 'primary'}`}
                  disabled={busy}
                  onClick={handlePublishMusic}
                  title={`Publish "${activeObsPlaylist?.name || 'Active Playlist'}" to OBS Curationist Audio`}
                >
                  <UploadCloud size={12} /> Publish
                </button>
              </div>
            </div>

            <div
              className="list-scroll"
              onDragOver={(e) => {
                if (
                  e.dataTransfer.types.includes('application/x-curationist-playlist-id') ||
                  e.dataTransfer.types.includes('application/x-curationist-track-ids')
                ) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={(e) => {
                const plId = e.dataTransfer.getData('application/x-curationist-playlist-id')
                if (plId) {
                  void stagePlaylistInActiveJson(plId)
                  setSelectedPlaylistId(plId)
                  return
                }
                const rawTracks = e.dataTransfer.getData('application/x-curationist-track-ids')
                if (rawTracks && activeObsPlaylist) {
                  try {
                    const ids = JSON.parse(rawTracks) as string[]
                    if (ids.length > 0) {
                      void handleAddTracksToTargetPlaylist(activeObsPlaylist, ids)
                    }
                  } catch {
                    // ignore
                  }
                }
              }}
            >
              <div style={{ padding: '8px 10px', borderBottom: '1px solid #2b2b2b', fontSize: 11 }}>
                <div style={{ color: '#8b949e' }}>
                  <strong>Curationist Audio Target:</strong>{' '}
                  {activeObsPlaylist
                    ? `${activeObsPlaylist.name} (${activeObsPlaylist.itemCount} tracks)`
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
                  title={state.targetJsonPath}
                >
                  {state.targetJsonPath}
                </div>
              </div>

              {!activeObsPlaylist || (activeObsPlaylist.items || []).length === 0 ? (
                <div className="empty-placeholder">
                  <span>Drag a playlist or tracks here to stage for OBS Curationist Audio</span>
                </div>
              ) : (
                (activeObsPlaylist.items || []).map((item, idx) => {
                  const fullPlQueue = resolvePlaylistTracks(activeObsPlaylist)
                  const matchedTrack =
                    (item.trackId && trackLookup.byId.get(item.trackId)) ||
                    trackLookup.byPath.get(item.value.replace(/\\/g, '/').toLowerCase())
                  return (
                    <div
                      key={item.id}
                      className="list-row"
                      onClick={() => {
                        setSelectedPlaylistId(activeObsPlaylist.id)
                        setSelectedPlaylistItemIds([item.id])
                      }}
                      onDoubleClick={() => {
                        if (matchedTrack) onPlayTrack(matchedTrack, fullPlQueue, 'play_now')
                      }}
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
                        <span className="list-row-title">
                          {item.title || item.value.split(/[\\/]/).pop()}
                          {item.artist ? ` — ${item.artist}` : ''}
                        </span>
                      </div>
                      <div className="list-row-meta" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-btn accent"
                          disabled={!matchedTrack}
                          onClick={() => {
                            if (matchedTrack) onPlayTrack(matchedTrack, fullPlQueue, 'play_now')
                          }}
                          title="Play Track Now"
                        >
                          <Play size={11} />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </DockableSection>
        )

      case 'id3-inspector': {
        const singleTrack = inspectedTracks.length === 1 ? inspectedTracks[0] : null
        const effDuration = inspectedDetail?.duration ?? singleTrack?.duration ?? 0
        const effSampleRate = inspectedDetail?.sampleRate ?? singleTrack?.sampleRate ?? 0
        const effBitrate = inspectedDetail?.bitrate ?? singleTrack?.bitrate ?? 0
        const effChannels = inspectedDetail?.channels ?? singleTrack?.channels ?? 2
        const effCodec = inspectedDetail?.codec || singleTrack?.codec || 'MP3'
        const effFileSize = inspectedDetail?.fileSize ?? singleTrack?.fileSize ?? 0
        const effAddedAt = inspectedDetail?.addedAt || singleTrack?.addedAt || ''
        const syncedText = tagForm.syncedLyrics || ''
        const firstSyncedLine =
          syncedText
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l.length > 0) ||
          (singleTrack?.hasSyncedLyrics ? singleTrack.syncedLyricsFirstLine : '')
        const hasSynced = Boolean(firstSyncedLine)
        const syncedLineCount = syncedText
          ? syncedText.split(/\r?\n/).filter((l) => l.trim().length > 0).length
          : hasSynced
            ? 1
            : 0

        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="ID3 Tag & Metadata Inspector"
            count={inspectedTracks.length}
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
            {inspectedTracks.length === 0 ? (
              <div className="empty-placeholder">
                <span>Select one or more MP3 tracks to inspect or edit ID3 tags, ratings, lyrics &amp; cover art</span>
              </div>
            ) : (
              <form className="inspector-pane" onSubmit={handleSaveId3Tags}>
                <div className="cover-art-box">
                  <div className="cover-art-preview">
                    {tagForm.coverArtBase64 ? (
                      <img
                        src={`data:${tagForm.coverArtMime || 'image/jpeg'};base64,${tagForm.coverArtBase64}`}
                        alt="Album Art"
                      />
                    ) : (
                      <Music size={24} color="#6e7681" />
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        color: '#ffffff',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={
                        singleTrack
                          ? singleTrack.filename
                          : `${inspectedTracks.length} Tracks Selected (Batch Mode)`
                      }
                    >
                      {singleTrack
                        ? singleTrack.filename
                        : `${inspectedTracks.length} Tracks Selected (Batch Mode)`}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="vscode-btn"
                        onClick={async () => {
                          const picked = await window.curationist.pickCoverArtImage()
                          if (picked) {
                            setTagForm((prev) => ({
                              ...prev,
                              coverArtMime: picked.mime,
                              coverArtBase64: picked.base64,
                              coverArtDirty: true
                            }))
                          }
                        }}
                      >
                        <ImagePlus size={12} /> Choose Art
                      </button>
                      {tagForm.coverArtBase64 && (
                        <button
                          type="button"
                          className="vscode-btn"
                          onClick={() =>
                            setTagForm((prev) => ({
                              ...prev,
                              coverArtBase64: '',
                              coverArtMime: '',
                              coverArtDirty: true
                            }))
                          }
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        className="vscode-btn"
                        disabled={busy}
                        onClick={() => handleRefreshMp3Metadata(inspectedTracks.map((t) => t.id))}
                        title="Re-scan ID3 tags (<RATING>, <STARS>, <SYNCED LYRICS>, duration, sample rate) from disk"
                      >
                        <RefreshCw size={11} /> Re-read ID3
                      </button>
                    </div>
                  </div>
                </div>

                {/* Technical Audio & File Metadata Summary */}
                {singleTrack && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gap: '5px 8px',
                      padding: '7px 9px',
                      background: 'rgba(255, 255, 255, 0.025)',
                      border: '1px solid #2b2b2b',
                      borderRadius: 4,
                      fontSize: 10.5
                    }}
                  >
                    <div>
                      <div style={{ color: '#6e7681', fontSize: 9.5, textTransform: 'uppercase' }}>Duration</div>
                      <div style={{ color: '#d4d4d4', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {formatDuration(effDuration)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#6e7681', fontSize: 9.5, textTransform: 'uppercase' }}>Sample Rate</div>
                      <div style={{ color: '#d4d4d4', fontFamily: 'var(--font-mono)' }}>
                        {effSampleRate ? `${(effSampleRate / 1000).toFixed(1)} kHz` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#6e7681', fontSize: 9.5, textTransform: 'uppercase' }}>Bitrate</div>
                      <div style={{ color: '#d4d4d4', fontFamily: 'var(--font-mono)' }}>
                        {effBitrate ? `${Math.round(effBitrate / 1000)} kbps` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#6e7681', fontSize: 9.5, textTransform: 'uppercase' }}>Codec / Ch</div>
                      <div
                        style={{
                          color: '#d4d4d4',
                          fontFamily: 'var(--font-mono)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={`${effCodec} (${effChannels === 1 ? 'Mono' : effChannels === 2 ? 'Stereo' : `${effChannels}ch`})`}
                      >
                        {effChannels === 1 ? 'Mono' : effChannels === 2 ? 'Stereo' : `${effChannels}ch`} •{' '}
                        {effCodec.replace(/^MPEG\s+/i, '')}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#6e7681', fontSize: 9.5, textTransform: 'uppercase' }}>File Size</div>
                      <div style={{ color: '#d4d4d4', fontFamily: 'var(--font-mono)' }}>
                        {formatBytes(effFileSize)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#6e7681', fontSize: 9.5, textTransform: 'uppercase' }}>Date Added</div>
                      <div
                        style={{ color: '#d4d4d4', fontFamily: 'var(--font-mono)' }}
                        title={effAddedAt}
                      >
                        {formatDateAdded(effAddedAt)}
                      </div>
                    </div>
                    {inspectedDetail && (inspectedDetail.rawRatingTag || inspectedDetail.rawStarsTag) && (
                      <div
                        style={{
                          gridColumn: '1 / -1',
                          borderTop: '1px solid #252526',
                          paddingTop: 4,
                          marginTop: 2,
                          display: 'flex',
                          justifyContent: 'space-between',
                          color: '#8b949e',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10
                        }}
                      >
                        <span>ID3 &lt;RATING&gt;: {inspectedDetail.rawRatingTag ?? '—'}</span>
                        <span>ID3 &lt;STARS&gt;: {inspectedDetail.rawStarsTag ?? '—'}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="form-grid">
                  <div className="form-field full">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>
                        Rating (max of &lt;RATING&gt; &amp; &lt;STARS&gt;)
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Mp3StarRating
                          rating={tagForm.rating ?? 0}
                          size={14}
                          onChange={(r) => setTagForm({ ...tagForm, rating: r })}
                        />
                        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: '#9ca3af', minWidth: 34 }}>
                          {tagForm.rating === null ? 'Mixed' : `${tagForm.rating}/5`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="form-field full">
                    <label className="form-label">Artist</label>
                    <input
                      className="vscode-input"
                      value={tagForm.artist}
                      placeholder={inspectedTracks.length > 1 ? '(Keep individual artists)' : ''}
                      onChange={(e) => setTagForm({ ...tagForm, artist: e.target.value })}
                    />
                  </div>

                  {inspectedTracks.length === 1 && (
                    <div className="form-field full">
                      <label className="form-label">Title</label>
                      <input
                        className="vscode-input"
                        value={tagForm.title}
                        onChange={(e) => setTagForm({ ...tagForm, title: e.target.value })}
                      />
                    </div>
                  )}

                  <div className="form-field full">
                    <label className="form-label">Album</label>
                    <input
                      className="vscode-input"
                      value={tagForm.album}
                      placeholder={inspectedTracks.length > 1 ? '(Keep individual albums)' : ''}
                      onChange={(e) => setTagForm({ ...tagForm, album: e.target.value })}
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label">Year</label>
                    <input
                      className="vscode-input"
                      value={tagForm.year}
                      onChange={(e) => setTagForm({ ...tagForm, year: e.target.value })}
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label">Genre</label>
                    <input
                      className="vscode-input"
                      value={tagForm.genre}
                      onChange={(e) => setTagForm({ ...tagForm, genre: e.target.value })}
                    />
                  </div>

                  {inspectedTracks.length === 1 && (
                    <>
                      <div className="form-field">
                        <label className="form-label">Track #</label>
                        <input
                          className="vscode-input"
                          value={tagForm.trackNumber}
                          placeholder="e.g. 1 or 1/12"
                          onChange={(e) => setTagForm({ ...tagForm, trackNumber: e.target.value })}
                        />
                      </div>

                      <div className="form-field">
                        <label className="form-label">Comment</label>
                        <input
                          className="vscode-input"
                          value={tagForm.comment}
                          onChange={(e) => setTagForm({ ...tagForm, comment: e.target.value })}
                        />
                      </div>

                      {/* <SYNCED LYRICS> status & first-line preview (double-click to open multi-line modal) */}
                      <div className="form-field full">
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 3
                          }}
                        >
                          <label className="form-label" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>&lt;SYNCED LYRICS&gt;</span>
                            {hasSynced ? (
                              <span
                                className="badge synced"
                                style={{ fontSize: 9.5, padding: '1px 5px' }}
                                title={`Synced lyrics present (${syncedLineCount} lines)`}
                              >
                                PRESENT {syncedLineCount > 1 ? `(${syncedLineCount}L)` : ''}
                              </span>
                            ) : (
                              <span
                                className="badge"
                                style={{ fontSize: 9.5, padding: '1px 5px', opacity: 0.7 }}
                              >
                                NONE
                              </span>
                            )}
                          </label>
                          <button
                            type="button"
                            className="vscode-btn"
                            style={{ padding: '1px 6px', fontSize: 10.5 }}
                            onClick={() => setSyncedLyricsModalOpen(true)}
                            title="Open multi-line <SYNCED LYRICS> editor modal"
                          >
                            Edit Lyrics...
                          </button>
                        </div>
                        <div
                          onDoubleClick={() => setSyncedLyricsModalOpen(true)}
                          title="Double-click to edit multi-line <SYNCED LYRICS> in modal window"
                          style={{
                            padding: '6px 8px',
                            background: '#18181b',
                            border: `1px solid ${hasSynced ? 'rgba(63, 185, 80, 0.35)' : '#323233'}`,
                            borderRadius: 4,
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: hasSynced ? '#d4d4d4' : '#6e7681',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            userSelect: 'none'
                          }}
                        >
                          {hasSynced
                            ? firstSyncedLine
                            : '(No <SYNCED LYRICS> tag — double-click to add)'}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={tagForm.showTags}
                    onChange={(e) => setTagForm({ ...tagForm, showTags: e.target.checked })}
                  />
                  <span>Show Artist/Title Overlay in OBS Audio (show_tags)</span>
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={tagForm.writeToFile}
                    onChange={(e) => setTagForm({ ...tagForm, writeToFile: e.target.checked })}
                  />
                  <span>Write ID3v2 Tags, Rating, Synced Lyrics &amp; Art directly to MP3 file(s)</span>
                </label>

                <button type="submit" className="vscode-btn primary" disabled={busy}>
                  <Save size={12} /> Save Metadata ({inspectedTracks.length})
                </button>
              </form>
            )}
          </DockableSection>
        )
      }

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

  // Drag splitter logic
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
              <span>Split View: MP3 Library &amp; Active Playlist</span>
            </div>
            <div
              className={`editor-tab ${centerTab === 'library' ? 'active' : ''}`}
              onClick={() => setCenterTab('library')}
            >
              <span>MP3 Library Table ({filteredTracks.length})</span>
            </div>
            <div
              className={`editor-tab ${centerTab === 'playlist' ? 'active' : ''}`}
              onClick={() => setCenterTab('playlist')}
            >
              <span>
                Playlist: {selectedPlaylist ? selectedPlaylist.name : '(None)'} (
                {selectedPlaylist?.items?.length || 0})
              </span>
            </div>
            <div
              className={`editor-tab ${centerTab === 'json-preview' ? 'active' : ''}`}
              onClick={() => setCenterTab('json-preview')}
            >
              <span>saved-playlists.json Draft Preview</span>
              {state.isModified && <span className="badge modified">Draft</span>}
            </div>
          </div>

          <ManagedStorageSelector
            domain="music"
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            onNotify={onNotify}
          />
        </div>

        {centerTab === 'json-preview' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="editor-toolbar">
              <div className="editor-toolbar-group">
                <strong>Target File:</strong>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#9cdcfe' }}>
                  {state.targetJsonPath}
                </span>
              </div>
              <div className="editor-toolbar-group">
                <button className="vscode-btn publish" onClick={handlePublishMusic}>
                  <UploadCloud size={13} /> Publish to saved-playlists.json
                </button>
              </div>
            </div>
            <pre
              className="shader-code-view"
              style={{ maxHeight: 'none', flex: 1, border: 'none' }}
            >
              {JSON.stringify(
                {
                  playlists: activeJsonPlaylists.map((p) => ({
                    name: p.name,
                    items: (p.items || []).map((it) => ({
                      value: it.value,
                      artist: it.artist,
                      title: it.title,
                      show_tags: it.show_tags
                    }))
                  }))
                },
                null,
                4
              )}
            </pre>
          </div>
        ) : (
          <div
            ref={centerSplitContainerRef}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
          >
            {/* MP3 LIBRARY PANE (shown in 'split' or 'library') */}
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
                  <div className="editor-toolbar-group" style={{ flex: 1, maxWidth: 560 }}>
                    <input
                      className="vscode-input"
                      placeholder="Filter MP3 library by artist, title, album, or filename..."
                      value={librarySearch}
                      onChange={(e) => setLibrarySearch(e.target.value)}
                    />
                    <select
                      className="vscode-select"
                      style={{ width: 132 }}
                      value={ratingFilter}
                      onChange={(e) => setRatingFilter(e.target.value as any)}
                      title="Filter MP3 library by star rating (derived from ID3 <RATING> / <STARS>)"
                    >
                      <option value="all">All MP3s</option>
                      <option value="rated">Rated Only (1+ ★)</option>
                      <option value="5">★★★★★ (5 Stars)</option>
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
                      disabled={busy}
                      onClick={() => handleImportMedia('files')}
                      title="Add MP3 files to library"
                    >
                      <Plus size={12} /> Add Files
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={busy}
                      onClick={() => handleImportMedia('folder')}
                      title="Add folder of MP3s to library"
                    >
                      <FolderPlus size={12} /> Add Folder
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={busy}
                      onClick={() =>
                        handleRefreshMp3Metadata(
                          selectedTrackIds.length > 0 ? selectedTrackIds : undefined
                        )
                      }
                      title={
                        selectedTrackIds.length > 0
                          ? `Re-scan ID3 tags (<RATING>, <STARS>, <SYNCED LYRICS>, etc.) for ${selectedTrackIds.length} selected MP3(s)`
                          : 'Re-scan ID3 tags (<RATING>, <STARS>, <SYNCED LYRICS>, etc.) for all MP3 tracks in library'
                      }
                    >
                      <RefreshCw size={12} /> Refresh ID3
                    </button>
                    <button
                      className="vscode-btn primary"
                      disabled={!selectedPlaylist || selectedTrackIds.length === 0}
                      onClick={() => handleAddSelectedTracksToPlaylist()}
                      title={`Add selected MP3s to "${selectedPlaylist?.name || 'Playlist'}"`}
                    >
                      <ArrowRight size={12} /> Add to Playlist ({selectedTrackIds.length})
                    </button>
                    <button
                      className="vscode-btn"
                      disabled={selectedTrackIds.length === 0}
                      onClick={handleRemoveSelectedTracks}
                      title="Remove selected MP3s from logical library"
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                    <button
                      className={`vscode-btn ${settings.mp3ManagedTransferMode === 'move' ? 'publish' : ''}`}
                      disabled={selectedTrackIds.length === 0 || busy}
                      onClick={handleCopySelectedToManaged}
                      title={`${mp3TransferVerb} selected MP3s to "${activeStorageFolder.label}" (${activeStorageFolder.path})`}
                    >
                      <HardDriveDownload size={12} /> {mp3TransferVerb} to Managed ({selectedTrackIds.length})
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
                      setSelectedTrackIds(filteredTracks.map((t) => t.id))
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
                              >
                                Play
                                <div
                                  className="col-resize-handle"
                                  onMouseDown={(e) => startLibColResize('play', e)}
                                />
                              </th>
                            )
                          }
                          const labelMap: Record<Exclude<MusicLibColKey, 'play'>, string> = {
                            title: 'Title',
                            artist: 'Artist',
                            album: 'Album',
                            rating: 'Rating',
                            duration: 'Time',
                            addedAt: 'Date Added',
                            storage: 'Storage',
                            filePath: 'File Path'
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
                      {filteredTracks
                        .slice(libVirtual.startIndex, libVirtual.endIndex)
                        .map((track) => {
                          const isSel = selectedTrackIdSet.has(track.id)
                          const isPlaying = playingTrackId === track.id
                          return (
                            <tr
                              key={track.id}
                              className={`${isSel ? 'selected' : ''} ${isPlaying ? 'playing' : ''}`}
                              draggable
                              onDragStart={(e) => {
                                const dragIds = isSel ? selectedTrackIds : [track.id]
                                e.dataTransfer.setData(
                                  'application/x-curationist-track-ids',
                                  JSON.stringify(dragIds)
                                )
                                e.dataTransfer.effectAllowed = 'copy'
                              }}
                              onClick={(e) => handleTrackRowClick(e, track.id)}
                              onContextMenu={(e) => handleTrackContextMenu(e, track)}
                              onDoubleClick={() => onPlayTrack(track, filteredTracks)}
                            >
                              {libColOrder.map((col) => {
                                switch (col) {
                                  case 'play':
                                    return (
                                      <td key={col} style={{ textAlign: 'center' }}>
                                        <button
                                          className="icon-btn"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onPlayTrack(track, filteredTracks)
                                          }}
                                          title="Play Track Preview"
                                        >
                                          <Play size={11} />
                                        </button>
                                      </td>
                                    )
                                  case 'title':
                                    return (
                                      <td key={col} title={track.title || track.filename}>
                                        <strong>{track.title || track.filename}</strong>
                                      </td>
                                    )
                                  case 'artist':
                                    return (
                                      <td key={col} title={track.artist}>
                                        {track.artist || '—'}
                                      </td>
                                    )
                                  case 'album':
                                    return (
                                      <td key={col} title={track.album}>
                                        {track.album || '—'}
                                      </td>
                                    )
                                  case 'rating':
                                    return (
                                      <td key={col} onClick={(e) => e.stopPropagation()}>
                                        <Mp3StarRating
                                          rating={track.rating || 0}
                                          onChange={(newRating) =>
                                            handleSetMp3Rating(
                                              isSel && selectedTrackIds.length > 1
                                                ? selectedTrackIds
                                                : [track.id],
                                              newRating
                                            )
                                          }
                                        />
                                      </td>
                                    )
                                  case 'duration':
                                    return (
                                      <td key={col} style={{ fontFamily: 'var(--font-mono)' }}>
                                        {formatDuration(track.duration)}
                                      </td>
                                    )
                                  case 'addedAt':
                                    return (
                                      <td
                                        key={col}
                                        style={{
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: 11,
                                          color: '#8b949e'
                                        }}
                                        title={track.addedAt}
                                      >
                                        {formatDateAdded(track.addedAt)}
                                      </td>
                                    )
                                  case 'storage':
                                    return (
                                      <td key={col}>
                                        {!track.fileExists ? (
                                          <span className="badge missing">Missing</span>
                                        ) : track.isManaged ? (
                                          <span className="badge managed">Managed</span>
                                        ) : (
                                          <span className="badge">External</span>
                                        )}
                                      </td>
                                    )
                                  case 'filePath':
                                    return (
                                      <td
                                        key={col}
                                        style={{
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: 11,
                                          color: '#8b949e'
                                        }}
                                        title={track.filePath}
                                      >
                                        {track.filePath}
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

            {/* SELECTED PLAYLIST EDITOR PANE (shown in 'split' or 'playlist') */}
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
                    e.dataTransfer.types.includes('application/x-curationist-track-ids') ||
                    e.dataTransfer.types.includes('application/x-curationist-playlist-id')
                  ) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }
                }}
                onDrop={(e) => {
                  if (!selectedPlaylist) return
                  const rawPlId = e.dataTransfer.getData('application/x-curationist-playlist-id')
                  if (rawPlId && rawPlId !== selectedPlaylist.id) {
                    const sourcePl = state.playlists.find((p) => p.id === rawPlId)
                    if (sourcePl) {
                      const trackIds = resolvePlaylistTracks(sourcePl).map((t) => t.id)
                      if (trackIds.length > 0) {
                        handleAddTracksToTargetPlaylist(selectedPlaylist, trackIds)
                      }
                    }
                    return
                  }
                  const raw = e.dataTransfer.getData('application/x-curationist-track-ids')
                  if (raw) {
                    try {
                      const ids = JSON.parse(raw) as string[]
                      if (ids.length > 0) {
                        handleAddTracksToTargetPlaylist(selectedPlaylist, ids)
                      }
                    } catch {
                      // ignore
                    }
                  }
                }}
              >
                <div className="editor-toolbar playlist-header-toolbar">
                  <div className="playlist-toolbar-left">
                    <ListMusic size={15} color="#4d85bd" />
                    <span className="playlist-header-title">
                      {selectedPlaylist ? selectedPlaylist.name : 'Select a Playlist'}
                    </span>
                    {selectedPlaylist && (
                      <span
                        className="playlist-count-circle"
                        title={`${selectedPlaylist.items?.length || 0} tracks in playlist`}
                      >
                        {selectedPlaylist.items?.length || 0}
                      </span>
                    )}
                  </div>

                  <div className="playlist-toolbar-center">
                    {selectedPlaylist && activeObsPlaylist?.id === selectedPlaylist.id ? (
                      <span className="badge synced">Staged for Active OBS Audio</span>
                    ) : (
                      selectedPlaylist && (
                        <button
                          className="vscode-btn"
                          onClick={() => stagePlaylistInActiveJson(selectedPlaylist.id)}
                        >
                          <ArrowRight size={11} /> Stage for OBS Audio
                        </button>
                      )
                    )}
                  </div>

                  <div className="playlist-toolbar-right">
                    <button
                      className="vscode-btn"
                      disabled={!selectedPlaylist || selectedTrackIds.length === 0}
                      onClick={() => handleAddSelectedTracksToPlaylist()}
                      title="Append selected library tracks to this playlist"
                    >
                      <Plus size={12} /> Add Selected Library Tracks ({selectedTrackIds.length})
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
                      title="Remove selected items from this playlist"
                    >
                      <Trash2 size={12} /> Remove ({selectedPlaylistItemIds.length})
                    </button>
                    {selectedPlaylist && (
                      <button
                        className="vscode-btn primary"
                        disabled={!selectedPlaylist.items || selectedPlaylist.items.length === 0}
                        onClick={() => handlePlayPlaylist(selectedPlaylist)}
                        title={`Play all tracks in "${selectedPlaylist.name}"`}
                      >
                        <Play size={11} /> Play Playlist
                      </button>
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
                      <span>Select or create a playlist to view and edit its tracks</span>
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
                                  {col === 'play' ? 'Play' : 'Dir'}
                                  <div
                                    className="col-resize-handle"
                                    onMouseDown={(e) => startPlColResize(col, e)}
                                  />
                                </th>
                              )
                            }
                            const labelMap: Record<Exclude<MusicPlColKey, 'play' | 'dir'>, string> = {
                              position: '#',
                              title: 'Title',
                              artist: 'Artist',
                              rating: 'Rating',
                              show_tags: 'Show Tags',
                              value: 'File Path (value)'
                            }
                            return (
                              <th
                                key={col}
                                {...dragProps}
                                className={`sortable-th ${dragProps.className}`.trim()}
                                style={{ width: plColWidths[col], cursor: 'grab' }}
                                onClick={() => cyclePlSort(col)}
                                title="Click to sort • Drag column header to reorder"
                              >
                                <div className="th-sort-content">
                                  <span>{labelMap[col]}</span>
                                  {plSort.col === col && (
                                    <span className="sort-indicator">
                                      {plSort.dir === 'asc' ? '▲' : '▼'}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="col-resize-handle"
                                  onMouseDown={(e) => startPlColResize(col, e)}
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
                            const isDragRow = dragOverPlRowId === item.id
                            const matchedTrack =
                              (item.trackId && trackLookup.byId.get(item.trackId)) ||
                              trackLookup.byPath.get(item.value.replace(/\\/g, '/').toLowerCase())

                            return (
                              <tr
                                key={item.id}
                                className={`${isSel ? 'selected' : ''} ${
                                  isDragRow ? 'drag-over-row' : ''
                                }`}
                                draggable
                                onDragStart={(e) => {
                                  const dragIds = isSel ? selectedPlaylistItemIds : [item.id]
                                  e.dataTransfer.setData(
                                    'application/x-curationist-playlist-item-ids',
                                    JSON.stringify(dragIds)
                                  )
                                  // Also attach resolved track IDs so items can be dragged from this playlist into any other playlist in 'All Known Playlists'!
                                  const dragIdSet = new Set(dragIds)
                                  const resolvedTrackIds: string[] = []
                                  for (const it of selectedPlaylist.items || []) {
                                    if (!dragIdSet.has(it.id)) continue
                                    const tr =
                                      (it.trackId && trackLookup.byId.get(it.trackId)) ||
                                      trackLookup.byPath.get(
                                        it.value.replace(/\\/g, '/').toLowerCase()
                                      )
                                    if (tr) resolvedTrackIds.push(tr.id)
                                  }
                                  if (resolvedTrackIds.length > 0) {
                                    e.dataTransfer.setData(
                                      'application/x-curationist-track-ids',
                                      JSON.stringify(resolvedTrackIds)
                                    )
                                  }
                                  e.dataTransfer.effectAllowed = 'copyMove'
                                }}
                                onDragOver={(e) => {
                                  if (
                                    e.dataTransfer.types.includes(
                                      'application/x-curationist-playlist-item-ids'
                                    ) ||
                                    e.dataTransfer.types.includes(
                                      'application/x-curationist-track-ids'
                                    ) ||
                                    e.dataTransfer.types.includes(
                                      'application/x-curationist-playlist-id'
                                    )
                                  ) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    setDragOverPlRowId(item.id)
                                  }
                                }}
                                onDragLeave={() => {
                                  if (dragOverPlRowId === item.id) setDragOverPlRowId(null)
                                }}
                                onDrop={async (e) => {
                                  setDragOverPlRowId(null)
                                  const rawMove = e.dataTransfer.getData(
                                    'application/x-curationist-playlist-item-ids'
                                  )
                                  if (rawMove && selectedPlaylist) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    try {
                                      const movingIds = JSON.parse(rawMove) as string[]
                                      const moveSet = new Set(movingIds)
                                      const allItems = selectedPlaylist.items || []
                                      const remaining = allItems.filter((it) => !moveSet.has(it.id))
                                      const movingItems = allItems.filter((it) => moveSet.has(it.id))
                                      const targetIdx = remaining.findIndex((it) => it.id === item.id)
                                      const insertAt =
                                        targetIdx === -1 ? remaining.length : targetIdx
                                      remaining.splice(insertAt, 0, ...movingItems)
                                      const next =
                                        await window.curationist.reorderMusicPlaylistItems(
                                          selectedPlaylist.id,
                                          remaining.map((it) => it.id)
                                        )
                                      onStateChange(next)
                                    } catch {
                                      // ignore
                                    }
                                    return
                                  }
                                  const rawPlId = e.dataTransfer.getData(
                                    'application/x-curationist-playlist-id'
                                  )
                                  if (rawPlId && selectedPlaylist && rawPlId !== selectedPlaylist.id) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    const sourcePl = state.playlists.find((p) => p.id === rawPlId)
                                    if (sourcePl) {
                                      const trackIds = resolvePlaylistTracks(sourcePl).map((t) => t.id)
                                      if (trackIds.length > 0) {
                                        await handleAddTracksToTargetPlaylist(
                                          selectedPlaylist,
                                          trackIds,
                                          item.position
                                        )
                                      }
                                    }
                                    return
                                  }
                                  const rawTracks = e.dataTransfer.getData(
                                    'application/x-curationist-track-ids'
                                  )
                                  if (rawTracks && selectedPlaylist) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    try {
                                      const trackIds = JSON.parse(rawTracks) as string[]
                                      if (trackIds.length > 0) {
                                        await handleAddTracksToTargetPlaylist(
                                          selectedPlaylist,
                                          trackIds,
                                          item.position
                                        )
                                      }
                                    } catch {
                                      // ignore
                                    }
                                  }
                                }}
                                onClick={(e) => handlePlaylistItemClick(e, item.id)}
                                onContextMenu={(e) => handlePlaylistItemContextMenu(e, item)}
                                onDoubleClick={() => {
                                  if (matchedTrack && selectedPlaylist) {
                                    onPlayTrack(matchedTrack, resolvePlaylistTracks(selectedPlaylist))
                                  }
                                }}
                              >
                                {plColOrder.map((col) => {
                                  switch (col) {
                                    case 'position':
                                      return (
                                        <td
                                          key={col}
                                          style={{ fontFamily: 'var(--font-mono)', color: '#8b949e' }}
                                        >
                                          {item.position + 1}
                                        </td>
                                      )
                                    case 'play':
                                      return (
                                        <td key={col} style={{ textAlign: 'center' }}>
                                          <button
                                            className="icon-btn"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              if (matchedTrack && selectedPlaylist) {
                                                onPlayTrack(
                                                  matchedTrack,
                                                  resolvePlaylistTracks(selectedPlaylist)
                                                )
                                              }
                                            }}
                                            title="Play Track in Playlist"
                                          >
                                            <Play size={11} />
                                          </button>
                                        </td>
                                      )
                                    case 'title':
                                      return <td key={col}>{item.title}</td>
                                    case 'artist':
                                      return <td key={col}>{item.artist}</td>
                                    case 'rating':
                                      return (
                                        <td key={col} onClick={(e) => e.stopPropagation()}>
                                          {matchedTrack ? (
                                            <Mp3StarRating
                                              rating={matchedTrack.rating || 0}
                                              onChange={(newRating) =>
                                                handleSetMp3Rating([matchedTrack.id], newRating)
                                              }
                                            />
                                          ) : (
                                            <span style={{ color: '#6e7681', fontSize: 11 }}>—</span>
                                          )}
                                        </td>
                                      )
                                    case 'show_tags':
                                      return (
                                        <td key={col} style={{ textAlign: 'center' }}>
                                          <input
                                            type="checkbox"
                                            className="subtle-checkbox"
                                            checked={item.show_tags}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={async (e) => {
                                              const next =
                                                await window.curationist.updateMusicPlaylistItemInline(
                                                  item.id,
                                                  { show_tags: e.target.checked }
                                                )
                                              onStateChange(next)
                                            }}
                                          />
                                        </td>
                                      )
                                    case 'value':
                                      return (
                                        <td
                                          key={col}
                                          style={{
                                            fontFamily: 'var(--font-mono)',
                                            fontSize: 11,
                                            color: item.fileExists === false ? '#f14c4c' : '#8b949e'
                                          }}
                                          title={item.value}
                                        >
                                          {item.value}
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
                                              window.curationist.showItemInFolder(item.value)
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
                            <td colSpan={plColOrder.length} style={{ padding: 0, border: 'none' }} />
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

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          headerLabel={contextMenu.headerLabel}
          entries={contextMenu.entries}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Multi-line <SYNCED LYRICS> Editor Modal */}
      {syncedLyricsModalOpen && inspectedTracks.length === 1 && (
        <div className="modal-backdrop" onClick={() => setSyncedLyricsModalOpen(false)}>
          <div
            className="modal-window"
            style={{ width: 620, maxWidth: '94vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span>
                &lt;SYNCED LYRICS&gt; Multi-Line Editor —{' '}
                {inspectedTracks[0].title || inspectedTracks[0].filename}
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSyncedLyricsModalOpen(false)}
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11.5, color: '#9ca3af', lineHeight: 1.5 }}>
                Edit the ID3 <code>&lt;SYNCED LYRICS&gt;</code> tag (LRC format, e.g.{' '}
                <code>[00:12.40]First line of lyrics...</code>). Changes here update the Metadata
                Inspector form and can be saved directly to the MP3 file on disk.
              </div>
              <textarea
                className="vscode-input"
                autoFocus
                rows={16}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  lineHeight: 1.55,
                  resize: 'vertical',
                  minHeight: 260,
                  whiteSpace: 'pre'
                }}
                placeholder="[00:00.00]Enter or paste LRC-formatted <SYNCED LYRICS> lines here..."
                value={tagForm.syncedLyrics}
                onChange={(e) => setTagForm({ ...tagForm, syncedLyrics: e.target.value })}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 11,
                  color: '#8b949e'
                }}
              >
                <span>
                  {
                    (tagForm.syncedLyrics || '')
                      .split(/\r?\n/)
                      .filter((l) => l.trim().length > 0).length
                  }{' '}
                  non-empty line(s)
                </span>
                <button
                  type="button"
                  className="vscode-btn"
                  onClick={() => setTagForm({ ...tagForm, syncedLyrics: '' })}
                  disabled={!tagForm.syncedLyrics}
                >
                  Clear Lyrics
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="vscode-btn"
                onClick={() => setSyncedLyricsModalOpen(false)}
              >
                Apply to Form
              </button>
              <button
                type="button"
                className="vscode-btn primary"
                disabled={busy}
                onClick={async () => {
                  setSyncedLyricsModalOpen(false)
                  setBusy(true)
                  try {
                    const res = await window.curationist.updateMp3Tags({
                      trackIds: [inspectedTracks[0].id],
                      artist: tagForm.artist,
                      title: tagForm.title,
                      album: tagForm.album,
                      year: tagForm.year,
                      genre: tagForm.genre,
                      trackNumber: tagForm.trackNumber,
                      comment: tagForm.comment,
                      syncedLyrics: tagForm.syncedLyrics,
                      rating: tagForm.rating ?? 0,
                      showTags: tagForm.showTags,
                      writeToFile: true
                    })
                    onStateChange(res.state)
                    onNotify('Saved <SYNCED LYRICS> and ID3 tags to MP3 file')
                  } catch (err: any) {
                    onNotify(`Failed to save <SYNCED LYRICS>: ${err?.message || err}`)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Save size={12} /> Save Directly to MP3 &amp; Library
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Disk Deletion Confirmation Modal */}
      {confirmDeleteDiskModal && (
        <div className="modal-backdrop" onClick={() => setConfirmDeleteDiskModal(null)}>
          <div
            className="modal-window"
            style={{ width: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span style={{ color: '#f14c4c' }}>{confirmDeleteDiskModal.title}</span>
            </div>
            <div className="modal-body">
              <p style={{ lineHeight: 1.5, color: 'var(--vscode-fg-primary)' }}>
                {confirmDeleteDiskModal.message}
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="vscode-btn"
                onClick={() => setConfirmDeleteDiskModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="vscode-btn danger"
                onClick={async () => {
                  const fn = confirmDeleteDiskModal.onConfirm
                  setConfirmDeleteDiskModal(null)
                  await fn()
                }}
              >
                <Trash2 size={12} /> Delete from Disk
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Input Modal for New/Rename */}
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
