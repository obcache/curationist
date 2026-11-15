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
  RotateCcw,
  Save,
  Trash2,
  Upload,
  UploadCloud,
  X
} from 'lucide-react'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { DockableSection } from './DockableSection'
import { extractNormalizedDir, FolderTreeFilter } from './FolderTreeFilter'
import { ManagedStorageSelector } from './ManagedStorageSelector'
import { useResizableColumns } from '../hooks/useResizableColumns'
import { useVirtualTable } from '../hooks/useVirtualTable'
import type { PanelViewItem } from './TitleBar'
import type {
  AppSettings,
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
  { id: 'active-json', label: 'Active saved-playlists.json' }
]

interface MusicWorkspaceProps {
  state: MusicWorkspaceState
  settings: AppSettings
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onStateChange: (next: MusicWorkspaceState) => void
  onPlayTrack: (track: Mp3Track, queue?: Mp3Track[]) => void
  playingTrackId?: string
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

export const MusicWorkspace: React.FC<MusicWorkspaceProps> = ({
  state,
  settings,
  onUpdateSettings,
  onStateChange,
  onPlayTrack,
  playingTrackId,
  onNotify,
  layoutResetCounter,
  onPanelsChange,
  panelActionRef
}) => {
  // Resizable columns for MP3 Library Table and Music Playlist Table
  const { widths: libColWidths, startResize: startLibColResize } = useResizableColumns(
    'curationist:music-lib-cols:v1',
    {
      play: 40,
      title: 230,
      artist: 165,
      album: 150,
      duration: 68,
      storage: 92,
      filePath: 340
    },
    { play: 34, title: 80, artist: 70, album: 70, duration: 52, storage: 72, filePath: 120 }
  )

  const { widths: plColWidths, startResize: startPlColResize } = useResizableColumns(
    'curationist:music-pl-cols:v1',
    {
      position: 46,
      play: 40,
      title: 220,
      artist: 175,
      show_tags: 86,
      value: 320,
      dir: 44
    },
    { position: 36, play: 34, title: 80, artist: 70, show_tags: 64, value: 120, dir: 38 }
  )

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
    }
  }, [layoutResetCounter])

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
  const [copyOnImport, setCopyOnImport] = useState(settings.copyMp3ToManagedByDefault)

  type LibrarySortCol = 'title' | 'artist' | 'album' | 'duration' | 'storage' | 'filePath'
  type PlaylistSortCol = 'position' | 'title' | 'artist' | 'show_tags' | 'value'

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
        case 'duration':
          cmp = (a.duration || 0) - (b.duration || 0)
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
  }, [libraryScopedTracks, selectedFolder, includeSubfolders, librarySearch, libSort])

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

  const activeJsonPlaylists: MusicPlaylist[] = useMemo(
    () =>
      state.playlists
        .filter((p) => p.inActiveJson)
        .sort((a, b) => a.activeOrder - b.activeOrder),
    [state.playlists]
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
    showTags: true,
    coverArtMime: '' as string | null,
    coverArtBase64: '' as string | null,
    coverArtDirty: false,
    writeToFile: true
  })

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
        showTags: t.showTags,
        coverArtMime: t.coverArtMime || '',
        coverArtBase64: t.coverArtBase64 || '',
        coverArtDirty: false,
        writeToFile: true
      })
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
      const first = inspectedTracks[0]
      const sameArtist = inspectedTracks.every((t) => t.artist === first.artist)
      const sameAlbum = inspectedTracks.every((t) => t.album === first.album)
      const sameYear = inspectedTracks.every((t) => t.year === first.year)
      const sameGenre = inspectedTracks.every((t) => t.genre === first.genre)
      setTagForm({
        artist: sameArtist ? first.artist : '',
        title: '',
        album: sameAlbum ? first.album : '',
        year: sameYear ? first.year : '',
        genre: sameGenre ? first.genre : '',
        trackNumber: '',
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
        id: 'play',
        label: count > 1 ? `Play Selected Tracks (${count})` : `Play "${track.title || track.filename}"`,
        icon: <Play size={13} />,
        onClick: () => onPlayTrack(firstTrack, count > 1 ? targetTracks : filteredTracks)
      },
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
    const trackIdsForConsolidate = Array.from(
      new Set(targetItems.map((it) => it.trackId).filter(Boolean) as string[])
    )

    const entries: ContextMenuEntry[] = [
      {
        id: 'play-item',
        label: `Play "${item.title || item.value.split(/[\\/]/).pop()}"`,
        icon: <Play size={13} />,
        disabled: !clickedTrack,
        onClick: () => {
          if (clickedTrack) onPlayTrack(clickedTrack, plQueue)
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
        showTags: tagForm.showTags,
        coverArtBase64: tagForm.coverArtDirty ? tagForm.coverArtBase64 : undefined,
        coverArtMime: tagForm.coverArtDirty ? tagForm.coverArtMime : undefined,
        writeToFile: tagForm.writeToFile
      })
      onStateChange(res.state)
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

  // Stage / unstage playlist in Active saved-playlists.json
  const stagePlaylistInActiveJson = async (playlistId: string) => {
    if (state.activeJsonPlaylistIds.includes(playlistId)) return
    const nextIds = [...state.activeJsonPlaylistIds, playlistId]
    const next = await window.curationist.setActiveMusicJsonPlaylists(nextIds)
    onStateChange(next)
    onNotify('Staged playlist in active saved-playlists.json draft (Modified)')
  }

  const unstagePlaylistFromActiveJson = async (playlistId: string) => {
    const nextIds = state.activeJsonPlaylistIds.filter((id) => id !== playlistId)
    const next = await window.curationist.setActiveMusicJsonPlaylists(nextIds)
    onStateChange(next)
    onNotify('Removed playlist from active saved-playlists.json draft (Modified)')
  }

  const moveActiveJsonPlaylist = async (playlistId: string, dir: -1 | 1) => {
    const ids = [...state.activeJsonPlaylistIds]
    const idx = ids.indexOf(playlistId)
    if (idx === -1) return
    const target = idx + dir
    if (target < 0 || target >= ids.length) return
    const tmp = ids[idx]
    ids[idx] = ids[target]
    ids[target] = tmp
    const next = await window.curationist.setActiveMusicJsonPlaylists(ids)
    onStateChange(next)
  }

  const handlePublishMusic = async () => {
    setBusy(true)
    try {
      const res = await window.curationist.publishMusicPlaylists()
      onStateChange(res.state)
      onNotify(`Published ${res.publishedPlaylists} playlist(s) to ${res.path}`)
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
                      e.dataTransfer.effectAllowed = 'copyMove'
                    }}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('application/x-curationist-track-ids')) {
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
                      const raw = e.dataTransfer.getData('application/x-curationist-track-ids')
                      if (raw) {
                        e.preventDefault()
                        e.stopPropagation()
                        try {
                          const ids = JSON.parse(raw) as string[]
                          if (ids.length > 0) {
                            handleAddTracksToTargetPlaylist(pl, ids)
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
                      {pl.inActiveJson && <span className="badge synced">In JSON</span>}
                      <span>{pl.itemCount}</span>
                      <button
                        className="icon-btn"
                        title={`Play Playlist "${pl.name}"`}
                        onClick={() => handlePlayPlaylist(pl)}
                      >
                        <Play size={11} />
                      </button>
                      {!pl.inActiveJson && (
                        <button
                          className="icon-btn accent"
                          title="Stage in Active saved-playlists.json"
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
            title="Active saved-playlists.json"
            count={activeJsonPlaylists.length}
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
                  title="New Playlist (Create Locally & Stage in Active saved-playlists.json)"
                  onClick={() =>
                    openPrompt(
                      'New Staged Music Playlist Name',
                      'New Playlist',
                      async (val) => {
                        const res = await window.curationist.createMusicPlaylist(val, true)
                        onStateChange(res.state)
                        setSelectedPlaylistId(res.newId)
                        onNotify(`Created and staged playlist "${val}" in saved-playlists.json`)
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
                title={state.targetJsonPath}
              >
                {state.isModified
                  ? 'Draft has unpublished changes'
                  : 'All active playlists published'}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="vscode-btn"
                  disabled={busy}
                  onClick={() =>
                    openPrompt(
                      'New Staged Music Playlist Name',
                      'New Playlist',
                      async (val) => {
                        const res = await window.curationist.createMusicPlaylist(val, true)
                        onStateChange(res.state)
                        setSelectedPlaylistId(res.newId)
                        onNotify(`Created and staged playlist "${val}" in saved-playlists.json`)
                      }
                    )
                  }
                  title="Create a new local playlist and automatically stage it in saved-playlists.json"
                >
                  <Plus size={12} /> New Playlist
                </button>
                <button
                  className={`vscode-btn ${state.isModified ? 'publish' : 'primary'}`}
                  disabled={busy}
                  onClick={handlePublishMusic}
                  title={`Write ${activeJsonPlaylists.length} playlists to ${state.targetJsonPath}`}
                >
                  <UploadCloud size={12} /> Publish
                </button>
              </div>
            </div>

            <div
              className="list-scroll"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-curationist-playlist-id')) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={(e) => {
                const plId = e.dataTransfer.getData('application/x-curationist-playlist-id')
                if (plId) {
                  stagePlaylistInActiveJson(plId)
                }
              }}
            >
              {activeJsonPlaylists.length === 0 ? (
                <div className="empty-placeholder">
                  <span>Drag playlists here from All Known Playlists</span>
                </div>
              ) : (
                activeJsonPlaylists.map((pl, idx) => {
                  const isDragTarget = dragOverPlaylistId === `active-${pl.id}`
                  return (
                    <div
                      key={pl.id}
                      className={`list-row ${pl.id === selectedPlaylistId ? 'selected' : ''} ${
                        isDragTarget ? 'drag-target-playlist' : ''
                      }`}
                      onClick={() => setSelectedPlaylistId(pl.id)}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes('application/x-curationist-track-ids')) {
                          e.preventDefault()
                          e.stopPropagation()
                          e.dataTransfer.dropEffect = 'copy'
                          setDragOverPlaylistId(`active-${pl.id}`)
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverPlaylistId === `active-${pl.id}`) {
                          setDragOverPlaylistId(null)
                        }
                      }}
                      onDrop={(e) => {
                        setDragOverPlaylistId(null)
                        const raw = e.dataTransfer.getData('application/x-curationist-track-ids')
                        if (raw) {
                          e.preventDefault()
                          e.stopPropagation()
                          try {
                            const ids = JSON.parse(raw) as string[]
                            if (ids.length > 0) {
                              handleAddTracksToTargetPlaylist(pl, ids)
                            }
                          } catch {
                            // ignore
                          }
                        }
                      }}
                    >
                      <div className="list-row-main">
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10.5,
                            color: '#8b949e',
                            width: 18
                          }}
                        >
                          #{idx + 1}
                        </span>
                        <span className="list-row-title">{pl.name}</span>
                      </div>
                      <div className="list-row-meta" onClick={(e) => e.stopPropagation()}>
                        <span>{pl.itemCount}</span>
                        <button
                          className="icon-btn"
                          onClick={() => handlePlayPlaylist(pl)}
                          title={`Play Playlist "${pl.name}"`}
                        >
                          <Play size={11} />
                        </button>
                        <button
                          className="icon-btn"
                          disabled={idx === 0}
                          onClick={() => moveActiveJsonPlaylist(pl.id, -1)}
                          title="Move Up in JSON"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          className="icon-btn"
                          disabled={idx === activeJsonPlaylists.length - 1}
                          onClick={() => moveActiveJsonPlaylist(pl.id, 1)}
                          title="Move Down in JSON"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          className="icon-btn danger"
                          onClick={() => unstagePlaylistFromActiveJson(pl.id)}
                          title="Remove from Active saved-playlists.json (keeps in library)"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </DockableSection>
        )

      case 'id3-inspector':
        return (
          <DockableSection
            key={sec.id}
            id={sec.id}
            title="ID3 Tag & Cover Art Editor"
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
                <span>Select one or more MP3 tracks to inspect or edit ID3 tags and cover art</span>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#ffffff' }}>
                      {inspectedTracks.length === 1
                        ? inspectedTracks[0].filename
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
                    </div>
                  </div>
                </div>

                <div className="form-grid">
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
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={tagForm.showTags}
                    onChange={(e) => setTagForm({ ...tagForm, showTags: e.target.checked })}
                  />
                  <span>Show Artist/Title Overlay in nowPlaylisting (show_tags)</span>
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={tagForm.writeToFile}
                    onChange={(e) => setTagForm({ ...tagForm, writeToFile: e.target.checked })}
                  />
                  <span>Write ID3v2 Tags &amp; Cover Art directly to MP3 file(s) on disk</span>
                </label>

                <button type="submit" className="vscode-btn primary" disabled={busy}>
                  <Save size={12} /> Save Metadata ({inspectedTracks.length})
                </button>
              </form>
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
                  <div className="editor-toolbar-group" style={{ flex: 1, maxWidth: 480 }}>
                    <input
                      className="vscode-input"
                      placeholder="Filter MP3 library by artist, title, album, or filename..."
                      value={librarySearch}
                      onChange={(e) => setLibrarySearch(e.target.value)}
                    />
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
                        <th style={{ width: libColWidths.play }}>
                          Play
                          <div
                            className="col-resize-handle"
                            onMouseDown={(e) => startLibColResize('play', e)}
                          />
                        </th>
                        <th
                          className="sortable-th"
                          style={{ width: libColWidths.title }}
                          onClick={() => cycleLibSort('title')}
                        >
                          <div className="th-sort-content">
                            <span>Title</span>
                            {libSort.col === 'title' && (
                              <span className="sort-indicator">
                                {libSort.dir === 'asc' ? '▲' : '▼'}
                              </span>
                            )}
                          </div>
                          <div
                            className="col-resize-handle"
                            onMouseDown={(e) => startLibColResize('title', e)}
                          />
                        </th>
                        <th
                          className="sortable-th"
                          style={{ width: libColWidths.artist }}
                          onClick={() => cycleLibSort('artist')}
                        >
                          <div className="th-sort-content">
                            <span>Artist</span>
                            {libSort.col === 'artist' && (
                              <span className="sort-indicator">
                                {libSort.dir === 'asc' ? '▲' : '▼'}
                              </span>
                            )}
                          </div>
                          <div
                            className="col-resize-handle"
                            onMouseDown={(e) => startLibColResize('artist', e)}
                          />
                        </th>
                        <th
                          className="sortable-th"
                          style={{ width: libColWidths.album }}
                          onClick={() => cycleLibSort('album')}
                        >
                          <div className="th-sort-content">
                            <span>Album</span>
                            {libSort.col === 'album' && (
                              <span className="sort-indicator">
                                {libSort.dir === 'asc' ? '▲' : '▼'}
                              </span>
                            )}
                          </div>
                          <div
                            className="col-resize-handle"
                            onMouseDown={(e) => startLibColResize('album', e)}
                          />
                        </th>
                        <th
                          className="sortable-th"
                          style={{ width: libColWidths.duration }}
                          onClick={() => cycleLibSort('duration')}
                        >
                          <div className="th-sort-content">
                            <span>Time</span>
                            {libSort.col === 'duration' && (
                              <span className="sort-indicator">
                                {libSort.dir === 'asc' ? '▲' : '▼'}
                              </span>
                            )}
                          </div>
                          <div
                            className="col-resize-handle"
                            onMouseDown={(e) => startLibColResize('duration', e)}
                          />
                        </th>
                        <th
                          className="sortable-th"
                          style={{ width: libColWidths.storage }}
                          onClick={() => cycleLibSort('storage')}
                        >
                          <div className="th-sort-content">
                            <span>Storage</span>
                            {libSort.col === 'storage' && (
                              <span className="sort-indicator">
                                {libSort.dir === 'asc' ? '▲' : '▼'}
                              </span>
                            )}
                          </div>
                          <div
                            className="col-resize-handle"
                            onMouseDown={(e) => startLibColResize('storage', e)}
                          />
                        </th>
                        <th
                          className="sortable-th"
                          style={{ width: libColWidths.filePath }}
                          onClick={() => cycleLibSort('filePath')}
                        >
                          <div className="th-sort-content">
                            <span>File Path</span>
                            {libSort.col === 'filePath' && (
                              <span className="sort-indicator">
                                {libSort.dir === 'asc' ? '▲' : '▼'}
                              </span>
                            )}
                          </div>
                          <div
                            className="col-resize-handle"
                            onMouseDown={(e) => startLibColResize('filePath', e)}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {libVirtual.topSpacerHeight > 0 && (
                        <tr aria-hidden="true" style={{ height: libVirtual.topSpacerHeight }}>
                          <td colSpan={7} style={{ padding: 0, border: 'none' }} />
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
                              <td style={{ textAlign: 'center' }}>
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
                              <td title={track.title || track.filename}>
                                <strong>{track.title || track.filename}</strong>
                              </td>
                              <td title={track.artist}>{track.artist || '—'}</td>
                              <td title={track.album}>{track.album || '—'}</td>
                              <td style={{ fontFamily: 'var(--font-mono)' }}>
                                {formatDuration(track.duration)}
                              </td>
                              <td>
                                {!track.fileExists ? (
                                  <span className="badge missing">Missing</span>
                                ) : track.isManaged ? (
                                  <span className="badge managed">Managed</span>
                                ) : (
                                  <span className="badge">External</span>
                                )}
                              </td>
                              <td
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 11,
                                  color: '#8b949e'
                                }}
                                title={track.filePath}
                              >
                                {track.filePath}
                              </td>
                            </tr>
                          )
                        })}
                      {libVirtual.bottomSpacerHeight > 0 && (
                        <tr aria-hidden="true" style={{ height: libVirtual.bottomSpacerHeight }}>
                          <td colSpan={7} style={{ padding: 0, border: 'none' }} />
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
                  if (e.dataTransfer.types.includes('application/x-curationist-track-ids')) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }
                }}
                onDrop={(e) => {
                  const raw = e.dataTransfer.getData('application/x-curationist-track-ids')
                  if (raw && selectedPlaylist) {
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
                    {selectedPlaylist?.inActiveJson ? (
                      <span className="badge synced">In Active saved-playlists.json</span>
                    ) : (
                      selectedPlaylist && (
                        <button
                          className="vscode-btn"
                          onClick={() => stagePlaylistInActiveJson(selectedPlaylist.id)}
                        >
                          <ArrowRight size={11} /> Stage in saved-playlists.json
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
                          <th
                            className="sortable-th"
                            style={{ width: plColWidths.position }}
                            onClick={() => cyclePlSort('position')}
                          >
                            <div className="th-sort-content">
                              <span>#</span>
                              {plSort.col === 'position' && (
                                <span className="sort-indicator">
                                  {plSort.dir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </div>
                            <div
                              className="col-resize-handle"
                              onMouseDown={(e) => startPlColResize('position', e)}
                            />
                          </th>
                          <th style={{ width: plColWidths.play }}>
                            Play
                            <div
                              className="col-resize-handle"
                              onMouseDown={(e) => startPlColResize('play', e)}
                            />
                          </th>
                          <th
                            className="sortable-th"
                            style={{ width: plColWidths.title }}
                            onClick={() => cyclePlSort('title')}
                          >
                            <div className="th-sort-content">
                              <span>Title</span>
                              {plSort.col === 'title' && (
                                <span className="sort-indicator">
                                  {plSort.dir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </div>
                            <div
                              className="col-resize-handle"
                              onMouseDown={(e) => startPlColResize('title', e)}
                            />
                          </th>
                          <th
                            className="sortable-th"
                            style={{ width: plColWidths.artist }}
                            onClick={() => cyclePlSort('artist')}
                          >
                            <div className="th-sort-content">
                              <span>Artist</span>
                              {plSort.col === 'artist' && (
                                <span className="sort-indicator">
                                  {plSort.dir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </div>
                            <div
                              className="col-resize-handle"
                              onMouseDown={(e) => startPlColResize('artist', e)}
                            />
                          </th>
                          <th
                            className="sortable-th"
                            style={{ width: plColWidths.show_tags }}
                            onClick={() => cyclePlSort('show_tags')}
                          >
                            <div className="th-sort-content">
                              <span>Show Tags</span>
                              {plSort.col === 'show_tags' && (
                                <span className="sort-indicator">
                                  {plSort.dir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </div>
                            <div
                              className="col-resize-handle"
                              onMouseDown={(e) => startPlColResize('show_tags', e)}
                            />
                          </th>
                          <th
                            className="sortable-th"
                            style={{ width: plColWidths.value }}
                            onClick={() => cyclePlSort('value')}
                          >
                            <div className="th-sort-content">
                              <span>File Path (value)</span>
                              {plSort.col === 'value' && (
                                <span className="sort-indicator">
                                  {plSort.dir === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </div>
                            <div
                              className="col-resize-handle"
                              onMouseDown={(e) => startPlColResize('value', e)}
                            />
                          </th>
                          <th style={{ width: plColWidths.dir }}>
                            Dir
                            <div
                              className="col-resize-handle"
                              onMouseDown={(e) => startPlColResize('dir', e)}
                            />
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {plVirtual.topSpacerHeight > 0 && (
                          <tr aria-hidden="true" style={{ height: plVirtual.topSpacerHeight }}>
                            <td colSpan={7} style={{ padding: 0, border: 'none' }} />
                          </tr>
                        )}
                        {sortedPlaylistItems
                          .slice(plVirtual.startIndex, plVirtual.endIndex)
                          .map((item) => {
                            const isSel = selectedPlaylistItemIdSet.has(item.id)
                            const isDragRow = dragOverPlRowId === item.id
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
                                  e.dataTransfer.effectAllowed = 'move'
                                }}
                                onDragOver={(e) => {
                                  if (
                                    e.dataTransfer.types.includes(
                                      'application/x-curationist-playlist-item-ids'
                                    ) ||
                                    e.dataTransfer.types.includes(
                                      'application/x-curationist-track-ids'
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
                                  const found =
                                    (item.trackId && trackLookup.byId.get(item.trackId)) ||
                                    trackLookup.byPath.get(
                                      item.value.replace(/\\/g, '/').toLowerCase()
                                    )
                                  if (found && selectedPlaylist) {
                                    onPlayTrack(found, resolvePlaylistTracks(selectedPlaylist))
                                  }
                                }}
                              >
                                <td style={{ fontFamily: 'var(--font-mono)', color: '#8b949e' }}>
                                  {item.position + 1}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    className="icon-btn"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const found =
                                        (item.trackId && trackLookup.byId.get(item.trackId)) ||
                                        trackLookup.byPath.get(
                                          item.value.replace(/\\/g, '/').toLowerCase()
                                        )
                                      if (found && selectedPlaylist) {
                                        onPlayTrack(found, resolvePlaylistTracks(selectedPlaylist))
                                      }
                                    }}
                                    title="Play Track in Playlist"
                                  >
                                    <Play size={11} />
                                  </button>
                                </td>
                                <td>{item.title}</td>
                                <td>{item.artist}</td>
                                <td style={{ textAlign: 'center' }}>
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
                                <td
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: 11,
                                    color: item.fileExists === false ? '#f14c4c' : '#8b949e'
                                  }}
                                  title={item.value}
                                >
                                  {item.value}
                                </td>
                                <td style={{ textAlign: 'center' }}>
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
                              </tr>
                            )
                          })}
                        {plVirtual.bottomSpacerHeight > 0 && (
                          <tr aria-hidden="true" style={{ height: plVirtual.bottomSpacerHeight }}>
                            <td colSpan={7} style={{ padding: 0, border: 'none' }} />
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
